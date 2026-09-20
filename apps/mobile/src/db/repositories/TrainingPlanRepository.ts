import { addLocalDays, type PlanDayInput, type TrainingPlan, type TrainingPlanRunDay, type SourceType } from '@motion/domain'
import type { Database, SqlAccess, SqlRow } from '../sqlite/Database'
import { rebuildTrainingState } from './rebuildTrainingState'

interface PlanRow extends SqlRow { id: string; title: string; source_type: SourceType; planned_days: number; created_at: string }
interface RunDayRow extends SqlRow {
  id: string; training_plan_run_id: string; training_plan_day_id: string; scheduled_local_date: string
  original_scheduled_local_date: string
  status: TrainingPlanRunDay['status']; execution_kind: TrainingPlanRunDay['executionKind']
  plan_equivalence: TrainingPlanRunDay['planEquivalence']; reschedule_count: number
  day_index?: number; title?: string | null; is_rest_day?: number; workout_content_id?: string | null
}

export interface PlanRun {
  id: string; trainingPlanId: string; startedOn: string
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABANDONED'
  currentDayIndex: number | null; pausedAt: string | null
}

export interface PlanDayView {
  id: string; dayIndex: number; title: string | null; isRestDay: boolean; primaryWorkoutId: string | null
}

export interface PlanRunDayView extends TrainingPlanRunDay {
  originalScheduledLocalDate: string; dayIndex: number; title: string | null
  isRestDay: boolean; primaryWorkoutId: string | null
}

