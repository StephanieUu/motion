import { addLocalDays, type PlanDayInput, type TrainingPlan, type TrainingPlanRunDay, type SourceType } from '@motion/domain'
import type { Database, SqlAccess, SqlRow } from '../sqlite/Database'
import { rebuildTrainingState } from './rebuildTrainingState'

interface PlanRow extends SqlRow { id: string; title: string; source_type: SourceType; planned_days: number; created_at: string }
interface RunDayRow extends SqlRow {
  id: string; training_plan_run_id: string; training_plan_day_id: string; scheduled_local_date: string
  status: TrainingPlanRunDay['status']; execution_kind: TrainingPlanRunDay['executionKind']
  plan_equivalence: TrainingPlanRunDay['planEquivalence']; reschedule_count: number
}

function toRunDay(row: RunDayRow): TrainingPlanRunDay {
  return { id: row.id, trainingPlanRunId: row.training_plan_run_id,
    trainingPlanDayId: row.training_plan_day_id, scheduledLocalDate: row.scheduled_local_date,
    status: row.status, executionKind: row.execution_kind, planEquivalence: row.plan_equivalence,
    rescheduleCount: row.reschedule_count }
}

export async function refreshRunProgress(tx: SqlAccess, runId: string): Promise<void> {
  const pending = await tx.query<{ day_index: number }>(
    `SELECT pd.day_index FROM training_plan_run_days rd JOIN training_plan_days pd ON pd.id=rd.training_plan_day_id
     WHERE rd.training_plan_run_id=? AND rd.status IN ('SCHEDULED','IN_PROGRESS') ORDER BY pd.day_index LIMIT 1`, [runId])
  await tx.run('UPDATE training_plan_runs SET current_day_index=? WHERE id=?', [pending[0]?.day_index ?? null, runId])
}

export class TrainingPlanRepository {
  constructor(private readonly db: Database) {}

  async create(input: { title: string; sourceType: SourceType; days: PlanDayInput[] }): Promise<TrainingPlan> {
    if (!input.title.trim() || !input.days.length) throw new Error('Plan needs a title and at least one day')
    const indexes = input.days.map((day) => day.dayIndex).sort((a, b) => a - b)
    if (indexes.some((value, index) => value !== index + 1)) throw new Error('Plan days must be consecutive from 1')
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    await this.db.transaction(async (tx) => {
      await tx.run('INSERT INTO training_plans (id,title,source_type,planned_days,created_at) VALUES (?,?,?,?,?)',
        [id, input.title.trim(), input.sourceType, input.days.length, createdAt])
      for (const day of input.days) {
        if (day.isRestDay && day.items?.length) throw new Error('Rest day cannot contain workouts')
        const dayId = crypto.randomUUID()
        await tx.run('INSERT INTO training_plan_days (id,training_plan_id,day_index,title,is_rest_day) VALUES (?,?,?,?,?)',
          [dayId, id, day.dayIndex, day.title ?? null, day.isRestDay ? 1 : 0])
        for (const [index, item] of (day.items ?? []).entries()) {
          await tx.run('INSERT INTO training_plan_day_items (id,training_plan_day_id,workout_content_id,sort_order,role) VALUES (?,?,?,?,?)',
            [crypto.randomUUID(), dayId, item.workoutContentId, index, item.role])
        }
      }
    })
    return { id, title: input.title.trim(), sourceType: input.sourceType, plannedDays: input.days.length, createdAt }
  }

  async get(id: string): Promise<TrainingPlan | null> {
    const rows = await this.db.query<PlanRow>('SELECT * FROM training_plans WHERE id=?', [id])
    const row = rows[0]
    return row ? { id: row.id, title: row.title, sourceType: row.source_type, plannedDays: row.planned_days, createdAt: row.created_at } : null
  }

  async startRun(planId: string, startedOn: string): Promise<string> {
    addLocalDays(startedOn, 0)
    const id = crypto.randomUUID()
    await this.db.transaction(async (tx) => {
      const days = await tx.query<{ id: string; day_index: number }>('SELECT id,day_index FROM training_plan_days WHERE training_plan_id=? ORDER BY day_index', [planId])
      if (!days.length) throw new Error('Plan has no days')
      await tx.run("INSERT INTO training_plan_runs (id,training_plan_id,started_on,status,current_day_index) VALUES (?,?,?,'ACTIVE',1)", [id, planId, startedOn])
      for (const day of days) {
        const date = addLocalDays(startedOn, day.day_index - 1)
        await tx.run(`INSERT INTO training_plan_run_days
          (id,training_plan_run_id,training_plan_day_id,original_scheduled_local_date,scheduled_local_date,status,updated_at)
          VALUES (?,?,?,?,?,'SCHEDULED',?)`, [crypto.randomUUID(), id, day.id, date, date, new Date().toISOString()])
      }
    })
    return id
  }

