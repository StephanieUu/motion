import { addLocalDays, localDateAtStart, type CompletionStatus, type PlanEquivalence, type TrainingSession } from '@motion/domain'
import type { Database, SqlRow } from '../sqlite/Database'
import { rebuildTrainingState } from './rebuildTrainingState'

interface SessionRow extends SqlRow {
  id: string; local_date: string; local_date_source: string; started_at: string; ended_at: string | null
  duration_minutes: number | null; workout_content_id: string | null; activity_type_id: string | null
  training_plan_run_day_id: string | null; lifecycle_status: TrainingSession['lifecycleStatus']
  completion_status: CompletionStatus | null; qualifies_for_active_day: number
}

function fromRow(row: SessionRow): TrainingSession {
  return { id: row.id, localDate: row.local_date, startedAt: row.started_at, endedAt: row.ended_at,
    durationMinutes: row.duration_minutes, workoutContentId: row.workout_content_id,
    activityTypeId: row.activity_type_id, trainingPlanRunDayId: row.training_plan_run_day_id,
    lifecycleStatus: row.lifecycle_status, completionStatus: row.completion_status,
    qualifiesForActiveDay: row.qualifies_for_active_day === 1 }
}

export interface StartSession {
  workoutContentId?: string
  activityTypeId?: string
  trainingPlanRunDayId?: string
  miniRoutineVersionId?: string
  sessionOrigin: 'PLAN' | 'EXISTING_LIBRARY' | 'NEW_IMPORT' | 'FREE_ACTIVITY' | 'RESCUE'
  startedAt?: Date
  userSelectedLocalDate?: string
}

export interface SessionFeedback {
  exertion: 'EASY' | 'JUST_RIGHT' | 'HARD' | null
  preference: 'LOVE' | 'LIKE' | 'NEUTRAL' | 'DISLIKE' | null
}

export class TrainingSessionRepository {
  constructor(private readonly db: Database) {}

  async get(id: string): Promise<TrainingSession | null> {
    const rows = await this.db.query<SessionRow>('SELECT * FROM training_sessions WHERE id=?', [id])
    return rows[0] ? fromRow(rows[0]) : null
  }

  async getInProgress(): Promise<TrainingSession | null> {
    const rows = await this.db.query<SessionRow>("SELECT * FROM training_sessions WHERE lifecycle_status='IN_PROGRESS' LIMIT 1")
    return rows[0] ? fromRow(rows[0]) : null
  }

  async start(input: StartSession): Promise<TrainingSession> {
    const started = input.startedAt ?? new Date()
    const localDate = input.userSelectedLocalDate ?? localDateAtStart(started)
    addLocalDays(localDate, 0)
    const id = crypto.randomUUID()
    const sessionId = await this.db.transaction(async (tx) => {
      const ongoing = await tx.query<SessionRow & { session_origin: string }>(
        "SELECT * FROM training_sessions WHERE lifecycle_status='IN_PROGRESS' LIMIT 1")
      if (ongoing[0]) {
        const same = ongoing[0].training_plan_run_day_id === (input.trainingPlanRunDayId ?? null)
          && ongoing[0].workout_content_id === (input.workoutContentId ?? null)
          && ongoing[0].session_origin === input.sessionOrigin
        if (same) return ongoing[0].id
        throw new Error(`Resume or abandon session ${ongoing[0].id} before starting another`)
      }
      if (input.trainingPlanRunDayId) {
        const runDay = await tx.query<{ status: string; run_status: string }>(`SELECT rd.status, r.status AS run_status FROM training_plan_run_days rd
          JOIN training_plan_runs r ON r.id=rd.training_plan_run_id WHERE rd.id=?`, [input.trainingPlanRunDayId])
        if (runDay[0]?.status !== 'SCHEDULED' || runDay[0].run_status !== 'ACTIVE') throw new Error('Plan run-day is not available')
      }
      await tx.run(`INSERT INTO training_sessions (id,local_date,local_date_source,time_zone_id_at_start,
        utc_offset_minutes_at_start,started_at,workout_content_id,activity_type_id,training_plan_run_day_id,
        mini_routine_version_id,session_origin,lifecycle_status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,? ,?,'IN_PROGRESS',?,?)`,
      [id, localDate, input.userSelectedLocalDate ? 'USER_SELECTED' : 'START_TIME',
        Intl.DateTimeFormat().resolvedOptions().timeZone, -started.getTimezoneOffset(), started.toISOString(),
        input.workoutContentId ?? null, input.activityTypeId ?? null, input.trainingPlanRunDayId ?? null,
        input.miniRoutineVersionId ?? null, input.sessionOrigin, new Date().toISOString(), new Date().toISOString()])
      await rebuildTrainingState(tx, [localDate], input.trainingPlanRunDayId ? [input.trainingPlanRunDayId] : [])
      return id
    })
    return (await this.get(sessionId))!
  }