function dayDifference(from: string, to: string): number {
  addLocalDays(from, 0); addLocalDays(to, 0)
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

async function shiftPending(tx: SqlAccess, runId: string, from: string, delta: number): Promise<void> {
  if (delta <= 0) return
  const pending = await tx.query<RunDayRow>(`SELECT * FROM training_plan_run_days WHERE training_plan_run_id=?
    AND scheduled_local_date>=? AND status='SCHEDULED' ORDER BY scheduled_local_date DESC`, [runId, from])
  const now = new Date().toISOString()
  for (const item of pending) {
    await tx.run('UPDATE training_plan_run_days SET scheduled_local_date=?,reschedule_count=reschedule_count+1,updated_at=? WHERE id=?',
      [addLocalDays(item.scheduled_local_date, delta), now, item.id])
  }
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
     WHERE rd.training_plan_run_id=? AND rd.status IN ('SCHEDULED','IN_PROGRESS') ORDER BY rd.scheduled_local_date LIMIT 1`, [runId])
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
        await tx.run(`INSERT INTO training_plan_days
          (id,training_plan_id,day_index,original_label,title,is_rest_day,expected_duration_minutes,expected_intensity,notes)
          VALUES (?,?,?,?,?,?,?,?,?)`, [dayId, id, day.dayIndex, day.originalLabel ?? null,
          day.title ?? null, day.isRestDay ? 1 : 0, day.expectedDurationMinutes ?? null,
          day.expectedIntensity ?? null, day.notes ?? null])
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

  async listPlans(): Promise<TrainingPlan[]> {
    const rows = await this.db.query<PlanRow>('SELECT * FROM training_plans WHERE is_archived=0 ORDER BY created_at DESC')
    return rows.map((row) => ({ id: row.id, title: row.title, sourceType: row.source_type,
      plannedDays: row.planned_days, createdAt: row.created_at }))
  }

  async getPlanDays(planId: string): Promise<PlanDayView[]> {
    const rows = await this.db.query<{ id: string; day_index: number; title: string | null;
      is_rest_day: number; workout_content_id: string | null }>(`SELECT pd.*,
      (SELECT workout_content_id FROM training_plan_day_items WHERE training_plan_day_id=pd.id AND role='PRIMARY') AS workout_content_id
      FROM training_plan_days pd WHERE training_plan_id=? ORDER BY day_index`, [planId])
    return rows.map((row) => ({ id: row.id, dayIndex: row.day_index, title: row.title,
      isRestDay: row.is_rest_day === 1, primaryWorkoutId: row.workout_content_id }))
  }

  async getCurrentRun(): Promise<PlanRun | null> {
    const row = (await this.db.query<{ id: string; training_plan_id: string; started_on: string;
      status: PlanRun['status']; current_day_index: number | null; paused_at: string | null }>(
      "SELECT * FROM training_plan_runs WHERE status IN ('ACTIVE','PAUSED') LIMIT 1"))[0]
    return row ? { id: row.id, trainingPlanId: row.training_plan_id, startedOn: row.started_on,
      status: row.status, currentDayIndex: row.current_day_index, pausedAt: row.paused_at } : null
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
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('motion:training-changed'))
    return id
  }

  async getRunDays(runId: string): Promise<TrainingPlanRunDay[]> {
    const rows = await this.db.query<RunDayRow>(`SELECT rd.* FROM training_plan_run_days rd
      JOIN training_plan_days pd ON pd.id=rd.training_plan_day_id WHERE rd.training_plan_run_id=? ORDER BY pd.day_index`, [runId])
    return rows.map(toRunDay)
  }

  async getRunDayViews(runId: string): Promise<PlanRunDayView[]> {
    const rows = await this.db.query<RunDayRow>(`SELECT rd.*,pd.day_index,pd.title,pd.is_rest_day,
      (SELECT workout_content_id FROM training_plan_day_items WHERE training_plan_day_id=pd.id AND role='PRIMARY') AS workout_content_id
      FROM training_plan_run_days rd JOIN training_plan_days pd ON pd.id=rd.training_plan_day_id
      WHERE rd.training_plan_run_id=? ORDER BY pd.day_index`, [runId])
    return rows.map((row) => ({ ...toRunDay(row), originalScheduledLocalDate: row.original_scheduled_local_date,
      dayIndex: row.day_index!, title: row.title ?? null, isRestDay: row.is_rest_day === 1,
      primaryWorkoutId: row.workout_content_id ?? null }))
  }

  async reconcileMissed(today: string): Promise<void> {
    addLocalDays(today, 0)
    await this.db.transaction(async (tx) => {
      const run = (await tx.query<{ id: string }>("SELECT id FROM training_plan_runs WHERE status='ACTIVE' LIMIT 1"))[0]
      if (!run) return
      const days = await tx.query<RunDayRow>(`SELECT rd.*,pd.day_index,pd.is_rest_day FROM training_plan_run_days rd
        JOIN training_plan_days pd ON pd.id=rd.training_plan_day_id WHERE rd.training_plan_run_id=?
        AND rd.status IN ('SCHEDULED','IN_PROGRESS') ORDER BY rd.scheduled_local_date`, [run.id])
      for (const day of days) {
        if (day.status === 'IN_PROGRESS' || day.scheduled_local_date >= today) break
        if (day.is_rest_day === 1) {
          const now = new Date().toISOString()
          await tx.run("UPDATE training_plan_run_days SET status='PLANNED_REST',completed_at=?,updated_at=? WHERE id=?", [now, now, day.id])
          await rebuildTrainingState(tx, [], [day.id])
        } else {
          await shiftPending(tx, run.id, day.scheduled_local_date, dayDifference(day.scheduled_local_date, today))
          break
        }
      }
      await refreshRunProgress(tx, run.id)
    })
  }

  async pause(runId: string, pausedAt = new Date()): Promise<void> {
    await this.db.transaction(async (tx) => {
      const active = await tx.query<{ status: string }>('SELECT status FROM training_plan_runs WHERE id=?', [runId])
      if (active[0]?.status === 'PAUSED') return
      if (active[0]?.status !== 'ACTIVE') throw new Error('Active plan run not found')
      const ongoing = await tx.query<{ id: string }>(`SELECT s.id FROM training_sessions s JOIN training_plan_run_days rd
        ON rd.id=s.training_plan_run_day_id WHERE rd.training_plan_run_id=? AND s.lifecycle_status='IN_PROGRESS'`, [runId])
      if (ongoing.length) throw new Error('Finish or abandon the active session before pausing')
      await tx.run("UPDATE training_plan_runs SET status='PAUSED',paused_at=? WHERE id=?", [pausedAt.toISOString(), runId])
    })
  }

  async resume(runId: string, resumedOn: string): Promise<void> {
    addLocalDays(resumedOn, 0)
    await this.db.transaction(async (tx) => {
      const run = (await tx.query<{ status: string; paused_at: string | null }>(
        'SELECT status,paused_at FROM training_plan_runs WHERE id=?', [runId]))[0]
      if (run?.status === 'ACTIVE') return
      if (run?.status !== 'PAUSED' || !run.paused_at) throw new Error('Paused plan run not found')
      const pauseDate = new Date(run.paused_at)
      const from = `${pauseDate.getFullYear()}-${String(pauseDate.getMonth()+1).padStart(2,'0')}-${String(pauseDate.getDate()).padStart(2,'0')}`
      const delta = Math.max(0, dayDifference(from, resumedOn))
      const pending = await tx.query<{ scheduled_local_date: string }>(`SELECT scheduled_local_date FROM training_plan_run_days
        WHERE training_plan_run_id=? AND status='SCHEDULED' ORDER BY scheduled_local_date LIMIT 1`, [runId])
      if (pending[0]) await shiftPending(tx, runId, pending[0].scheduled_local_date, delta)
      await tx.run("UPDATE training_plan_runs SET status='ACTIVE',paused_at=NULL WHERE id=?", [runId])
    })
  }

  async end(runId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const ongoing = await tx.query<{ id: string }>(`SELECT s.id FROM training_sessions s JOIN training_plan_run_days rd
        ON rd.id=s.training_plan_run_day_id WHERE rd.training_plan_run_id=? AND s.lifecycle_status='IN_PROGRESS'`, [runId])
      if (ongoing.length) throw new Error('Finish or abandon the active session before ending')
      await tx.run("UPDATE training_plan_runs SET status='ABANDONED',ended_reason='USER_ENDED',paused_at=NULL WHERE id=? AND status IN ('ACTIVE','PAUSED')", [runId])
    })
  }

  async completeRun(runId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const run = (await tx.query<{ status: string }>('SELECT status FROM training_plan_runs WHERE id=?', [runId]))[0]
      if (run?.status === 'COMPLETED') return
      if (run?.status !== 'ACTIVE') throw new Error('Active plan run not found')
      const pending = await tx.query<{ id: string }>("SELECT id FROM training_plan_run_days WHERE training_plan_run_id=? AND status IN ('SCHEDULED','IN_PROGRESS') LIMIT 1", [runId])
      if (pending.length) throw new Error('Plan run has unfinished days')
      await tx.run("UPDATE training_plan_runs SET status='COMPLETED',completed_at=?,current_day_index=NULL WHERE id=?", [new Date().toISOString(), runId])
    })
  }

  async swapPlannedRest(restId: string, otherId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx.query<RunDayRow>(`SELECT rd.*,pd.is_rest_day FROM training_plan_run_days rd
        JOIN training_plan_days pd ON pd.id=rd.training_plan_day_id
        JOIN training_plan_runs r ON r.id=rd.training_plan_run_id
        WHERE rd.id IN (?,?) AND r.status='ACTIVE'`, [restId, otherId])
      const rest = rows.find((row) => row.id === restId)
      const other = rows.find((row) => row.id === otherId)
      if (!rest || !other || rest.training_plan_run_id !== other.training_plan_run_id ||
        rest.is_rest_day !== 1 || other.is_rest_day !== 0 || rest.status !== 'SCHEDULED' || other.status !== 'SCHEDULED') {
        throw new Error('Two pending days in one active run are required')
      }
      const temp = `swap-${crypto.randomUUID()}`
      const now = new Date().toISOString()
      await tx.run('UPDATE training_plan_run_days SET scheduled_local_date=? WHERE id=?', [temp, restId])
      await tx.run('UPDATE training_plan_run_days SET scheduled_local_date=?,reschedule_count=reschedule_count+1,updated_at=? WHERE id=?', [rest.scheduled_local_date, now, otherId])
      await tx.run('UPDATE training_plan_run_days SET scheduled_local_date=?,reschedule_count=reschedule_count+1,updated_at=? WHERE id=?', [other.scheduled_local_date, now, restId])
      await refreshRunProgress(tx, rest.training_plan_run_id)
    })
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('motion:training-changed'))
  }

  async reschedule(runDayId: string, newDate: string): Promise<void> {
    addLocalDays(newDate, 0)
    await this.db.transaction(async (tx) => {
      const rows = await tx.query<RunDayRow>(`SELECT rd.* FROM training_plan_run_days rd
        JOIN training_plan_runs r ON r.id=rd.training_plan_run_id WHERE rd.id=? AND r.status='ACTIVE'`, [runDayId])
      const day = rows[0]
      if (!day || day.status !== 'SCHEDULED') throw new Error('Only a scheduled day in an active run can move')
      await this.assertCurrent(tx, day)
      const delta = dayDifference(day.scheduled_local_date, newDate)
      if (delta < 0) throw new Error('M1 rescheduling moves a day forward')
      if (delta === 0) return
      await shiftPending(tx, day.training_plan_run_id, day.scheduled_local_date, delta)
    })
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('motion:training-changed'))
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
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('motion:training-changed'))
  }

  private async assertCurrent(tx: SqlAccess, day: RunDayRow): Promise<void> {
    const current = await tx.query<{ id: string }>(`SELECT rd.id FROM training_plan_run_days rd
      JOIN training_plan_days pd ON pd.id=rd.training_plan_day_id
      WHERE rd.training_plan_run_id=? AND rd.status IN ('SCHEDULED','IN_PROGRESS')
      ORDER BY rd.scheduled_local_date LIMIT 1`, [day.training_plan_run_id])
    if (current[0]?.id !== day.id) throw new Error('Only the current run-day can advance')
  }
}
