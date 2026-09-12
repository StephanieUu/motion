import { addLocalDays, localDateAtStart } from '@motion/domain'
import type { SqlAccess, SqlRow } from '../sqlite/Database'
import { refreshRunProgress } from './TrainingPlanRepository'

interface SessionRow extends SqlRow {
  id: string; local_date: string; duration_minutes: number | null; session_origin: string
  completion_status: string | null; mini_routine_version_id: string | null
  mini_routine_required_items_confirmed: number; training_plan_run_day_id: string | null
  workout_content_id: string | null; started_at: string
}

// Rebuild only facts touched by a session correction. Streak continuity is a
// read of the daily facts, so even a historical change is reflected atomically.
export async function rebuildTrainingState(
  tx: SqlAccess,
  affectedDates: readonly string[],
  affectedRunDayIds: readonly string[] = [],
): Promise<void> {
  const now = new Date().toISOString()
  const today = localDateAtStart(new Date())
  const preference = await tx.query<{ minimum_effective_minutes: number }>(
    'SELECT minimum_effective_minutes FROM app_preference WHERE singleton_key=1')
  const threshold = preference[0]?.minimum_effective_minutes ?? 6

  for (const date of new Set(affectedDates)) {
    const sessions = await tx.query<SessionRow>(
      "SELECT * FROM training_sessions WHERE local_date=? AND lifecycle_status='COMPLETED' ORDER BY started_at", [date])
    let minutes = 0
    let type = 'NONE'
    for (const session of sessions) {
      const mini = session.mini_routine_version_id !== null && session.completion_status === 'COMPLETE'
        && session.mini_routine_required_items_confirmed === 1
      const qualifies = (session.duration_minutes ?? 0) >= threshold || mini
      const reason = mini ? 'MINI_ROUTINE_REQUIRED_ITEMS' : qualifies ? 'MINIMUM_MINUTES' : null
      await tx.run(`UPDATE training_sessions SET qualifies_for_active_day=?,qualification_reason=?,qualification_rule_version=1 WHERE id=?`,
        [qualifies ? 1 : 0, reason, session.id])
      if (qualifies) {
        minutes += session.duration_minutes ?? 0
        type = mini ? 'MINI_ROUTINE' : session.session_origin === 'RESCUE' ? 'RESCUE_TRAINING'
          : session.session_origin === 'FREE_ACTIVITY' ? 'FREE_ACTIVITY' : 'NORMAL_TRAINING'
      }
    }
    await tx.run('DELETE FROM active_days WHERE local_date=?', [date])
    if (type !== 'NONE') {
      await tx.run(`INSERT INTO active_days (local_date,qualifies,qualifying_minutes,qualification_type,calculated_at,qualification_rule_version)
        VALUES (?,1,?,?,?,1)`, [date, minutes, type, now])
    }
  }

  const runIds = new Set<string>()
  for (const id of new Set(affectedRunDayIds)) {
    const days = await tx.query<{ id: string; training_plan_run_id: string; status: string; workout_content_id: string | null }>(
      `SELECT rd.id, rd.training_plan_run_id, rd.status,
        (SELECT workout_content_id FROM training_plan_day_items WHERE training_plan_day_id=rd.training_plan_day_id AND role='PRIMARY' LIMIT 1) AS workout_content_id
       FROM training_plan_run_days rd WHERE rd.id=?`, [id])
    const day = days[0]
    if (!day) continue
    runIds.add(day.training_plan_run_id)
    if (day.status === 'SKIPPED' || day.status === 'PLANNED_REST') continue
    const completed = (await tx.query<SessionRow>(
      "SELECT * FROM training_sessions WHERE training_plan_run_day_id=? AND lifecycle_status='COMPLETED' ORDER BY started_at DESC LIMIT 1", [id]))[0]
    const inProgress = await tx.query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM training_sessions WHERE training_plan_run_day_id=? AND lifecycle_status='IN_PROGRESS'", [id])
    if (completed) {
      const status = completed.completion_status === 'COMPLETE' ? 'COMPLETED' : 'PARTIALLY_COMPLETED'
      const kind = completed.workout_content_id === day.workout_content_id ? 'PLANNED' : 'REPLACEMENT'
      const existing = await tx.query<{ plan_equivalence: string | null }>('SELECT plan_equivalence FROM training_plan_run_days WHERE id=?', [id])
      const equivalence = kind === 'PLANNED' ? (status === 'COMPLETED' ? 'FULL' : 'PARTIAL') : existing[0]?.plan_equivalence ?? 'NONE'
      await tx.run('UPDATE training_plan_run_days SET status=?,execution_kind=?,plan_equivalence=?,completed_at=?,updated_at=? WHERE id=?',
        [status, kind, equivalence, now, now, id])
    } else {
      await tx.run("UPDATE training_plan_run_days SET status=?,execution_kind='NONE',plan_equivalence=NULL,completed_at=NULL,updated_at=? WHERE id=?",
        [(inProgress[0]?.count ?? 0) > 0 ? 'IN_PROGRESS' : 'SCHEDULED', now, id])
    }
  }
  for (const runId of runIds) await refreshRunProgress(tx, runId)

  const active = await tx.query<{ local_date: string }>('SELECT local_date FROM active_days WHERE qualifies=1 ORDER BY local_date')
  const activeDates = new Set(active.map((row) => row.local_date))
  const rest = await tx.query<{ scheduled_local_date: string }>("SELECT scheduled_local_date FROM training_plan_run_days WHERE status='PLANNED_REST'")
  const used = await tx.query<{ local_date: string }>("SELECT local_date FROM streak_protection_events WHERE type='USED'")
  const preserved = new Set([...rest.map((row) => row.scheduled_local_date), ...used.map((row) => row.local_date)])
  const dates = [...activeDates, ...preserved].sort()
  const throughDate = activeDates.has(today) || preserved.has(today) ? today : addLocalDays(today, -1)
  let streak = 0
  let longest = 0
  let lastQualifiedDate: string | null = null
  if (dates[0]) {
    for (let date = dates[0]; date <= throughDate; date = addLocalDays(date, 1)) {
      if (activeDates.has(date)) {
        streak += 1
        longest = Math.max(longest, streak)
        lastQualifiedDate = date
      } else if (!preserved.has(date)) streak = 0
    }
  }
  const ledger = await tx.query<{ balance: number }>('SELECT COALESCE(SUM(balance_delta),0) AS balance FROM streak_protection_events')
  const balance = ledger[0]?.balance ?? 0
  if (balance < 0 || balance > 1) throw new Error('Protection balance must be 0 or 1')
  await tx.run(`UPDATE streak_state SET current_streak=?,longest_streak=?,protection_balance=?,last_qualified_date=?,updated_at=? WHERE singleton_key=1`,
    [streak, longest, balance, lastQualifiedDate, now])
  await tx.run(`UPDATE weekly_goals SET
    achieved_active_days=(SELECT COUNT(*) FROM active_days a WHERE a.qualifies=1 AND a.local_date BETWEEN weekly_goals.week_start_date AND date(weekly_goals.week_start_date,'+6 days')),
    status=CASE
      WHEN (SELECT COUNT(*) FROM active_days a WHERE a.qualifies=1 AND a.local_date BETWEEN weekly_goals.week_start_date AND date(weekly_goals.week_start_date,'+6 days')) >= target_active_days THEN 'COMPLETED'
      WHEN date(week_start_date,'+6 days') < ? THEN 'MISSED' ELSE 'ACTIVE' END`, [today])
}