  async complete(id: string, input: { durationMinutes: number; completionStatus: CompletionStatus;
    activityTypeId?: string; requiredMiniRoutineItemsConfirmed?: boolean; planEquivalence?: PlanEquivalence;
    endedAt?: Date }): Promise<TrainingSession> {
    if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 0) throw new Error('Invalid duration')
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<SessionRow & { mini_routine_version_id: string | null }>('SELECT * FROM training_sessions WHERE id=?', [id])
      const session = rows[0]
      if (!session) throw new Error('Session not found')
      if (session.lifecycle_status === 'COMPLETED') return fromRow(session)
      if (session.lifecycle_status !== 'IN_PROGRESS') throw new Error('Abandoned session cannot be completed')
      if (session.mini_routine_version_id && input.completionStatus === 'COMPLETE' && !input.requiredMiniRoutineItemsConfirmed) {
        throw new Error('Required Mini Routine items must be confirmed')
      }
      const activityTypeId = input.activityTypeId ?? session.activity_type_id ?? (await tx.query<{ id: string }>("SELECT id FROM activity_types WHERE system_key='OTHER'"))[0]?.id
      if (!activityTypeId) throw new Error('OTHER activity type is missing')
      const endedAt = (input.endedAt ?? new Date()).toISOString()
      await tx.run(`UPDATE training_sessions SET lifecycle_status='COMPLETED',completion_status=?,ended_at=?,
        duration_minutes=?,activity_type_id=?,mini_routine_required_items_confirmed=?,updated_at=? WHERE id=? AND lifecycle_status='IN_PROGRESS'`,
      [input.completionStatus, endedAt, input.durationMinutes, activityTypeId, input.requiredMiniRoutineItemsConfirmed ? 1 : 0, new Date().toISOString(), id])
      if (session.training_plan_run_day_id && input.planEquivalence) {
        await tx.run('UPDATE training_plan_run_days SET plan_equivalence=? WHERE id=?', [input.planEquivalence, session.training_plan_run_day_id])
      }
      if (session.workout_content_id) {
        await tx.run('DELETE FROM today_pending_selections WHERE local_date=? AND workout_content_id=?',
          [session.local_date, session.workout_content_id])
      }
      await rebuildTrainingState(tx, [session.local_date], session.training_plan_run_day_id ? [session.training_plan_run_day_id] : [])
      return fromRow((await tx.query<SessionRow>('SELECT * FROM training_sessions WHERE id=?', [id]))[0]!)
    })
  }

  async abandon(id: string): Promise<TrainingSession> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<SessionRow>('SELECT * FROM training_sessions WHERE id=?', [id])
      const session = rows[0]
      if (!session) throw new Error('Session not found')
      if (session.lifecycle_status === 'ABANDONED') return fromRow(session)
      if (session.lifecycle_status !== 'IN_PROGRESS') throw new Error('Completed session cannot be abandoned')
      await tx.run("UPDATE training_sessions SET lifecycle_status='ABANDONED',ended_at=?,updated_at=? WHERE id=?",
        [new Date().toISOString(), new Date().toISOString(), id])
      await rebuildTrainingState(tx, [session.local_date], session.training_plan_run_day_id ? [session.training_plan_run_day_id] : [])
      return fromRow((await tx.query<SessionRow>('SELECT * FROM training_sessions WHERE id=?', [id]))[0]!)
    })
  }

  async saveFeedback(id: string, feedback: SessionFeedback): Promise<void> {
    if (!feedback.exertion && !feedback.preference) return
    await this.db.transaction(async (tx) => {
      const session = (await tx.query<{ lifecycle_status: string }>(
        'SELECT lifecycle_status FROM training_sessions WHERE id=?', [id]))[0]
      if (session?.lifecycle_status !== 'COMPLETED') throw new Error('Feedback requires a completed session')
      await tx.run(`INSERT INTO workout_feedback (id,training_session_id,exertion,preference,created_at)
        VALUES (?,?,?,?,?) ON CONFLICT(training_session_id) DO UPDATE SET
        exertion=excluded.exertion,preference=excluded.preference`,
      [crypto.randomUUID(), id, feedback.exertion, feedback.preference, new Date().toISOString()])
    })
  }

  async getFeedback(id: string): Promise<SessionFeedback | null> {
    const row = (await this.db.query<{ exertion: SessionFeedback['exertion']; preference: SessionFeedback['preference'] }>(
      'SELECT exertion,preference FROM workout_feedback WHERE training_session_id=?', [id]))[0]
    return row ? { exertion: row.exertion, preference: row.preference } : null
  }

  async correctCompleted(id: string, changes: { localDate?: string; durationMinutes?: number }): Promise<TrainingSession> {
    if (changes.durationMinutes !== undefined && (!Number.isFinite(changes.durationMinutes) || changes.durationMinutes < 0)) throw new Error('Invalid duration')
    if (changes.localDate) addLocalDays(changes.localDate, 0)
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<SessionRow>('SELECT * FROM training_sessions WHERE id=?', [id])
      const session = rows[0]
      if (!session || session.lifecycle_status !== 'COMPLETED') throw new Error('Completed session not found')
      await tx.run(`UPDATE training_sessions SET local_date=?,local_date_source=?,duration_minutes=?,updated_at=? WHERE id=?`,
        [changes.localDate ?? session.local_date, changes.localDate ? 'USER_SELECTED' : session.local_date_source,
          changes.durationMinutes ?? session.duration_minutes, new Date().toISOString(), id])
      await rebuildTrainingState(tx, [session.local_date, changes.localDate ?? session.local_date],
        session.training_plan_run_day_id ? [session.training_plan_run_day_id] : [])
      return fromRow((await tx.query<SessionRow>('SELECT * FROM training_sessions WHERE id=?', [id]))[0]!)
    })
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const session = (await tx.query<SessionRow>('SELECT * FROM training_sessions WHERE id=?', [id]))[0]
      if (!session) return
      await tx.run('DELETE FROM workout_feedback WHERE training_session_id=?', [id])
      await tx.run('DELETE FROM training_sessions WHERE id=?', [id])
      await rebuildTrainingState(tx, [session.local_date], session.training_plan_run_day_id ? [session.training_plan_run_day_id] : [])
    })
  }
}
