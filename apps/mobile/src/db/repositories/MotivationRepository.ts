import { addLocalDays, localDateAtStart } from '@motion/domain'
import type { Database, SqlAccess } from '../sqlite/Database'
import { rebuildTrainingState } from './rebuildTrainingState'

export interface MotivationState {
  localDate: string
  currentStreak: number
  longestStreak: number
  protectionBalance: number
  weeklyGoal: { achieved: number; target: number; weekStart: string }
  activeToday: boolean
  plannedRestToday: boolean
  rescueTime: number | null
  notificationsEnabled: boolean
  rescueActive: boolean
  neverMissTwice: boolean
  protectionEligibleDate: string | null
}

function weekStart(date: string, firstDay: number): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  return addLocalDays(date, -((weekday - firstDay + 7) % 7))
}

async function dateFacts(tx: SqlAccess, date: string) {
  const [active, rest, used] = await Promise.all([
    tx.query<{ local_date: string }>('SELECT local_date FROM active_days WHERE local_date=? AND qualifies=1', [date]),
    tx.query<{ id: string }>("SELECT id FROM training_plan_run_days WHERE scheduled_local_date=? AND status='PLANNED_REST' LIMIT 1", [date]),
    tx.query<{ id: string }>("SELECT id FROM streak_protection_events WHERE local_date=? AND type='USED' LIMIT 1", [date]),
  ])
  return { active: active.length > 0, rest: rest.length > 0, used: used.length > 0 }
}

// A rest day scheduled on the current plan is valid for Rescue, but it has not
// been recorded as PLANNED_REST and must not preserve a completed streak.
async function scheduledRestOnCurrentPlan(tx: SqlAccess, date: string): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(`SELECT rd.id FROM training_plan_run_days rd
    JOIN training_plan_days pd ON pd.id=rd.training_plan_day_id
    JOIN training_plan_runs r ON r.id=rd.training_plan_run_id
    WHERE rd.scheduled_local_date=? AND rd.status='SCHEDULED'
      AND pd.is_rest_day=1 AND r.status IN ('ACTIVE','PAUSED') LIMIT 1`, [date])
  return rows.length > 0
}

async function hasUnbrokenChainBefore(tx: SqlAccess, date: string): Promise<boolean> {
  let cursor = addLocalDays(date, -1)
  for (let i = 0; i < 3650; i++) {
    const facts = await dateFacts(tx, cursor)
    if (facts.active) return true
    if (!facts.rest && !facts.used) return false
    cursor = addLocalDays(cursor, -1)
  }
  return false
}

export class MotivationRepository {
  constructor(private readonly db: Database, private readonly clock: () => Date = () => new Date()) {}

  async state(): Promise<MotivationState> {
    const now = this.clock()
    const localDate = localDateAtStart(now)
    const preference = (await this.db.query<{ first_day_of_week: number; rescue_notifications_enabled: number;
      rescue_local_minute_of_day: number | null }>('SELECT * FROM app_preference WHERE singleton_key=1'))[0]
    const start = weekStart(localDate, preference?.first_day_of_week ?? 1)
    await this.db.transaction((tx) => rebuildTrainingState(tx, [], [], now))
    const [streak, goal, today, yesterday, scheduledRestToday] = await Promise.all([
      this.db.query<{ current_streak: number; longest_streak: number; protection_balance: number }>(
        'SELECT * FROM streak_state WHERE singleton_key=1'),
      this.db.query<{ target_active_days: number; achieved_active_days: number }>(
        'SELECT * FROM weekly_goals WHERE week_start_date=?', [start]),
      dateFacts(this.db, localDate), dateFacts(this.db, addLocalDays(localDate, -1)),
      scheduledRestOnCurrentPlan(this.db, localDate),
    ])
    const previous = addLocalDays(localDate, -1)
    const hasChain = !yesterday.active && !yesterday.rest && !yesterday.used
      ? await hasUnbrokenChainBefore(this.db, previous) : false
    const minutes = now.getHours() * 60 + now.getMinutes()
    const rescueTime = preference?.rescue_local_minute_of_day ?? null
    const plannedRestToday = today.rest || scheduledRestToday
    const rescueActive = rescueTime !== null && minutes >= rescueTime && !today.active && !plannedRestToday
    const todayProtectionEligible = rescueActive && !today.used && !hasChain
      && await hasUnbrokenChainBefore(this.db, localDate)
    const neverMissTwice = rescueActive && !yesterday.active && !yesterday.rest && !yesterday.used
    return { localDate, currentStreak: streak[0]?.current_streak ?? 0,
      longestStreak: streak[0]?.longest_streak ?? 0, protectionBalance: streak[0]?.protection_balance ?? 0,
      weeklyGoal: { achieved: goal[0]?.achieved_active_days ?? 0, target: goal[0]?.target_active_days ?? 5,
        weekStart: start }, activeToday: today.active, plannedRestToday,
      rescueTime, notificationsEnabled: preference?.rescue_notifications_enabled === 1,
      rescueActive, neverMissTwice,
      protectionEligibleDate: streak[0]?.protection_balance === 1
        ? hasChain ? previous : todayProtectionEligible ? localDate : null : null }
  }