  async getRunDays(runId: string): Promise<TrainingPlanRunDay[]> {
    const rows = await this.db.query<RunDayRow>(`SELECT rd.* FROM training_plan_run_days rd
      JOIN training_plan_days pd ON pd.id=rd.training_plan_day_id WHERE rd.training_plan_run_id=? ORDER BY pd.day_index`, [runId])
    return rows.map(toRunDay)
  }

  async reschedule(runDayId: string, newDate: string): Promise<void> {
    addLocalDays(newDate, 0)
    await this.db.transaction(async (tx) => {
      const rows = await tx.query<RunDayRow>(`SELECT rd.* FROM training_plan_run_days rd
        JOIN training_plan_runs r ON r.id=rd.training_plan_run_id WHERE rd.id=? AND r.status='ACTIVE'`, [runDayId])
      const day = rows[0]
      if (!day || day.status !== 'SCHEDULED') throw new Error('Only a scheduled day in an active run can move')
      await this.assertCurrent(tx, day)
      const delta = Math.round((Date.parse(`${newDate}T00:00:00Z`) - Date.parse(`${day.scheduled_local_date}T00:00:00Z`)) / 86400000)
      if (delta < 0) throw new Error('M1 rescheduling moves a day forward')
      if (delta === 0) return
      const pending = await tx.query<RunDayRow>(`SELECT * FROM training_plan_run_days WHERE training_plan_run_id=?
        AND scheduled_local_date>=? AND status='SCHEDULED' ORDER BY scheduled_local_date DESC`, [day.training_plan_run_id, day.scheduled_local_date])
      for (const item of pending) {
        await tx.run('UPDATE training_plan_run_days SET scheduled_local_date=?, reschedule_count=reschedule_count+1, updated_at=? WHERE id=?',
          [addLocalDays(item.scheduled_local_date, delta), new Date().toISOString(), item.id])
      }
    })
  }

  async skip(runDayId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx.query<RunDayRow>(`SELECT rd.* FROM training_plan_run_days rd
        JOIN training_plan_runs r ON r.id=rd.training_plan_run_id WHERE rd.id=? AND r.status='ACTIVE'`, [runDayId])
      const day = rows[0]
      if (!day || day.status !== 'SCHEDULED') throw new Error('Only a scheduled day can be skipped')
      await this.assertCurrent(tx, day)
      const sessions = await tx.query<{ count: number }>("SELECT COUNT(*) AS count FROM training_sessions WHERE training_plan_run_day_id=? AND lifecycle_status='COMPLETED'", [runDayId])
      if (sessions[0]?.count) throw new Error('A completed session prevents skipping')
      await tx.run("UPDATE training_plan_run_days SET status='SKIPPED',execution_kind='NONE',completed_at=?,updated_at=? WHERE id=?",
        [new Date().toISOString(), new Date().toISOString(), runDayId])
      await refreshRunProgress(tx, day.training_plan_run_id)
    })
  }

  async completePlannedRest(runDayId: string, today: string): Promise<void> {
    addLocalDays(today, 0)
    await this.db.transaction(async (tx) => {
      const rows = await tx.query<RunDayRow & { is_rest_day: number }>(`SELECT rd.*,pd.is_rest_day FROM training_plan_run_days rd
        JOIN training_plan_days pd ON pd.id=rd.training_plan_day_id
        JOIN training_plan_runs r ON r.id=rd.training_plan_run_id WHERE rd.id=? AND r.status='ACTIVE'`, [runDayId])
      const day = rows[0]
      if (!day || day.status !== 'SCHEDULED' || day.is_rest_day !== 1) throw new Error('Scheduled planned rest not found')
      await this.assertCurrent(tx, day)
      if (day.scheduled_local_date > today) throw new Error('Planned rest date has not arrived')
      const now = new Date().toISOString()
      await tx.run("UPDATE training_plan_run_days SET status='PLANNED_REST',completed_at=?,updated_at=? WHERE id=?", [now, now, runDayId])
      await rebuildTrainingState(tx, [], [runDayId])
    })
  }

  private async assertCurrent(tx: SqlAccess, day: RunDayRow): Promise<void> {
    const current = await tx.query<{ id: string }>(`SELECT rd.id FROM training_plan_run_days rd
      JOIN training_plan_days pd ON pd.id=rd.training_plan_day_id
      WHERE rd.training_plan_run_id=? AND rd.status IN ('SCHEDULED','IN_PROGRESS')
      ORDER BY pd.day_index LIMIT 1`, [day.training_plan_run_id])
    if (current[0]?.id !== day.id) throw new Error('Only the current run-day can advance')
  }
}