  async configureRescue(localMinuteOfDay: number | null, notificationsEnabled: boolean): Promise<void> {
    if (localMinuteOfDay !== null && (!Number.isInteger(localMinuteOfDay) || localMinuteOfDay < 0 || localMinuteOfDay > 1439))
      throw new Error('Invalid local Rescue time')
    if (notificationsEnabled && localMinuteOfDay === null) throw new Error('Choose a Rescue time first')
    await this.db.run(`UPDATE app_preference SET rescue_local_minute_of_day=?,rescue_notifications_enabled=?
      WHERE singleton_key=1`, [localMinuteOfDay, notificationsEnabled ? 1 : 0])
  }

  async notificationDates(days = 7, includeElapsedToday = false): Promise<Array<{ localDate: string; at: Date }>> {
    const now = this.clock()
    const localToday = localDateAtStart(now)
    const preference = (await this.db.query<{ rescue_notifications_enabled: number;
      rescue_local_minute_of_day: number | null }>('SELECT * FROM app_preference WHERE singleton_key=1'))[0]
    if (preference?.rescue_notifications_enabled !== 1 || preference.rescue_local_minute_of_day === null) return []
    await this.db.transaction((tx) => rebuildTrainingState(tx, [], [], now))
    const result: Array<{ localDate: string; at: Date }> = []
    for (let offset = 0; offset < days; offset++) {
      const localDate = addLocalDays(localToday, offset)
      const [facts, scheduledRest] = await Promise.all([
        dateFacts(this.db, localDate),
        scheduledRestOnCurrentPlan(this.db, localDate),
      ])
      const inProgress = offset === 0 ? await this.db.query<{ id: string }>(
        "SELECT id FROM training_sessions WHERE lifecycle_status='IN_PROGRESS' AND local_date=? LIMIT 1", [localDate]) : []
      if (facts.active || facts.rest || facts.used || scheduledRest || inProgress.length) continue
      const at = new Date(`${localDate}T00:00:00`)
      at.setHours(Math.floor(preference.rescue_local_minute_of_day / 60),
        preference.rescue_local_minute_of_day % 60, 0, 0)
      if (at <= now && !(includeElapsedToday && offset === 0)) continue
      result.push({ localDate, at })
    }
    return result
  }

  async useProtection(localDate: string): Promise<void> {
    const at = this.clock()
    const today = localDateAtStart(at)
    if (localDate !== addLocalDays(today, -1) && localDate !== today)
      throw new Error('Protection can only cover today or yesterday')
    await this.db.transaction(async (tx) => {
      if (localDate === today) {
        const preference = (await tx.query<{ rescue_local_minute_of_day: number | null }>(
          'SELECT rescue_local_minute_of_day FROM app_preference WHERE singleton_key=1'))[0]
        if (preference?.rescue_local_minute_of_day === null || preference?.rescue_local_minute_of_day === undefined
          || at.getHours() * 60 + at.getMinutes() < preference.rescue_local_minute_of_day)
          throw new Error('Today is not yet eligible for Protection')
      }
      const missed = await dateFacts(tx, localDate)
      if (missed.active || missed.rest || missed.used) throw new Error('Date is already covered')
      if (!await hasUnbrokenChainBefore(tx, localDate)) throw new Error('No continuous streak to protect')
      const balance = (await tx.query<{ balance: number }>(
        'SELECT COALESCE(SUM(balance_delta),0) AS balance FROM streak_protection_events'))[0]?.balance ?? 0
      if (balance !== 1) throw new Error('No Protection available')
      const source = (await tx.query<{ source_key: string }>(
        "SELECT source_key FROM streak_protection_events WHERE type='EARNED' ORDER BY local_date DESC,created_at DESC LIMIT 1"))[0]
      await tx.run(`INSERT INTO streak_protection_events
        (id,type,local_date,reason,balance_delta,source_key,created_at)
        VALUES (?,'USED',?,'EXPLICIT_USER_ACTION',-1,?,?)`,
      [crypto.randomUUID(), localDate, source?.source_key ?? null, this.clock().toISOString()])
      await rebuildTrainingState(tx, [], [], this.clock())
    })
  }
}
