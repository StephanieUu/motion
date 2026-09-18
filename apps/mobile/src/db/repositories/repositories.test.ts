// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Database, type SqlDriver, type SqlRow, type SqlValue } from '../sqlite/Database'
import { migrateDatabase, migrations } from '../migrations'
import { WorkoutRepository } from './WorkoutRepository'
import { TrainingPlanRepository } from './TrainingPlanRepository'
import { TrainingSessionRepository } from './TrainingSessionRepository'
import { addLocalDays, localDateAtStart } from '@motion/domain'
import { ActivityRepository } from './ActivityRepository'
import { PreferenceRepository } from './PreferenceRepository'
import { SqliteTrainingLibrary, parseWorkoutUrl, sourceTypeFromUrl } from '../../features/training/trainingLibrary'
import { WorkoutImportRepository } from './WorkoutImportRepository'
import { TrainingExecution } from '../../features/training/trainingExecution'
import { TodayRecommendations } from '../../features/today/todayRecommendations'
import { RecommendationRepository } from './RecommendationRepository'
import { MotivationRepository } from './MotivationRepository'
import { rebuildTrainingState } from './rebuildTrainingState'
import { movements, composeMiniRoutine } from '../../features/motivation/miniRoutine'
import { deriveCurrentPlanProgress, deriveTodayActivities, deriveTodayProvenance } from '../../features/today/todayModel'

class NodeDriver implements SqlDriver {
  constructor(readonly sqlite: DatabaseSync) {}
  async query<T extends SqlRow>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.sqlite.prepare(sql).all(...values) as T[]
  }
  async run(sql: string, values: SqlValue[] = []): Promise<void> {
    this.sqlite.prepare(sql).run(...values)
  }
  async execute(sql: string): Promise<void> { this.sqlite.exec(sql) }
  async begin(): Promise<void> { this.sqlite.exec('BEGIN IMMEDIATE') }
  async commit(): Promise<void> { this.sqlite.exec('COMMIT') }
  async rollback(): Promise<void> { this.sqlite.exec('ROLLBACK') }
}

const opened: DatabaseSync[] = []
const directories: string[] = []
function open(path = ':memory:') {
  const sqlite = new DatabaseSync(path)
  opened.push(sqlite)
  return { sqlite, db: new Database(new NodeDriver(sqlite)) }
}
afterEach(() => {
  vi.useRealTimers()
  opened.splice(0).forEach((sqlite) => sqlite.close())
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

describe('M6 motivation, rescue and local data migration', () => {
  it('loads every completed session for Today across origins with recorded actual durations', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 12))
    const { db } = await ready()
    const workouts = new WorkoutRepository(db)
    const free = await workouts.create({ contentKind: 'FREE_ACTIVITY', sourceType: 'MANUAL',
      title: '快走', durationMinutes: 30 })
    const library = await workouts.create({ contentKind: 'FOLLOW_ALONG', sourceType: 'YOUTUBE',
      title: 'anna hiit', durationMinutes: 20 })
    const sessions = new TrainingSessionRepository(db)
    const first = await sessions.start({ workoutContentId: free.id, sessionOrigin: 'FREE_ACTIVITY' })
    await sessions.complete(first.id, { durationMinutes: 7, completionStatus: 'COMPLETE' })
    const second = await sessions.start({ workoutContentId: library.id, sessionOrigin: 'EXISTING_LIBRARY' })
    await sessions.complete(second.id, { durationMinutes: 2, completionStatus: 'COMPLETE' })
    const snapshot = await new TrainingExecution(db).load()
    expect(snapshot.completedActivities?.map((item) => item.session.id).sort()).toEqual([first.id, second.id].sort())
    expect(snapshot.completedActivities?.map((item) => item.origin).sort()).toEqual(['EXISTING_LIBRARY', 'FREE_ACTIVITY'])
    const view = deriveTodayActivities(snapshot, '2026-09-14')
    expect(view).toMatchObject({ count: 2, totalMinutes: 9, totalLabel: '9 分钟' })
    expect(view.entries.map((item) => [item.title, item.actualMinutes]).sort()).toEqual([
      ['anna hiit', 2], ['快走', 7],
    ])
  })

  async function completedOn(db: Database, date: string, origin: 'FREE_ACTIVITY' | 'RESCUE' = 'FREE_ACTIVITY') {
    const sessions = new TrainingSessionRepository(db)
    const started = await sessions.start({ sessionOrigin: origin, userSelectedLocalDate: date })
    return sessions.complete(started.id, { durationMinutes: 6, completionStatus: 'COMPLETE' })
  }

  it('awards one Protection at seven real active days and rebuilds idempotently', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 20, 12))
    const { db } = await ready()
    for (let offset = -6; offset <= 0; offset++) await completedOn(db, addLocalDays('2026-09-20', offset))
    const motivation = new MotivationRepository(db, () => new Date(2026, 8, 20, 12))
    expect(await motivation.state()).toMatchObject({ currentStreak: 7, longestStreak: 7,
      protectionBalance: 1, weeklyGoal: { achieved: 7, target: 5 } })
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM active_days'))[0]?.count).toBe(7)
    const awards = await db.query<{ source_key: string }>("SELECT source_key FROM streak_protection_events WHERE type='EARNED'")
    expect(awards).toEqual([{ source_key: 'STREAK:7' }])
    await db.transaction((tx) => rebuildTrainingState(tx, []))
    expect(await db.query<{ source_key: string }>("SELECT source_key FROM streak_protection_events WHERE type='EARNED'"))
      .toEqual(awards)
  })

  it('does not count a protected date toward the next seven-day award', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 9, 12))
    const { db } = await ready()
    for (let day = 1; day <= 7; day++) await completedOn(db, `2026-09-${String(day).padStart(2, '0')}`)
    const motivation = new MotivationRepository(db)
    await motivation.useProtection('2026-09-08')
    vi.setSystemTime(new Date(2026, 8, 15, 12))
    for (let day = 9; day <= 15; day++) await completedOn(db, `2026-09-${String(day).padStart(2, '0')}`)
    expect(await motivation.state()).toMatchObject({ currentStreak: 14, protectionBalance: 1 })
    expect(await db.query<{ source_key: string; local_date: string }>(
      "SELECT source_key,local_date FROM streak_protection_events WHERE type='EARNED' ORDER BY local_date"))
      .toEqual([{ source_key: 'STREAK:7', local_date: '2026-09-07' },
        { source_key: 'STREAK:14', local_date: '2026-09-15' }])
    expect(await db.query('SELECT * FROM active_days WHERE local_date=?', ['2026-09-08'])).toEqual([])
  })

  it('requires explicit Protection on the immediately missed date and never counts it as active', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 12))
    const { db } = await ready()
    for (let offset = -8; offset <= -2; offset++) await completedOn(db, addLocalDays('2026-09-14', offset))
    const motivation = new MotivationRepository(db, () => new Date(2026, 8, 14, 12))
    expect(await motivation.state()).toMatchObject({ currentStreak: 0, protectionBalance: 1,
      weeklyGoal: { achieved: 0 }, protectionEligibleDate: '2026-09-13' })
    expect(await db.query('SELECT * FROM active_days WHERE local_date=?', ['2026-09-13'])).toEqual([])
    await expect(motivation.useProtection('2026-09-12')).rejects.toThrow()
    await motivation.useProtection('2026-09-13')
    expect(await motivation.state()).toMatchObject({ currentStreak: 7, protectionBalance: 0,
      weeklyGoal: { achieved: 0 } })
    expect(await db.query('SELECT * FROM active_days WHERE local_date=?', ['2026-09-13'])).toEqual([])
    await expect(motivation.useProtection('2026-09-13')).rejects.toThrow()
    expect((await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM streak_protection_events WHERE type='USED'"))[0]?.count).toBe(1)
  })

  it('does not repair a chain after another unprotected miss', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 12))
    const { db } = await ready()
    for (let offset = -9; offset <= -3; offset++) await completedOn(db, addLocalDays('2026-09-14', offset))
    const motivation = new MotivationRepository(db, () => new Date(2026, 8, 14, 12))
    expect((await motivation.state()).protectionEligibleDate).toBeNull()
    await expect(motivation.useProtection('2026-09-13')).rejects.toThrow('No continuous streak')
  })

  it('retains an explicitly spent grant after an earlier session is corrected', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 12))
    const { db } = await ready()
    const history = []
    for (let offset = -8; offset <= -2; offset++) history.push(await completedOn(db, addLocalDays('2026-09-14', offset)))
    const motivation = new MotivationRepository(db)
    await motivation.useProtection('2026-09-13')
    await new TrainingSessionRepository(db).correctCompleted(history[0]!.id, { durationMinutes: 2 })
    expect((await motivation.state()).protectionBalance).toBe(0)
    expect(await db.query<{ type: string; source_key: string }>(
      'SELECT type,source_key FROM streak_protection_events ORDER BY local_date'))
      .toEqual([{ type: 'EARNED', source_key: 'STREAK:7' },
        { type: 'USED', source_key: 'STREAK:7' }])
    await db.transaction((tx) => rebuildTrainingState(tx, []))
    expect((await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM streak_protection_events WHERE type='EARNED'"))[0]?.count).toBe(1)
  })

  it('refreshes streak at a local date boundary without a session mutation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 12, 12))
    const { db } = await ready()
    await completedOn(db, '2026-09-12')
    let at = new Date(2026, 8, 12, 12)
    const motivation = new MotivationRepository(db, () => at)
    expect((await motivation.state()).currentStreak).toBe(1)
    at = new Date(2026, 8, 14, 12)
    expect((await motivation.state()).currentStreak).toBe(0)
  })

  it('allows one explicit same-day Protection after Rescue time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 18, 1))
    const { db } = await ready()
    for (let offset = -7; offset <= -1; offset++) await completedOn(db, addLocalDays('2026-09-14', offset))
    const motivation = new MotivationRepository(db, () => new Date(2026, 8, 14, 18, 1))
    await motivation.configureRescue(18 * 60, false)
    expect((await motivation.state()).protectionEligibleDate).toBe('2026-09-14')
    await motivation.useProtection('2026-09-14')
    expect(await motivation.state()).toMatchObject({ currentStreak: 7, protectionBalance: 0,
      weeklyGoal: { achieved: 0 } })
    expect((await db.query<{ source_key: string }>("SELECT source_key FROM streak_protection_events WHERE type='USED'"))[0]?.source_key).toBe('STREAK:7')
    expect(await db.query('SELECT * FROM active_days WHERE local_date=?', ['2026-09-14'])).toEqual([])
  })

  it('uses the configured local time, detects a second missed day, and keeps Rescue calm', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 18, 1))
    const { db } = await ready()
    await completedOn(db, '2026-09-12')
    const motivation = new MotivationRepository(db, () => new Date(2026, 8, 14, 18, 1))
    await motivation.configureRescue(18 * 60, false)
    expect(await motivation.state()).toMatchObject({ rescueActive: true, neverMissTwice: true,
      activeToday: false, protectionBalance: 0 })
    expect(await db.query('SELECT * FROM active_days WHERE local_date=?', ['2026-09-14'])).toEqual([])
    expect((await motivation.notificationDates()).length).toBe(0)
  })

  it('suppresses Rescue after its time on a scheduled Planned Rest day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 18, 1))
    const { db } = await ready()
    const plans = new TrainingPlanRepository(db)
    const plan = await plans.create({ title: 'Rest today', sourceType: 'MANUAL', days: [
      { dayIndex: 1, isRestDay: true },
    ] })
    await plans.startRun(plan.id, '2026-09-14')
    expect((await new TrainingExecution(db).load()).currentDay).toMatchObject({
      isRestDay: true, status: 'SCHEDULED', scheduledLocalDate: '2026-09-14',
    })
    const motivation = new MotivationRepository(db)
    await motivation.configureRescue(18 * 60, false)
    expect(await motivation.state()).toMatchObject({ plannedRestToday: true, rescueActive: false,
      activeToday: false, weeklyGoal: { achieved: 0 } })
    expect(await db.query<{ status: string }>(
      "SELECT status FROM training_plan_run_days WHERE scheduled_local_date='2026-09-14'"))
      .toEqual([{ status: 'SCHEDULED' }])
    expect(await db.query('SELECT * FROM active_days WHERE local_date=?', ['2026-09-14'])).toEqual([])
  })

  it('shows Rescue after its time without activity or Planned Rest', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 18, 1))
    const { db } = await ready()
    const motivation = new MotivationRepository(db)
    await motivation.configureRescue(18 * 60, false)
    expect(await motivation.state()).toMatchObject({ plannedRestToday: false, rescueActive: true,
      activeToday: false })
  })

  it('allows Rescue after its time when a training plan is only paused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 18, 1))
    const { db } = await ready()
    const plans = new TrainingPlanRepository(db)
    const plan = await plans.create({ title: 'Paused training', sourceType: 'MANUAL', days: [{ dayIndex: 1 }] })
    const run = await plans.startRun(plan.id, '2026-09-14')
    await plans.pause(run)
    const motivation = new MotivationRepository(db)
    await motivation.configureRescue(18 * 60, false)
    expect(await motivation.state()).toMatchObject({ plannedRestToday: false, rescueActive: true,
      activeToday: false, weeklyGoal: { achieved: 0 } })
  })

  it('keeps Rescue hidden after an active session even if the plan is later paused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 18, 1))
    const { db } = await ready()
    await completedOn(db, '2026-09-14')
    const plans = new TrainingPlanRepository(db)
    const plan = await plans.create({ title: 'Paused after training', sourceType: 'MANUAL',
      days: [{ dayIndex: 1 }] })
    const run = await plans.startRun(plan.id, '2026-09-14')
    await plans.pause(run)
    const motivation = new MotivationRepository(db)
    await motivation.configureRescue(18 * 60, false)
    expect(await motivation.state()).toMatchObject({ activeToday: true, plannedRestToday: false,
      rescueActive: false })
  })

  it('schedules only future, non-active, non-rest dates using the saved local time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 10))
    const { db } = await ready()
    const motivation = new MotivationRepository(db, () => new Date(2026, 8, 14, 10))
    await motivation.configureRescue(18 * 60 + 30, true)
    expect((await motivation.notificationDates(2)).map((item) => [item.localDate, item.at.getHours(), item.at.getMinutes()]))
      .toEqual([['2026-09-14', 18, 30], ['2026-09-15', 18, 30]])
    await completedOn(db, '2026-09-14')
    const plans = new TrainingPlanRepository(db)
    const plan = await plans.create({ title: 'Rest tomorrow', sourceType: 'MANUAL', days: [
      { dayIndex: 1, isRestDay: true },
    ] })
    await plans.startRun(plan.id, '2026-09-15')
    expect(await motivation.notificationDates(2)).toEqual([])
  })

  it('retains an elapsed but pending local alarm on an eligible paused day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 16, 14, 20))
    const { db } = await ready()
    const plans = new TrainingPlanRepository(db)
    const plan = await plans.create({ title: 'Paused', sourceType: 'MANUAL', days: [{ dayIndex: 1 }] })
    const run = await plans.startRun(plan.id, '2026-09-16')
    await plans.pause(run)
    const motivation = new MotivationRepository(db)
    await motivation.configureRescue(14 * 60 + 30, true)
    expect((await motivation.notificationDates(1)).map((item) => item.localDate)).toEqual(['2026-09-16'])
    vi.setSystemTime(new Date(2026, 8, 16, 14, 31))
    expect(await motivation.notificationDates(1)).toEqual([])
    expect((await motivation.notificationDates(1, true)).map((item) => item.localDate))
      .toEqual(['2026-09-16'])
    await completedOn(db, '2026-09-16')
    expect(await motivation.notificationDates(1, true)).toEqual([])
  })

  it('uses the current device-local date again after a manual date change', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 14, 20))
    const { db } = await ready()
    const motivation = new MotivationRepository(db)
    await motivation.configureRescue(14 * 60 + 30, true)
    expect((await motivation.notificationDates(1)).map((item) => item.localDate)).toEqual(['2026-09-14'])
    vi.setSystemTime(new Date(2026, 8, 16, 14, 20))
    expect((await motivation.notificationDates(1)).map((item) => item.localDate)).toEqual(['2026-09-16'])
  })

  it('suppresses a previously eligible reminder when today becomes Planned Rest or reminders are disabled', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 16, 14, 20))
    const { db } = await ready()
    const motivation = new MotivationRepository(db)
    await motivation.configureRescue(14 * 60 + 30, true)
    expect((await motivation.notificationDates(1)).map((item) => item.localDate)).toEqual(['2026-09-16'])
    const plans = new TrainingPlanRepository(db)
    const plan = await plans.create({ title: 'Rest', sourceType: 'MANUAL',
      days: [{ dayIndex: 1, isRestDay: true }] })
    await plans.startRun(plan.id, '2026-09-16')
    expect(await motivation.notificationDates(1, true)).toEqual([])
    await motivation.configureRescue(14 * 60 + 30, false)
    expect(await motivation.notificationDates(1, true)).toEqual([])
  })

  it('does not treat a paused plan or an ordinary missed day as preservation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 12))
    const { db } = await ready()
    await completedOn(db, '2026-09-12')
    const plans = new TrainingPlanRepository(db)
    const plan = await plans.create({ title: 'Paused', sourceType: 'MANUAL', days: [{ dayIndex: 1 }] })
    const run = await plans.startRun(plan.id, '2026-09-13')
    await plans.pause(run, new Date(2026, 8, 13, 12))
    const state = await new MotivationRepository(db).state()
    expect(state.currentStreak).toBe(0)
    expect(state.weeklyGoal.achieved).toBe(0)
    expect(await db.query('SELECT * FROM active_days WHERE local_date=?', ['2026-09-13'])).toEqual([])
  })

  it('uses the configured first day of week for the independent goal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 12))
    const { db } = await ready()
    await db.run('UPDATE app_preference SET first_day_of_week=0 WHERE singleton_key=1')
    await completedOn(db, '2026-09-13')
    expect((await new MotivationRepository(db).state()).weeklyGoal).toEqual({
      achieved: 1, target: 5, weekStart: '2026-09-13',
    })
  })

  it('routes a short library Rescue through M5 and qualifies six completed minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 18, 1))
    const { db } = await ready()
    const workout = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG',
      sourceType: 'MANUAL', durationMinutes: 8, estimatedIntensity: 'LOW', requiresEquipment: false })
    await new MotivationRepository(db).configureRescue(18 * 60, false)
    const recommendations = new TodayRecommendations(db, () => new Date(2026, 8, 14, 18, 1), () => 0.5)
    const suggested = await recommendations.suggestRescue()
    expect(suggested?.result).toMatchObject({ mode: 'RESTART', workoutContentId: workout.id })
    await recommendations.accept(suggested!)
    const execution = new TrainingExecution(db, () => new Date(2026, 8, 14, 18, 1))
    const started = await execution.startWorkout(await execution.load())
    expect((await db.query<{ session_origin: string }>('SELECT session_origin FROM training_sessions WHERE id=?', [started.id]))[0]?.session_origin).toBe('RESCUE')
    await execution.completeWorkout(started.id, 6, 'MOSTLY_COMPLETE')
    expect((await db.query<{ qualification_type: string }>('SELECT qualification_type FROM active_days WHERE local_date=?', ['2026-09-14']))[0]?.qualification_type).toBe('RESCUE_TRAINING')
    expect((await new MotivationRepository(db).state()).weeklyGoal.achieved).toBe(1)
  })

  it('composes an immutable short routine and only qualifies confirmed required steps', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 12))
    const { db } = await ready()
    expect(movements.length).toBeGreaterThanOrEqual(20)
    expect(movements.length).toBeLessThanOrEqual(30)
    expect(composeMiniRoutine(0, 5).map((item) => item.phase)).toEqual([
      'WARM_UP', 'MAIN', 'MAIN', 'MAIN', 'COOL_DOWN'])
    const execution = new TrainingExecution(db, () => new Date(2026, 8, 14, 12))
    const first = await execution.startMiniRoutine()
    const versionId = first.miniRoutineVersionId!
    expect((await execution.load()).miniRoutine?.durationMinutes).toBeLessThan(6)
    await execution.completeMiniRoutine(first.id, false)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM active_days'))[0]?.count).toBe(0)
    const second = await execution.startMiniRoutine()
    await execution.completeMiniRoutine(second.id, true)
    expect((await execution.sessions.get(second.id))?.qualifiesForActiveDay).toBe(true)
    expect((await db.query<{ mini_routine_version_id: string }>('SELECT mini_routine_version_id FROM training_sessions WHERE id=?', [second.id]))[0]?.mini_routine_version_id).toBe(second.miniRoutineVersionId)
    await expect(db.run('UPDATE mini_routine_items SET movement_name=? WHERE mini_routine_version_id=?',
      ['Changed', versionId])).rejects.toThrow()
  })

  it('rebuilds weekly, streak and unused award after historical correction or deletion', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 20, 12))
    const { db } = await ready()
    const sessions = []
    for (let offset = -6; offset <= 0; offset++) sessions.push(await completedOn(db, addLocalDays('2026-09-20', offset)))
    await new TrainingSessionRepository(db).correctCompleted(sessions[0]!.id, { durationMinutes: 3 })
    expect((await new TrainingSessionRepository(db).get(sessions[0]!.id))?.qualifiesForActiveDay).toBe(false)
    expect(await new MotivationRepository(db).state()).toMatchObject({ currentStreak: 6,
      protectionBalance: 0, weeklyGoal: { achieved: 6 } })
    expect((await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM streak_protection_events WHERE type='EARNED'"))[0]?.count).toBe(0)
    await new TrainingSessionRepository(db).remove(sessions[1]!.id)
    expect(await new MotivationRepository(db).state()).toMatchObject({ currentStreak: 5,
      weeklyGoal: { achieved: 5 } })
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([])
  })

  it('upgrades a populated version-five database without enabling notifications', async () => {
    const { db } = open()
    expect(await migrateDatabase(db, migrations.slice(0, 5))).toBe(5)
    await db.run(`INSERT INTO workout_contents (id,content_kind,title,source_type,created_at,updated_at)
      VALUES ('m5-workout','FOLLOW_ALONG','Saved','MANUAL','2026-01-01','2026-01-01')`)
    await db.run(`INSERT INTO training_plans (id,title,source_type,created_at)
      VALUES ('m5-plan','Saved plan','MANUAL','2026-01-01')`)
    await db.run(`INSERT INTO training_plan_days (id,training_plan_id,day_index,is_rest_day)
      VALUES ('m5-plan-day','m5-plan',1,0)`)
    await db.run(`INSERT INTO training_plan_day_items (id,training_plan_day_id,workout_content_id,sort_order,role)
      VALUES ('m5-plan-item','m5-plan-day','m5-workout',0,'PRIMARY')`)
    await db.run(`INSERT INTO training_plan_runs (id,training_plan_id,started_on,status,current_day_index)
      VALUES ('m5-run','m5-plan','2026-09-12','COMPLETED',1)`)
    await db.run(`INSERT INTO training_plan_run_days
      (id,training_plan_run_id,training_plan_day_id,original_scheduled_local_date,
        scheduled_local_date,status,execution_kind,plan_equivalence,updated_at)
      VALUES ('m5-run-day','m5-run','m5-plan-day','2026-09-12','2026-09-12','COMPLETED','PLANNED','FULL','2026-09-12')`)
    const otherId = (await db.query<{ id: string }>("SELECT id FROM activity_types WHERE system_key='OTHER'"))[0]!.id
    await db.run(`INSERT INTO training_sessions
      (id,local_date,local_date_source,started_at,ended_at,duration_minutes,workout_content_id,
        activity_type_id,training_plan_run_day_id,session_origin,lifecycle_status,completion_status,
        qualifies_for_active_day,created_at,updated_at)
      VALUES ('m5-session','2026-09-12','USER_SELECTED','2026-09-12','2026-09-12',8,
        'm5-workout',?,'m5-run-day','PLAN','COMPLETED','COMPLETE',1,'2026-09-12','2026-09-12')`, [otherId])
    await db.run(`INSERT INTO daily_recommendations
      (id,local_date,recommendation_mode,recommendation_source,selected_workout_content_id,status,created_at)
      VALUES ('m5-rec','2026-09-14','NORMAL','LIBRARY','m5-workout','ACCEPTED','2026-09-14')`)
    await db.run(`INSERT INTO today_pending_selections (local_date,workout_content_id,selected_at)
      VALUES ('2026-09-14','m5-workout','2026-09-14')`)
    expect(await migrateDatabase(db)).toBe(9)
    expect((await db.query<{ rescue_notifications_enabled: number; rescue_local_minute_of_day: number | null }>(
      'SELECT rescue_notifications_enabled,rescue_local_minute_of_day FROM app_preference'))[0])
      .toEqual({ rescue_notifications_enabled: 0, rescue_local_minute_of_day: null })
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM today_pending_selections'))[0]?.count).toBe(1)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM daily_recommendations'))[0]?.count).toBe(1)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_plans'))[0]?.count).toBe(1)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_plan_run_days'))[0]?.count).toBe(1)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_sessions'))[0]?.count).toBe(1)
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([])
  })
})

describe('M5 recommendation persistence and execution', () => {
  const clock = () => new Date(2026, 8, 13, 12)
  const request = { mood: 'NORMAL', intensity: 'AUTO', duration: '15_30', novelty: 'MIXED' } as const

  it('keeps the original plan day and creates no session until Start, then links the recommendation', async () => {
    const { db } = await ready()
    const workouts = new WorkoutRepository(db)
    const planned = await workouts.create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL', title: '计划训练', durationMinutes: 20 })
    const actual = await workouts.create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL', title: '替换训练', durationMinutes: 20 })
    const execution = new TrainingExecution(db, clock)
    const plan = await execution.createPlan('Seven days', [{ dayIndex: 1,
      items: [{ workoutContentId: planned.id, role: 'PRIMARY' }] }])
    const runId = await execution.startPlan(plan.id)
    const recommendations = new TodayRecommendations(db, clock, () => 0.5)
    const suggested = await recommendations.suggest(request)
    expect(suggested?.result).toMatchObject({ mode: 'SWAP', workoutContentId: actual.id })
    await recommendations.accept(suggested!)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_sessions'))[0]?.count).toBe(0)
    const day = (await execution.plans.getRunDayViews(runId))[0]!
    expect(day.primaryWorkoutId).toBe(planned.id)
    const chosen = await execution.load()
    expect(chosen.pendingWorkoutId).toBe(actual.id)
    expect(deriveTodayProvenance(chosen, '2026-09-13')).toMatchObject({
      kind: 'RECOMMENDED_REPLACEMENT', originalWorkout: { id: planned.id } })
    const session = await execution.startWorkout(await execution.load())
    expect(session.trainingPlanRunDayId).toBe(day.id)
    expect(session.workoutContentId).toBe(actual.id)
    expect((await db.query<{ daily_recommendation_id: string }>(
      'SELECT daily_recommendation_id FROM training_sessions WHERE id=?', [session.id]))[0]?.daily_recommendation_id).toBe(suggested!.id)
    await execution.completeWorkout(session.id, 20, 'COMPLETE', 'PARTIAL')
    expect((await execution.plans.getRunDayViews(runId))[0]).toMatchObject({
      primaryWorkoutId: planned.id, executionKind: 'REPLACEMENT', planEquivalence: 'PARTIAL' })
    expect((await recommendations.latest())).toBeNull()
    expect((await db.query<{ status: string }>('SELECT status FROM daily_recommendations WHERE id=?', [suggested!.id]))[0]?.status).toBe('COMPLETED')
  })

  it('persists accepted pending selection and M0–M4 content across reopen without migration', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'motion-m5-'))
    directories.push(directory)
    const file = join(directory, 'motion.db')
    const first = open(file)
    await migrateDatabase(first.db)
    first.sqlite.exec("CREATE TABLE m0_storage_probe (probe_key TEXT PRIMARY KEY, probe_value TEXT); INSERT INTO m0_storage_probe VALUES ('installation','retained')")
    const workout = await new WorkoutRepository(first.db).create({ contentKind: 'FREE_ACTIVITY', sourceType: 'MANUAL', title: '快走', durationMinutes: 20 })
    const another = await new WorkoutRepository(first.db).create({ contentKind: 'FOLLOW_ALONG', sourceType: 'BILIBILI', title: '有氧训练', durationMinutes: 20 })
    const service = new TodayRecommendations(first.db, clock, () => 0.5)
    const suggestion = await service.suggest(request)
    expect([workout.id, another.id]).toContain(suggestion?.result.workoutContentId)
    await service.accept(suggestion!)
    first.sqlite.close(); opened.splice(opened.indexOf(first.sqlite), 1)
    const second = open(file)
    expect(await migrateDatabase(second.db)).toBe(9)
    const restored = new TodayRecommendations(second.db, clock)
    expect((await restored.latest())?.status).toBe('ACCEPTED')
    expect((await restored.latest())?.result.workoutContentId).toBe(suggestion!.result.workoutContentId)
    expect((await new TrainingExecution(second.db, clock).load()).pendingWorkoutId).toBe(suggestion!.result.workoutContentId)
    expect(deriveTodayProvenance(await new TrainingExecution(second.db, clock).load(), '2026-09-13'))
      .toMatchObject({ kind: 'TODAY_RECOMMENDED' })
    expect((await second.db.query<{ probe_value: string }>('SELECT probe_value FROM m0_storage_probe'))[0]?.probe_value).toBe('retained')
    expect((await new WorkoutRepository(second.db).listLibrary()).length).toBe(2)
    expect(await second.db.query('PRAGMA foreign_key_check')).toEqual([])
  })

  it('restores recommended replacement provenance against the unchanged plan after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'motion-m5-swap-'))
    directories.push(directory)
    const file = join(directory, 'motion.db')
    const first = open(file)
    await migrateDatabase(first.db)
    const workouts = new WorkoutRepository(first.db)
    const planned = await workouts.create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL',
      title: '计划训练', durationMinutes: 20 })
    const replacement = await workouts.create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL',
      title: '替换训练', durationMinutes: 20 })
    const execution = new TrainingExecution(first.db, clock)
    const plan = await execution.createPlan('Plan', [{ dayIndex: 1,
      items: [{ workoutContentId: planned.id, role: 'PRIMARY' }] }])
    await execution.startPlan(plan.id)
    const service = new TodayRecommendations(first.db, clock, () => 0.5)
    const suggested = await service.suggest(request)
    expect(suggested?.result.workoutContentId).toBe(replacement.id)
    await service.accept(suggested!)
    first.sqlite.close(); opened.splice(opened.indexOf(first.sqlite), 1)
    const reopened = open(file)
    await migrateDatabase(reopened.db)
    const restored = await new TrainingExecution(reopened.db, clock).load()
    expect(restored.currentDay?.primaryWorkoutId).toBe(planned.id)
    expect(restored.selectionOrigin).toBe('RECOMMENDATION')
    expect(deriveTodayProvenance(restored, '2026-09-13')).toMatchObject({
      kind: 'RECOMMENDED_REPLACEMENT', originalWorkout: { id: planned.id } })
    const started = await new TrainingExecution(reopened.db, clock).startWorkout(restored)
    reopened.sqlite.close(); opened.splice(opened.indexOf(reopened.sqlite), 1)
    const resumed = open(file)
    await migrateDatabase(resumed.db)
    const inProgress = await new TrainingExecution(resumed.db, clock).load()
    expect(inProgress.session?.id).toBe(started.id)
    expect(deriveTodayProvenance(inProgress, '2026-09-13')).toMatchObject({
      kind: 'RECOMMENDED_REPLACEMENT', originalWorkout: { id: planned.id } })
  })

  it('selects an ActivityType as a Free Activity without a session and restores it after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'motion-m5-activity-'))
    directories.push(directory)
    const file = join(directory, 'motion.db')
    const first = open(file)
    await migrateDatabase(first.db)
    const service = new TodayRecommendations(first.db, clock, () => 0.5)
    const idea = await service.suggest(request, true)
    expect(idea?.workout).toBeNull()
    const chosen = await service.chooseActivity(idea!)
    expect(chosen).toMatchObject({ status: 'ACCEPTED', recommendationSource: 'EXPLORATION',
      workout: { contentKind: 'FREE_ACTIVITY', sourceType: 'MANUAL',
        primaryActivityTypeId: idea!.result.activityTypeId } })
    expect(chosen.workout?.title).toBe(idea?.activityName)
    const selected = await new TrainingExecution(first.db, clock).load()
    expect(selected).toMatchObject({ pendingWorkoutId: chosen.workout!.id,
      mainWorkout: { id: chosen.workout!.id }, session: null, selectionOrigin: 'RECOMMENDATION' })
    expect(deriveTodayProvenance(selected, '2026-09-13')).toMatchObject({ kind: 'TODAY_RECOMMENDED' })
    expect((await first.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_sessions'))[0]?.count).toBe(0)
    await service.chooseActivity(idea!)
    expect((await first.db.query<{ count: number }>("SELECT COUNT(*) AS count FROM workout_contents WHERE content_kind='FREE_ACTIVITY'"))[0]?.count).toBe(1)
    first.sqlite.close(); opened.splice(opened.indexOf(first.sqlite), 1)
    const reopened = open(file)
    await migrateDatabase(reopened.db)
    expect((await new TodayRecommendations(reopened.db, clock).latest())?.workout?.id).toBe(chosen.workout?.id)
    expect((await new TrainingExecution(reopened.db, clock).load()).pendingWorkoutId).toBe(chosen.workout?.id)
    expect((await reopened.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_sessions'))[0]?.count).toBe(0)
  })

  it('reuses an equivalent active Free Activity and changes inspiration without saving the previous idea', async () => {
    const { db } = await ready()
    const service = new TodayRecommendations(db, clock, () => 0.5)
    const first = await service.suggest(request, true)
    const second = await service.suggest(request, true, first!.result.activityTypeId)
    expect(second?.result.activityTypeId).not.toBe(first?.result.activityTypeId)
    expect((await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM workout_contents WHERE content_kind='FREE_ACTIVITY'"))[0]?.count).toBe(0)
    expect((await db.query<{ status: string }>('SELECT status FROM daily_recommendations WHERE id=?',
      [first!.id]))[0]?.status).toBe('REPLACED')
    const equivalent = await new WorkoutRepository(db).create({ contentKind: 'FREE_ACTIVITY',
      sourceType: 'MANUAL', title: '已有自由活动', primaryActivityTypeId: second!.result.activityTypeId })
    const chosen = await service.chooseActivity(second!)
    expect(chosen.workout?.id).toBe(equivalent.id)
    expect((await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM workout_contents WHERE content_kind='FREE_ACTIVITY'"))[0]?.count).toBe(1)
  })

  it('keeps Planned Rest unchanged when choosing and completing a suggested Free Activity', async () => {
    const { db } = await ready()
    const planned = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG',
      sourceType: 'MANUAL', title: '计划训练' })
    const execution = new TrainingExecution(db, clock)
    const plan = await execution.createPlan('Rest first', [
      { dayIndex: 1, isRestDay: true },
      { dayIndex: 2, items: [{ workoutContentId: planned.id, role: 'PRIMARY' }] },
    ])
    const runId = await execution.startPlan(plan.id)
    const service = new TodayRecommendations(db, clock, () => 0.5)
    const idea = await service.suggest(request, true)
    expect(idea?.workout).toBeNull()
    const chosen = await service.chooseActivity(idea!)
    const selected = await execution.load()
    expect(selected.pendingWorkoutId).toBe(chosen.workout?.id)
    expect(deriveTodayProvenance(selected, '2026-09-13')).toMatchObject({ kind: 'REST_EXTRA' })
    expect((await execution.plans.getRunDayViews(runId))[0]).toMatchObject({
      status: 'SCHEDULED', isRestDay: true, primaryWorkoutId: null })
    expect(deriveCurrentPlanProgress(selected)).toMatchObject({ completedTraining: 0, totalTraining: 1 })
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_sessions'))[0]?.count).toBe(0)
    const session = await execution.startWorkout(selected)
    expect(session.trainingPlanRunDayId).toBeNull()
    await execution.completeWorkout(session.id, 20, 'COMPLETE')
    expect((await execution.plans.getRunDayViews(runId))[0]).toMatchObject({
      status: 'SCHEDULED', isRestDay: true, primaryWorkoutId: null, planEquivalence: null })
    expect(deriveCurrentPlanProgress(await execution.load())).toMatchObject({
      completedTraining: 0, totalTraining: 1 })
  })

  it('stores ActivityType-only inspiration, then links the next shared import without creating a session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 13, 12))
    const { db } = await ready()
    const service = new TodayRecommendations(db, clock, () => 0.5)
    const idea = await service.suggest(request, true)
    expect(idea?.result.workoutContentId).toBeNull()
    expect(idea?.result.activityTypeId).toBeTruthy()
    await service.findNew(idea!)
    const library = new SqliteTrainingLibrary(db)
    const imported = await library.importShare({ eventId: 'm5-quark-share', text: 'https://pan.quark.cn/s/abc', subject: null })
    expect((await db.query<{ resulting_workout_content_id: string }>(
      'SELECT resulting_workout_content_id FROM exploration_recommendations WHERE id=?', [idea!.id]))[0]?.resulting_workout_content_id)
      .toBe(imported.workoutContentId)
    expect((await service.latest())?.result.workoutContentId).toBe(imported.workoutContentId)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_sessions'))[0]?.count).toBe(0)
  })

  it('offers a matching saved workout directly for a preferred ActivityType idea', async () => {
    const { db } = await ready()
    const activities = new ActivityRepository(db)
    const aerobics = (await activities.listTypes()).find((item) => item.system_key === 'AEROBICS')!
    await activities.setExplicitPreference(aerobics.id, 'LOVE')
    const workout = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG',
      sourceType: 'BILIBILI', title: '健美操', primaryActivityTypeId: aerobics.id, durationMinutes: 20 })
    const service = new TodayRecommendations(db, clock, () => 0.5)
    const idea = await service.suggest(request, true)
    expect(idea?.result).toMatchObject({ mode: 'EXPLORATION', activityTypeId: aerobics.id,
      workoutContentId: workout.id, reasonCodes: expect.arrayContaining(['NEW_ACTIVITY']) })
    expect(idea?.recommendationSource).toBe('EXPLORATION')
    expect((await service.latest())?.recommendationSource).toBe('EXPLORATION')
    await service.accept(idea!)
    expect((await new TrainingExecution(db, clock).load()).pendingWorkoutId).toBe(workout.id)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM exploration_recommendations'))[0]?.count).toBe(0)
  })

  it('rejects acceptance after archival and does not alter pending selection', async () => {
    const { db } = await ready()
    const workout = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL', durationMinutes: 20 })
    const service = new TodayRecommendations(db, clock, () => 0.5)
    const suggested = await service.suggest(request)
    expect(suggested?.result.workoutContentId).toBe(workout.id)
    await new WorkoutRepository(db).remove(workout.id)
    await expect(service.accept(suggested!)).rejects.toThrow('not selectable')
    expect((await new TrainingExecution(db, clock).load()).pendingWorkoutId).toBeNull()
  })

  it('exposes only active preference context from the accepted schema', async () => {
    const { db } = await ready()
    const activities = new ActivityRepository(db)
    const activity = (await activities.listTypes()).find((item) => item.system_key === 'AEROBICS')!
    await activities.setExplicitPreference(activity.id, 'AVOID')
    const workout = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG',
      sourceType: 'MANUAL', durationMinutes: 20, primaryActivityTypeId: activity.id })
    const context = await new RecommendationRepository(db).context('2026-09-13', await new WorkoutRepository(db).listLibrary())
    expect(context.activities.find((item) => item.id === activity.id)?.preference).toBe('AVOID')
    expect(context.workouts.find((item) => item.id === workout.id)?.durationMinutes).toBe(20)
    expect(await new TodayRecommendations(db, clock).suggest(request)).toBeNull()
  })

  it('a manual library selection supersedes recommendation provenance, even for the same workout', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'motion-m5-manual-'))
    directories.push(directory)
    const file = join(directory, 'motion.db')
    const first = open(file)
    await migrateDatabase(first.db)
    const { db } = first
    const workout = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG',
      sourceType: 'MANUAL', durationMinutes: 20 })
    const service = new TodayRecommendations(db, clock, () => 0.5)
    const suggestion = await service.suggest(request)
    await service.accept(suggestion!)
    expect((await new TrainingExecution(db, clock).load()).selectionOrigin).toBe('RECOMMENDATION')
    await new TrainingExecution(db, clock).selectWorkout(workout.id)
    const snapshot = await new TrainingExecution(db, clock).load()
    expect(snapshot.selectionOrigin).toBe('MANUAL')
    expect(deriveTodayProvenance(snapshot, '2026-09-13')).toMatchObject({ kind: 'MANUAL' })
    expect((await db.query<{ status: string }>('SELECT status FROM daily_recommendations WHERE id=?',
      [suggestion!.id]))[0]?.status).toBe('REPLACED')
    first.sqlite.close(); opened.splice(opened.indexOf(first.sqlite), 1)
    const reopened = open(file)
    await migrateDatabase(reopened.db)
    expect(deriveTodayProvenance(await new TrainingExecution(reopened.db, clock).load(), '2026-09-13'))
      .toMatchObject({ kind: 'MANUAL' })
  })

  it('keeps a rest-day workout extra and never credits the planned training denominator', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'motion-m5-rest-'))
    directories.push(directory)
    const file = join(directory, 'motion.db')
    const first = open(file)
    await migrateDatabase(first.db)
    const { db } = first
    const workout = await new WorkoutRepository(db).create({ contentKind: 'FREE_ACTIVITY',
      sourceType: 'MANUAL', title: '快走', durationMinutes: 20 })
    const execution = new TrainingExecution(db, clock)
    const plan = await execution.createPlan('Rest first', [
      { dayIndex: 1, isRestDay: true },
      { dayIndex: 2, items: [{ workoutContentId: workout.id, role: 'PRIMARY' }] },
    ])
    const runId = await execution.startPlan(plan.id)
    await execution.selectWorkout(workout.id)
    const selected = await execution.load()
    expect(deriveTodayProvenance(selected, '2026-09-13')).toMatchObject({ kind: 'REST_EXTRA' })
    const started = await execution.startWorkout(selected)
    expect(started.trainingPlanRunDayId).toBeNull()
    expect(deriveTodayProvenance(await execution.load(), '2026-09-13')).toMatchObject({ kind: 'REST_EXTRA' })
    await execution.completeWorkout(started.id, 1, 'COMPLETE')
    const completedSnapshot = await execution.load()
    expect(completedSnapshot.completedActivities).toMatchObject([{
      session: { id: started.id, durationMinutes: 1, qualifiesForActiveDay: false },
      origin: 'FREE_ACTIVITY', recommendationSource: null,
    }])
    expect(deriveTodayActivities(completedSnapshot, '2026-09-13').entries[0]).toMatchObject({
      title: '快走', provenance: '休息日加练', actualMinutes: 1, durationLabel: '1 分钟',
    })
    expect(await db.query('SELECT * FROM active_days WHERE local_date=?', ['2026-09-13'])).toEqual([])
    const restDay = (await execution.plans.getRunDayViews(runId))[0]!
    expect(restDay).toMatchObject({ isRestDay: true, primaryWorkoutId: null,
      status: 'SCHEDULED', planEquivalence: null })
    expect(deriveCurrentPlanProgress(await execution.load())).toMatchObject({
      totalDays: 2, completedTraining: 0, totalTraining: 1 })
    await execution.rest(restDay.id)
    expect(deriveCurrentPlanProgress(await execution.load())).toMatchObject({
      totalDays: 2, completedTraining: 0, totalTraining: 1 })
    first.sqlite.close(); opened.splice(opened.indexOf(first.sqlite), 1)
    const reopened = open(file)
    await migrateDatabase(reopened.db)
    const restoredExecution = new TrainingExecution(reopened.db, clock)
    expect((await restoredExecution.plans.getRunDayViews(runId))[0]).toMatchObject({
      isRestDay: true, primaryWorkoutId: null, status: 'PLANNED_REST', planEquivalence: null })
    expect(deriveCurrentPlanProgress(await restoredExecution.load())).toMatchObject({
      totalDays: 2, completedTraining: 0, totalTraining: 1 })
  })

  it('qualifies normal workouts from recorded duration rather than estimated content duration', async () => {
    const { db } = await ready()
    const workout = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG',
      sourceType: 'MANUAL', title: 'anna hiit', durationMinutes: 20 })
    const execution = new TrainingExecution(db, clock)
    await execution.selectWorkout(workout.id)
    const short = await execution.startWorkout(await execution.load())
    expect(await execution.completeWorkout(short.id, 1, 'COMPLETE')).toMatchObject({
      durationMinutes: 1, qualifiesForActiveDay: false,
    })
    expect(await db.query('SELECT * FROM active_days WHERE local_date=?', ['2026-09-13'])).toEqual([])
    await execution.selectWorkout(workout.id)
    const enough = await execution.startWorkout(await execution.load())
    expect(await execution.completeWorkout(enough.id, 6, 'COMPLETE')).toMatchObject({
      durationMinutes: 6, qualifiesForActiveDay: true,
    })
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM active_days WHERE local_date=?',
      ['2026-09-13']))[0]?.count).toBe(1)
  })

  it('restores chronological and completed-training progress after database reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'motion-m5-progress-'))
    directories.push(directory)
    const file = join(directory, 'motion.db')
    const first = open(file)
    await migrateDatabase(first.db)
    const workout = await new WorkoutRepository(first.db).create({ contentKind: 'FOLLOW_ALONG',
      sourceType: 'MANUAL', durationMinutes: 20 })
    const execution = new TrainingExecution(first.db, clock)
    const plan = await execution.createPlan('Three days', [
      { dayIndex: 1, items: [{ workoutContentId: workout.id, role: 'PRIMARY' }] },
      { dayIndex: 2, isRestDay: true },
      { dayIndex: 3, items: [{ workoutContentId: workout.id, role: 'PRIMARY' }] },
    ])
    await execution.startPlan(plan.id)
    const started = await execution.startWorkout(await execution.load())
    await execution.completeWorkout(started.id, 20, 'COMPLETE')
    first.sqlite.close(); opened.splice(opened.indexOf(first.sqlite), 1)
    const second = open(file)
    await migrateDatabase(second.db)
    const restored = await new TrainingExecution(second.db, clock).load()
    expect(deriveCurrentPlanProgress(restored)).toMatchObject({
      position: 2, totalDays: 3, completedTraining: 1, totalTraining: 2,
      segments: [{ kind: 'COMPLETED' }, { kind: 'REST' }, { kind: 'PENDING' }] })
    expect(await second.db.query('PRAGMA foreign_key_check')).toEqual([])
  })
})

async function ready() {
  const connection = open()
  await migrateDatabase(connection.db)
  return connection
}

describe('M1 migrations', () => {
  it('upgrades an M0 database, seeds all activity types and preserves the probe', async () => {
    const { db, sqlite } = open()
    sqlite.exec("CREATE TABLE m0_storage_probe (probe_key TEXT PRIMARY KEY, probe_value TEXT, created_at TEXT); INSERT INTO m0_storage_probe VALUES ('installation','retained','2026-01-01');")
    expect(await migrateDatabase(db)).toBe(9)
    expect(await migrateDatabase(db)).toBe(9)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM activity_types'))[0]?.count).toBe(19)
    expect((await db.query<{ id: string }>("SELECT id FROM activity_types WHERE system_key='OTHER'"))[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect((await db.query<{ probe_value: string }>('SELECT probe_value FROM m0_storage_probe'))[0]?.probe_value).toBe('retained')
    expect((await db.query<{ locale: string }>('SELECT locale FROM app_preference'))[0]?.locale).toBe('zh-CN')
    expect((await db.query<{ name: string }>("SELECT name FROM activity_types WHERE system_key='AEROBICS'"))[0]?.name).toBe('健美操')
    expect((await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM activity_preferences WHERE inferred_score<0"))[0]?.count).toBe(4)
  })

  it('upgrades a version-1 historical fixture without breaking references', async () => {
    const { db, sqlite } = open()
    sqlite.exec(migrations[0]!.sql)
    sqlite.exec("PRAGMA user_version=1; INSERT INTO activity_types VALUES ('old-type','CUSTOM','Custom',0,1); INSERT INTO workout_contents (id,content_kind,source_type,primary_activity_type_id,created_at,updated_at) VALUES ('old-workout','FOLLOW_ALONG','MANUAL','old-type','2026-01-01','2026-01-01'); INSERT INTO training_sessions (id,local_date,local_date_source,started_at,ended_at,duration_minutes,workout_content_id,activity_type_id,session_origin,lifecycle_status,completion_status,created_at,updated_at) VALUES ('old-session','2026-01-01','USER_SELECTED','2026-01-01','2026-01-01',10,'old-workout','old-type','EXISTING_LIBRARY','COMPLETED','COMPLETE','2026-01-01','2026-01-01');")
    expect(await migrateDatabase(db)).toBe(9)
    expect((await db.query<{ workout_content_id: string }>('SELECT workout_content_id FROM training_sessions WHERE id=?', ['old-session']))[0]?.workout_content_id).toBe('old-workout')
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([])
  })

  it('upgrades an existing M1 database to the Chinese default without losing workouts', async () => {
    const { db, sqlite } = open()
    sqlite.exec(migrations[0]!.sql)
    sqlite.exec(migrations[1]!.sql)
    sqlite.exec("PRAGMA user_version=2; INSERT INTO workout_contents (id,content_kind,source_type,created_at,updated_at) VALUES ('saved-workout','FOLLOW_ALONG','MANUAL','2026-01-01','2026-01-01');")
    expect(await migrateDatabase(db)).toBe(9)
    expect((await db.query<{ locale: string }>('SELECT locale FROM app_preference'))[0]?.locale).toBe('zh-CN')
    expect((await db.query<{ name: string }>("SELECT name FROM activity_types WHERE system_key='OTHER'"))[0]?.name).toBe('其他')
    expect((await db.query<{ id: string }>('SELECT id FROM workout_contents WHERE id=?', ['saved-workout']))[0]?.id).toBe('saved-workout')
  })

  it('upgrades an accepted M2 database with workouts and reactions intact', async () => {
    const { db, sqlite } = open()
    for (const step of migrations.slice(0, 4)) sqlite.exec(step.sql)
    sqlite.exec("PRAGMA user_version=4; INSERT INTO workout_contents (id,content_kind,source_type,created_at,updated_at) VALUES ('m2-workout','FOLLOW_ALONG','BILIBILI','2026-01-01','2026-01-01'); INSERT INTO workout_preferences (workout_content_id,explicit_preference,updated_at) VALUES ('m2-workout','LOVE','2026-01-01');")
    expect(await migrateDatabase(db)).toBe(9)
    expect((await new WorkoutRepository(db).listLibrary()).find((item) => item.id === 'm2-workout'))
      .toMatchObject({ userPreference: 'LOVE', userVisibility: 'ACTIVE' })
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([])
  })

  it('rolls back a failed migration, keeping schema version and records', async () => {
    const { db, sqlite } = open()
    sqlite.exec("CREATE TABLE m0_storage_probe (probe_key TEXT PRIMARY KEY, probe_value TEXT); INSERT INTO m0_storage_probe VALUES ('installation','keep');")
    await expect(migrateDatabase(db, [{ version: 1, sql: 'CREATE TABLE transient (id TEXT); INSERT INTO missing_table VALUES (1);' }])).rejects.toThrow()
    expect((await db.query<{ user_version: number }>('PRAGMA user_version'))[0]?.user_version).toBe(0)
    expect((await db.query<{ probe_value: string }>('SELECT probe_value FROM m0_storage_probe'))[0]?.probe_value).toBe('keep')
    expect((await db.query('SELECT name FROM sqlite_master WHERE name=?', ['transient']))).toEqual([])
  })

  it('enforces FKs, uniqueness, singleton rows and protected OTHER', async () => {
    const { db } = await ready()
    await expect(db.run('DELETE FROM activity_types WHERE system_key=?', ['OTHER'])).rejects.toThrow()
    await expect(db.run("INSERT INTO activity_preferences (id,activity_type_id) VALUES ('bad','missing')")).rejects.toThrow()
    await expect(db.run("INSERT INTO app_preference (singleton_key) VALUES (2)")).rejects.toThrow()
    await expect(db.run("INSERT INTO activity_types (id,system_key,name) VALUES ('duplicate','OTHER','Other')")).rejects.toThrow()
    const workout = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL' })
    const plan = await new TrainingPlanRepository(db).create({ title: 'Constraints', sourceType: 'MANUAL', days: [
      { dayIndex: 1, items: [{ workoutContentId: workout.id, role: 'PRIMARY' }] },
      { dayIndex: 2, isRestDay: true },
    ] })
    const days = await db.query<{ id: string; is_rest_day: number }>('SELECT id,is_rest_day FROM training_plan_days WHERE training_plan_id=? ORDER BY day_index', [plan.id])
    await expect(db.run(`INSERT INTO training_plan_day_items (id,training_plan_day_id,workout_content_id,sort_order,role)
      VALUES ('extra',?,?,1,'PRIMARY')`, [days[0]!.id, workout.id])).rejects.toThrow()
    await expect(db.run(`INSERT INTO training_plan_day_items (id,training_plan_day_id,workout_content_id,sort_order,role)
      VALUES ('rest-item',?,?,0,'PRIMARY')`, [days[1]!.id, workout.id])).rejects.toThrow()
    await new TrainingPlanRepository(db).startRun(plan.id, '2026-09-12')
    await expect(db.run('UPDATE training_plan_days SET title=? WHERE id=?', ['Changed', days[0]!.id])).rejects.toThrow()
  })
})

describe('M1 repositories', () => {
  it('creates, updates, queries, deletes and archives referenced workouts', async () => {
    const { db } = await ready()
    const workouts = new WorkoutRepository(db)
    const first = await workouts.create({ contentKind: 'FOLLOW_ALONG', sourceType: 'BILIBILI', sourceUrl: 'https://example.com/1' })
    expect(first.title).toBeNull()
    expect((await workouts.list()).length).toBe(1)
    expect((await workouts.update(first.id, { title: 'Morning cardio' })).title).toBe('Morning cardio')
    expect(await workouts.remove(first.id)).toBe('deleted')
    const referenced = await workouts.create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL' })
    const plans = new TrainingPlanRepository(db)
    await plans.create({ title: 'One day', sourceType: 'MANUAL', days: [{ dayIndex: 1, items: [{ workoutContentId: referenced.id, role: 'PRIMARY' }] }] })
    expect(await workouts.remove(referenced.id)).toBe('archived')
    expect((await workouts.get(referenced.id))?.userVisibility).toBe('ARCHIVED')
  })

  it('stores activity and singleton preferences without changing system seeds', async () => {
    const { db } = await ready()
    const activities = new ActivityRepository(db)
    const preferences = new PreferenceRepository(db)
    const custom = await activities.createType('Hiking')
    await activities.setExplicitPreference(custom.id, 'LOVE')
    expect((await activities.getPreference(custom.id))?.explicit_preference).toBe('LOVE')
    await activities.deactivateType(custom.id)
    expect((await activities.listTypes()).find((type) => type.id === custom.id)?.is_active).toBe(0)
    await preferences.saveUserProfile({ goalType: 'MAINTENANCE', heightCm: 170 })
    await preferences.saveUserProfile({ goalType: 'MAINTENANCE', heightCm: 171 })
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM user_profile'))[0]?.count).toBe(1)
    await preferences.setMinimumEffectiveMinutes(7)
    expect((await preferences.get()).minimum_effective_minutes).toBe(7)
    expect((await activities.listTypes()).find((type) => type.system_key === 'OTHER')?.is_active).toBe(1)
  })

  it('schedules, reschedules and skips run-days without losing original dates', async () => {
    const { db } = await ready()
    const plans = new TrainingPlanRepository(db)
    const plan = await plans.create({ title: 'Three days', sourceType: 'MANUAL', days: [
      { dayIndex: 1 }, { dayIndex: 2 }, { dayIndex: 3, isRestDay: true },
    ] })
    const runId = await plans.startRun(plan.id, '2026-09-01')
    await expect(plans.startRun(plan.id, '2026-10-01')).rejects.toThrow()
    const days = await plans.getRunDays(runId)
    await plans.reschedule(days[0]!.id, '2026-09-03')
    const moved = await plans.getRunDays(runId)
    expect(moved.map((day) => day.scheduledLocalDate)).toEqual(['2026-09-03','2026-09-04','2026-09-05'])
    expect((await db.query<{ original_scheduled_local_date: string }>('SELECT original_scheduled_local_date FROM training_plan_run_days WHERE id=?', [days[0]!.id]))[0]?.original_scheduled_local_date).toBe('2026-09-01')
    await plans.skip(days[0]!.id)
    expect((await db.query<{ current_day_index: number }>('SELECT current_day_index FROM training_plan_runs WHERE id=?', [runId]))[0]?.current_day_index).toBe(2)
  })

  it('recovers an in-progress session and recalculates active day, streak, weekly goal and plan progress', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 13, 12))
    const { db } = await ready()
    const workouts = new WorkoutRepository(db)
    const plans = new TrainingPlanRepository(db)
    const sessions = new TrainingSessionRepository(db)
    const workout = await workouts.create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL' })
    const plan = await plans.create({ title: 'One day', sourceType: 'MANUAL', days: [
      { dayIndex: 1, items: [{ workoutContentId: workout.id, role: 'PRIMARY' }] },
    ] })
    const runId = await plans.startRun(plan.id, '2026-09-12')
    const runDay = (await plans.getRunDays(runId))[0]!
    await db.run("INSERT INTO weekly_goals (id,week_start_date,target_active_days,status) VALUES ('week','2026-09-07',1,'ACTIVE')")
    const started = await sessions.start({ workoutContentId: workout.id, trainingPlanRunDayId: runDay.id,
      sessionOrigin: 'PLAN', startedAt: new Date('2026-09-12T09:00:00Z'), userSelectedLocalDate: '2026-09-12' })
    expect((await sessions.getInProgress())?.id).toBe(started.id)
    await expect(sessions.start({ sessionOrigin: 'FREE_ACTIVITY' })).rejects.toThrow()
    expect((await plans.getRunDays(runId))[0]?.status).toBe('IN_PROGRESS')
    const completed = await sessions.complete(started.id, { durationMinutes: 12, completionStatus: 'COMPLETE' })
    expect(completed.qualifiesForActiveDay).toBe(true)
    expect((await sessions.complete(started.id, { durationMinutes: 12, completionStatus: 'COMPLETE' })).id).toBe(started.id)
    expect((await plans.getRunDays(runId))[0]?.status).toBe('COMPLETED')
    expect((await plans.getRunDays(runId))[0]?.planEquivalence).toBe('FULL')
    expect((await db.query<{ current_streak: number }>('SELECT current_streak FROM streak_state'))[0]?.current_streak).toBe(1)
    expect((await db.query<{ achieved_active_days: number }>('SELECT achieved_active_days FROM weekly_goals WHERE id=?', ['week']))[0]?.achieved_active_days).toBe(1)
    await sessions.correctCompleted(started.id, { durationMinutes: 3 })
    expect((await db.query<{ local_date_source: string }>('SELECT local_date_source FROM training_sessions WHERE id=?', [started.id]))[0]?.local_date_source).toBe('USER_SELECTED')
    expect((await db.query('SELECT * FROM active_days'))).toEqual([])
    expect((await db.query<{ achieved_active_days: number }>('SELECT achieved_active_days FROM weekly_goals WHERE id=?', ['week']))[0]?.achieved_active_days).toBe(0)
    await sessions.remove(started.id)
    expect((await plans.getRunDays(runId))[0]?.status).toBe('SCHEDULED')
    expect((await db.query<{ current_day_index: number }>('SELECT current_day_index FROM training_plan_runs WHERE id=?', [runId]))[0]?.current_day_index).toBe(1)
  })

  it('keeps a streak through planned rest without counting that day as active', async () => {
    const { db } = await ready()
    const today = localDateAtStart(new Date())
    const firstDate = addLocalDays(today, -2)
    const restDate = addLocalDays(today, -1)
    const plans = new TrainingPlanRepository(db)
    const sessions = new TrainingSessionRepository(db)
    const plan = await plans.create({ title: 'Rest bridge', sourceType: 'MANUAL', days: [
      { dayIndex: 1 }, { dayIndex: 2, isRestDay: true }, { dayIndex: 3 },
    ] })
    const runId = await plans.startRun(plan.id, firstDate)
    const days = await plans.getRunDays(runId)
    const first = await sessions.start({ sessionOrigin: 'PLAN', trainingPlanRunDayId: days[0]!.id, userSelectedLocalDate: firstDate })
    await sessions.complete(first.id, { durationMinutes: 8, completionStatus: 'COMPLETE' })
    await plans.completePlannedRest(days[1]!.id, restDate)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM active_days'))[0]?.count).toBe(1)
    const last = await sessions.start({ sessionOrigin: 'PLAN', trainingPlanRunDayId: days[2]!.id, userSelectedLocalDate: today })
    await sessions.complete(last.id, { durationMinutes: 8, completionStatus: 'COMPLETE' })
    expect((await db.query<{ current_streak: number }>('SELECT current_streak FROM streak_state'))[0]?.current_streak).toBe(2)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM active_days'))[0]?.count).toBe(2)
  })

  it('rolls back a historical correction and derived updates together', async () => {
    const { db, sqlite } = await ready()
    const sessions = new TrainingSessionRepository(db)
    const first = await sessions.start({ sessionOrigin: 'FREE_ACTIVITY' })
    await sessions.complete(first.id, { durationMinutes: 8, completionStatus: 'COMPLETE' })
    sqlite.exec("CREATE TRIGGER fail_active_day BEFORE DELETE ON active_days BEGIN SELECT RAISE(ABORT,'forced failure'); END;")
    await expect(sessions.correctCompleted(first.id, { durationMinutes: 2 })).rejects.toThrow('forced failure')
    expect((await sessions.get(first.id))?.durationMinutes).toBe(8)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM active_days'))[0]?.count).toBe(1)
  })

  it('recalculates the affected date while retaining independent later activity', async () => {
    const { db } = await ready()
    const sessions = new TrainingSessionRepository(db)
    const today = localDateAtStart(new Date())
    const yesterday = addLocalDays(today, -1)
    const first = await sessions.start({ sessionOrigin: 'FREE_ACTIVITY', userSelectedLocalDate: yesterday })
    await sessions.complete(first.id, { durationMinutes: 8, completionStatus: 'COMPLETE' })
    const second = await sessions.start({ sessionOrigin: 'FREE_ACTIVITY', userSelectedLocalDate: today })
    await sessions.complete(second.id, { durationMinutes: 8, completionStatus: 'COMPLETE' })
    expect((await db.query<{ current_streak: number }>('SELECT current_streak FROM streak_state'))[0]?.current_streak).toBe(2)
    await sessions.correctCompleted(first.id, { durationMinutes: 2 })
    expect((await db.query<{ local_date: string }>('SELECT local_date FROM active_days'))).toEqual([{ local_date: today }])
    expect((await sessions.get(second.id))?.qualifiesForActiveDay).toBe(true)
    expect((await db.query<{ current_streak: number }>('SELECT current_streak FROM streak_state'))[0]?.current_streak).toBe(1)
  })

  it('qualifies a short Mini Routine only after required items are confirmed', async () => {
    const { db } = await ready()
    const sessions = new TrainingSessionRepository(db)
    const workout = await new WorkoutRepository(db).create({ contentKind: 'MINI_ROUTINE', sourceType: 'APP_BUILTIN' })
    await db.run("INSERT INTO mini_routine_versions (id,workout_content_id,version_number,created_at) VALUES ('routine-v1',?,1,?)", [workout.id, new Date().toISOString()])
    await db.run("INSERT INTO mini_routine_items (id,mini_routine_version_id,sort_order,movement_name,repetitions) VALUES ('item','routine-v1',0,'Squat',10)")
    const started = await sessions.start({ sessionOrigin: 'FREE_ACTIVITY', workoutContentId: workout.id, miniRoutineVersionId: 'routine-v1' })
    await expect(sessions.complete(started.id, { durationMinutes: 3, completionStatus: 'COMPLETE' })).rejects.toThrow()
    const result = await sessions.complete(started.id, { durationMinutes: 3, completionStatus: 'COMPLETE', requiredMiniRoutineItemsConfirmed: true })
    expect(result.qualifiesForActiveDay).toBe(true)
    await expect(db.run("UPDATE mini_routine_items SET movement_name='Changed' WHERE id='item'")).rejects.toThrow()
  })

  it('persists a session through connection reopen and supports abandon', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'motion-m1-'))
    directories.push(directory)
    const file = join(directory, 'motion.db')
    const first = open(file)
    await migrateDatabase(first.db)
    const started = await new TrainingSessionRepository(first.db).start({ sessionOrigin: 'FREE_ACTIVITY' })
    first.sqlite.close()
    opened.splice(opened.indexOf(first.sqlite), 1)
    const second = open(file)
    const sessions = new TrainingSessionRepository(second.db)
    expect((await sessions.getInProgress())?.id).toBe(started.id)
    await sessions.abandon(started.id)
    expect(await sessions.getInProgress()).toBeNull()
    expect((await dbRows(second.db, 'SELECT * FROM active_days')).length).toBe(0)
  })
})

function dbRows(db: Database, sql: string) { return db.query(sql) }

describe('M2 training library persistence', () => {
  it('upgrades an accepted M1 database and preserves its workouts and sessions', async () => {
    const { db, sqlite } = open()
    for (const migration of migrations.filter((item) => item.version <= 3)) sqlite.exec(migration.sql)
    sqlite.exec("PRAGMA user_version=3; INSERT INTO workout_contents (id,content_kind,source_type,created_at,updated_at) VALUES ('old-workout','FOLLOW_ALONG','MANUAL','2026-01-01','2026-01-01');")
    expect(await migrateDatabase(db)).toBe(9)
    expect(await migrateDatabase(db)).toBe(9)
    expect((await new WorkoutRepository(db).get('old-workout'))?.id).toBe('old-workout')
    await new WorkoutRepository(db).setPreference('old-workout', 'LIKE')
    expect((await new WorkoutRepository(db).listLibrary())[0]?.userPreference).toBe('LIKE')
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([])
  })

  it('saves URL-only B站, 小红书 and 夸克 entries without invented metadata', async () => {
    const { db } = await ready()
    const library = new SqliteTrainingLibrary(db)
    for (const [url, source] of [
      ['https://www.bilibili.com/video/BV123', 'BILIBILI'],
      ['https://www.xiaohongshu.com/explore/123', 'XIAOHONGSHU'],
      ['https://pan.quark.cn/s/123', 'QUARK'],
    ] as const) {
      const saved = await library.addUrl(url)
      expect(saved).toMatchObject({ contentKind: 'FOLLOW_ALONG', sourceType: source,
        title: null, durationMinutes: null, primaryActivityTypeId: null,
        estimatedIntensity: null, userPreference: null, userVisibility: 'ACTIVE' })
      expect(saved.sourceUrl).toBe(url)
    }
    const free = await library.addFreeActivity('快走')
    expect(free).toMatchObject({ contentKind: 'FREE_ACTIVITY', sourceType: 'MANUAL',
      title: '快走', sourceUrl: null, durationMinutes: null })
    expect((await library.load()).workouts).toHaveLength(4)
    expect(sourceTypeFromUrl(parseWorkoutUrl('https://b23.tv/abc'))).toBe('BILIBILI')
    expect(sourceTypeFromUrl(parseWorkoutUrl('https://xhslink.com/abc'))).toBe('XIAOHONGSHU')
    await expect(library.addUrl('javascript:alert(1)')).rejects.toThrow()
    await expect(library.addUrl('not a URL')).rejects.toThrow()
  })

  it('updates incomplete metadata and reflects completed-session history', async () => {
    const { db } = await ready()
    const library = new SqliteTrainingLibrary(db)
    const legacy = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL' })
    const yoga = (await new ActivityRepository(db).listTypes()).find((type) => type.system_key === 'YOGA')!
    await library.update(legacy.id, { title: '拉伸', sourceUrl: '', durationMinutes: 20,
      primaryActivityTypeId: yoga.id, estimatedIntensity: 'LOW' })
    const saved = (await library.load()).workouts.find((item) => item.id === legacy.id)!
    expect(saved).toMatchObject({ title: '拉伸', sourceUrl: null, durationMinutes: 20,
      primaryActivityTypeId: yoga.id, estimatedIntensity: 'LOW', completionCount: 0 })
    const session = await new TrainingSessionRepository(db).start({ workoutContentId: legacy.id,
      sessionOrigin: 'EXISTING_LIBRARY', userSelectedLocalDate: '2026-09-12' })
    await new TrainingSessionRepository(db).complete(session.id, { durationMinutes: 20, completionStatus: 'COMPLETE' })
    const completed = (await library.load()).workouts.find((item) => item.id === legacy.id)!
    expect(completed.completionCount).toBe(1)
    expect(completed.lastCompletedAt).not.toBeNull()
  })

  it('persists reaction and temporary hide across reopen, then archives referenced content', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'motion-m2-'))
    directories.push(directory)
    const file = join(directory, 'motion.db')
    const first = open(file)
    await migrateDatabase(first.db)
    const library = new SqliteTrainingLibrary(first.db)
    const workout = await library.addUrl('https://www.bilibili.com/video/BV456')
    await library.setPreference(workout.id, 'LOVE')
    await library.setPreference(workout.id, 'DISLIKE')
    await library.setVisibility(workout.id, 'TEMPORARILY_HIDDEN')
    first.sqlite.close()
    opened.splice(opened.indexOf(first.sqlite), 1)
    const second = open(file)
    await migrateDatabase(second.db)
    const reopened = new SqliteTrainingLibrary(second.db)
    expect((await reopened.load()).workouts.find((item) => item.id === workout.id))
      .toMatchObject({ userPreference: 'DISLIKE', userVisibility: 'TEMPORARILY_HIDDEN' })
    await reopened.setVisibility(workout.id, 'ACTIVE')
    await reopened.setPreference(workout.id, null)
    expect((await reopened.load()).workouts.find((item) => item.id === workout.id))
      .toMatchObject({ userPreference: null, userVisibility: 'ACTIVE' })
    const session = await new TrainingSessionRepository(second.db).start({ workoutContentId: workout.id,
      sessionOrigin: 'EXISTING_LIBRARY' })
    await new TrainingSessionRepository(second.db).complete(session.id, { durationMinutes: 10, completionStatus: 'COMPLETE' })
    expect(await reopened.remove(workout.id)).toBe('archived')
    expect((await reopened.load()).workouts.find((item) => item.id === workout.id)?.userVisibility).toBe('ARCHIVED')
    await reopened.setVisibility(workout.id, 'ACTIVE')
    expect((await reopened.load()).workouts.find((item) => item.id === workout.id)?.completionCount).toBe(1)
  })

  it('hard-deletes unreferenced content and cascades its workout preference', async () => {
    const { db } = await ready()
    const library = new SqliteTrainingLibrary(db)
    const workout = await library.addUrl('https://pan.quark.cn/s/abc')
    await library.setPreference(workout.id, 'NEUTRAL')
    expect(await library.remove(workout.id)).toBe('deleted')
    expect((await library.load()).workouts).toEqual([])
    expect(await db.query('SELECT * FROM workout_preferences')).toEqual([])
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([])
  })
})

describe('M3 share import repository', () => {
  it('selects any non-archived library workout without creating a session', async () => {
    const { db } = await ready()
    const library = new SqliteTrainingLibrary(db)
    const imports = new WorkoutImportRepository(db, async () => null)
    const manual = await library.addUrl('https://www.bilibili.com/video/BV123')
    const free = await library.addFreeActivity('快走')
    const legacy = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL' })
    const hidden = await library.addUrl('https://pan.quark.cn/s/hidden')
    await library.setVisibility(hidden.id, 'TEMPORARILY_HIDDEN')
    const archived = await library.addUrl('https://example.com/archived')
    await new WorkoutRepository(db).update(archived.id, { userVisibility: 'ARCHIVED' })

    for (const id of [manual.id, free.id, legacy.id, hidden.id]) {
      await imports.selectToday(id, '2026-09-13')
      expect(await imports.pendingToday('2026-09-13')).toBe(id)
    }
    await expect(imports.selectToday(archived.id, '2026-09-13')).rejects.toThrow('not selectable')
    expect(await imports.pendingToday('2026-09-13')).toBe(hidden.id)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_sessions'))[0]?.count).toBe(0)
  })

  it('saves incomplete URL and text shares, preserving raw input and source', async () => {
    const { db } = await ready()
    const imports = new WorkoutImportRepository(db, async () => null)
    const cases = [
      ['bili', 'https://www.bilibili.com/video/BV123', 'BILIBILI'],
      ['xhs', '小红书训练 https://www.xiaohongshu.com/explore/123', 'XIAOHONGSHU'],
      ['web', 'https://example.com/workout', 'WEB'],
      ['quark', '30天计划 https://pan.quark.cn/s/abc', 'QUARK'],
      ['text', '室内拉伸练习', 'WEB'],
    ] as const
    for (const [eventId, text, sourceType] of cases) {
      const result = await imports.importShare({ eventId, text, subject: null })
      expect(result.status).toBe('NEEDS_MORE_INFO')
      const row = (await db.query<{ raw_url: string | null; raw_shared_text: string;
        source_type: string; import_status: string; workout_content_id: string }>(
        'SELECT * FROM workout_imports WHERE fingerprint=?', [eventId]))[0]!
      expect(row).toMatchObject({ raw_shared_text: text, source_type: sourceType,
        import_status: 'NEEDS_MORE_INFO', workout_content_id: result.workoutContentId })
      const workout = await new WorkoutRepository(db).get(result.workoutContentId)
      expect(workout?.sourceUrl).toBe(row.raw_url)
      if (eventId === 'quark') expect(workout).toMatchObject({ title: null, durationMinutes: null,
        primaryActivityTypeId: null, estimatedIntensity: null })
    }
  })

  it('uses explicit title and local rules without requiring a form', async () => {
    const { db } = await ready()
    const imports = new WorkoutImportRepository(db, async () => null)
    const result = await imports.importShare({ eventId: 'title', text: 'https://b23.tv/abc',
      subject: '20分钟瑜伽' })
    expect(result.status).toBe('READY')
    const workout = await new WorkoutRepository(db).get(result.workoutContentId)
    expect(workout).toMatchObject({ title: '20分钟瑜伽', durationMinutes: 20, sourceType: 'BILIBILI' })
    expect(workout?.primaryActivityTypeId).not.toBeNull()
    expect((await db.query<{ raw_metadata_json: string }>('SELECT raw_metadata_json FROM workout_imports WHERE fingerprint=?', ['title']))[0]?.raw_metadata_json)
      .toContain('20分钟瑜伽')
    expect((await db.query<{ method: string; extracted_data_json: string }>(
      'SELECT method,extracted_data_json FROM content_analyses WHERE workout_content_id=?', [result.workoutContentId]))[0])
      .toMatchObject({ method: 'RULES', extracted_data_json: expect.stringContaining('YOGA') })
  })

  it('uses lightweight page title when available and ignores metadata failures', async () => {
    const { db } = await ready()
    const imports = new WorkoutImportRepository(db, async () => '15分钟拉伸')
    const result = await imports.importShare({ eventId: 'page', text: 'https://example.com/stretch', subject: null })
    expect(result.status).toBe('READY')
    expect((await new WorkoutRepository(db).get(result.workoutContentId))?.title).toBe('15分钟拉伸')
    const failed = new WorkoutImportRepository(db, async () => { throw new Error('blocked') })
    const fallback = await failed.importShare({ eventId: 'blocked', text: 'https://example.com/other', subject: null })
    expect(fallback.status).toBe('NEEDS_MORE_INFO')
    expect(await new WorkoutRepository(db).get(fallback.workoutContentId)).not.toBeNull()
  })

  it('deduplicates one event and rolls back both rows if import storage fails', async () => {
    const { db, sqlite } = await ready()
    const imports = new WorkoutImportRepository(db, async () => null)
    const payload = { eventId: 'same-event', text: 'https://example.com/a', subject: null }
    const [first, second] = await Promise.all([imports.importShare(payload), imports.importShare(payload)])
    expect(first.workoutContentId).toBe(second.workoutContentId)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM workout_imports'))[0]?.count).toBe(1)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM workout_contents'))[0]?.count).toBe(1)
    sqlite.exec("CREATE TRIGGER reject_import BEFORE INSERT ON workout_imports BEGIN SELECT RAISE(ABORT,'rejected'); END;")
    await expect(imports.importShare({ eventId: 'failed-event', text: 'https://example.com/b', subject: null }))
      .rejects.toThrow('rejected')
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM workout_contents'))[0]?.count).toBe(1)
  })

  it('persists imports and today selection after reopen without creating a session', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'motion-m3-'))
    directories.push(directory)
    const file = join(directory, 'motion.db')
    const first = open(file)
    await migrateDatabase(first.db)
    const imports = new WorkoutImportRepository(first.db, async () => null)
    const result = await imports.importShare({ eventId: 'restart', text: 'https://pan.quark.cn/s/abc', subject: null })
    await imports.selectToday(result.workoutContentId, '2026-09-12')
    expect((await first.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_sessions'))[0]?.count).toBe(0)
    first.sqlite.close()
    opened.splice(opened.indexOf(first.sqlite), 1)
    const second = open(file)
    await migrateDatabase(second.db)
    const reopened = new WorkoutImportRepository(second.db, async () => null)
    expect(await reopened.pendingToday('2026-09-12')).toBe(result.workoutContentId)
    expect((await reopened.importShare({ eventId: 'restart', text: 'https://pan.quark.cn/s/abc', subject: null }))
      .workoutContentId).toBe(result.workoutContentId)
    expect((await second.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_sessions'))[0]?.count).toBe(0)
    expect(await new WorkoutRepository(second.db).remove(result.workoutContentId)).toBe('archived')
  })
})

describe('M4 plan and daily execution', () => {
  it('creates a consecutive plan, shows one Today task, and records normal and partial days', async () => {
    const { db } = await ready()
    const first = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG', sourceType: 'BILIBILI', title: '训练一' })
    const second = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG', sourceType: 'WEB', title: '训练二' })
    let clock = new Date(2026, 8, 13, 12)
    const execution = new TrainingExecution(db, () => clock)
    const plan = await execution.createPlan('七天计划', [
      { dayIndex: 1, items: [{ workoutContentId: first.id, role: 'PRIMARY' }] },
      { dayIndex: 2, items: [{ workoutContentId: second.id, role: 'PRIMARY' }] },
      { dayIndex: 3, isRestDay: true },
      { dayIndex: 4, items: [{ workoutContentId: first.id, role: 'PRIMARY' }] },
      { dayIndex: 5, items: [{ workoutContentId: first.id, role: 'PRIMARY' }] },
      { dayIndex: 6, items: [{ workoutContentId: second.id, role: 'PRIMARY' }] },
      { dayIndex: 7, isRestDay: true },
    ])
    expect(plan.plannedDays).toBe(7)
    await execution.startPlan(plan.id)
    await expect(execution.startPlan(plan.id)).rejects.toThrow()
    let snapshot = await execution.load()
    expect(snapshot.currentDay?.dayIndex).toBe(1)
    expect(snapshot.mainWorkout?.id).toBe(first.id)
    const started = await execution.startWorkout(snapshot)
    expect((await execution.startWorkout(snapshot)).id).toBe(started.id)
    await execution.completeWorkout(started.id, 25, 'COMPLETE')
    expect((await execution.completeWorkout(started.id, 25, 'COMPLETE')).id).toBe(started.id)
    expect((await execution.plans.getRunDays(snapshot.run!.id))[0]).toMatchObject({ status: 'COMPLETED', planEquivalence: 'FULL' })
    clock = new Date(2026, 8, 14, 12)
    snapshot = await execution.load()
    expect(snapshot.mainWorkout?.id).toBe(second.id)
    const partial = await execution.startWorkout(snapshot)
    await execution.completeWorkout(partial.id, 4, 'PARTIAL')
    expect((await execution.plans.getRunDays(snapshot.run!.id))[1]).toMatchObject({ status: 'PARTIALLY_COMPLETED', planEquivalence: 'PARTIAL' })
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM active_days'))[0]?.count).toBe(1)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_sessions'))[0]?.count).toBe(2)
  })

  it('reschedules without changing original dates, skips without debt, and closes planned rest without activity', async () => {
    const { db } = await ready()
    const plans = new TrainingPlanRepository(db)
    const plan = await plans.create({ title: 'Three days', sourceType: 'MANUAL', days: [
      { dayIndex: 1 }, { dayIndex: 2, isRestDay: true }, { dayIndex: 3 },
    ] })
    const run = await plans.startRun(plan.id, '2026-09-13')
    let days = await plans.getRunDayViews(run)
    await plans.reschedule(days[0]!.id, '2026-09-14')
    days = await plans.getRunDayViews(run)
    expect(days.map((day) => day.scheduledLocalDate)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16'])
    expect(days[0]?.originalScheduledLocalDate).toBe('2026-09-13')
    await plans.skip(days[0]!.id)
    await plans.completePlannedRest(days[1]!.id, '2026-09-15')
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM active_days'))[0]?.count).toBe(0)
    expect((await plans.getCurrentRun())?.currentDayIndex).toBe(3)
    await plans.skip(days[2]!.id)
    await plans.completeRun(run)
    expect(await plans.getCurrentRun()).toBeNull()
    expect((await db.query<{ status: string }>('SELECT status FROM training_plan_runs WHERE id=?', [run]))[0]?.status).toBe('COMPLETED')
  })

  it('shifts a missed day and later pending days, while pause/resume shifts without recording misses', async () => {
    const { db } = await ready()
    const plans = new TrainingPlanRepository(db)
    const plan = await plans.create({ title: 'Shift', sourceType: 'MANUAL', days: [
      { dayIndex: 1 }, { dayIndex: 2 }, { dayIndex: 3 },
    ] })
    const run = await plans.startRun(plan.id, '2026-09-13')
    await plans.reconcileMissed('2026-09-15')
    let days = await plans.getRunDayViews(run)
    expect(days.map((day) => day.scheduledLocalDate)).toEqual(['2026-09-15', '2026-09-16', '2026-09-17'])
    expect(days.map((day) => day.originalScheduledLocalDate)).toEqual(['2026-09-13', '2026-09-14', '2026-09-15'])
    await plans.pause(run, new Date(2026, 8, 15, 12))
    await plans.reconcileMissed('2026-09-18')
    expect((await plans.getRunDayViews(run)).map((day) => day.scheduledLocalDate)).toEqual(days.map((day) => day.scheduledLocalDate))
    await plans.resume(run, '2026-09-18')
    days = await plans.getRunDayViews(run)
    expect(days.map((day) => day.scheduledLocalDate)).toEqual(['2026-09-18', '2026-09-19', '2026-09-20'])
    expect(days.every((day) => day.status === 'SCHEDULED')).toBe(true)
    await plans.end(run)
    expect(await plans.getCurrentRun()).toBeNull()
  })

  it('swaps a planned rest date with one workout date and keeps both original slots', async () => {
    const { db } = await ready()
    const plans = new TrainingPlanRepository(db)
    const plan = await plans.create({ title: 'Swap', sourceType: 'MANUAL', days: [
      { dayIndex: 1 }, { dayIndex: 2, isRestDay: true }, { dayIndex: 3 },
    ] })
    const run = await plans.startRun(plan.id, '2026-09-13')
    const days = await plans.getRunDayViews(run)
    await plans.swapPlannedRest(days[1]!.id, days[0]!.id)
    const changed = await plans.getRunDayViews(run)
    expect(changed.map((day) => day.scheduledLocalDate)).toEqual(['2026-09-14', '2026-09-13', '2026-09-15'])
    expect((await plans.getCurrentRun())?.currentDayIndex).toBe(2)
    expect(changed.map((day) => day.originalScheduledLocalDate)).toEqual(['2026-09-13', '2026-09-14', '2026-09-15'])
    await plans.completePlannedRest(days[1]!.id, '2026-09-13')
    expect((await plans.getCurrentRun())?.currentDayIndex).toBe(1)
    await expect(plans.swapPlannedRest(days[1]!.id, days[2]!.id)).rejects.toThrow()
  })

  it.each(['FULL', 'PARTIAL', 'NONE'] as const)('records manual replacement with %s equivalence', async (equivalence) => {
    const { db } = await ready()
    const workouts = new WorkoutRepository(db)
    const planned = await workouts.create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL', title: '原训练' })
    const replacement = await workouts.create({ contentKind: 'FREE_ACTIVITY', sourceType: 'MANUAL', title: '替换训练' })
    const execution = new TrainingExecution(db, () => new Date(2026, 8, 13, 12))
    const plan = await execution.createPlan('Replace', [{ dayIndex: 1, items: [{ workoutContentId: planned.id, role: 'PRIMARY' }] }])
    await execution.startPlan(plan.id)
    await execution.selectWorkout(replacement.id)
    const snapshot = await execution.load()
    expect(snapshot.mainWorkout?.id).toBe(replacement.id)
    const session = await execution.startWorkout(snapshot)
    await execution.completeWorkout(session.id, 12, 'COMPLETE', equivalence)
    const day = (await execution.plans.getRunDayViews(snapshot.run!.id))[0]!
    expect(day).toMatchObject({ primaryWorkoutId: planned.id, executionKind: 'REPLACEMENT', planEquivalence: equivalence })
    expect((await execution.sessions.get(session.id))?.workoutContentId).toBe(replacement.id)
    expect((await execution.load()).pendingWorkoutId).toBeNull()
  })

  it('uses M3 pending selection only after Start, keeps optional feedback optional, and recovers after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'motion-m4-'))
    directories.push(directory)
    const file = join(directory, 'motion.db')
    const first = open(file)
    await migrateDatabase(first.db)
    const workout = await new WorkoutRepository(first.db).create({ contentKind: 'FOLLOW_ALONG', sourceType: 'BILIBILI' })
    const clock = () => new Date(2026, 8, 13, 12)
    const execution = new TrainingExecution(first.db, clock)
    await execution.selectWorkout(workout.id)
    expect((await first.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_sessions'))[0]?.count).toBe(0)
    const started = await execution.startWorkout(await execution.load())
    first.sqlite.close(); opened.splice(opened.indexOf(first.sqlite), 1)
    const second = open(file)
    await migrateDatabase(second.db)
    const reopened = new TrainingExecution(second.db, clock)
    expect((await reopened.load()).session?.id).toBe(started.id)
    await reopened.completeWorkout(started.id, 10, 'COMPLETE')
    expect((await reopened.load()).pendingWorkoutId).toBeNull()
    expect((await second.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM workout_feedback'))[0]?.count).toBe(0)
    await reopened.saveFeedback(started.id, { exertion: 'JUST_RIGHT', preference: 'LIKE' })
    await reopened.saveFeedback(started.id, { exertion: 'EASY', preference: null })
    expect(await reopened.sessions.getFeedback(started.id)).toEqual({ exertion: 'EASY', preference: null })
    expect((await second.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM workout_feedback'))[0]?.count).toBe(1)
    expect((await second.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM active_days'))[0]?.count).toBe(1)
  })

  it('abandons a recovered session without advancing the plan, then permits a fresh Start', async () => {
    const { db } = await ready()
    const workout = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL' })
    const execution = new TrainingExecution(db, () => new Date(2026, 8, 13, 12))
    const plan = await execution.createPlan('Recovery', [{ dayIndex: 1, items: [{ workoutContentId: workout.id, role: 'PRIMARY' }] }])
    await execution.startPlan(plan.id)
    const first = await execution.startWorkout(await execution.load())
    const recovered = new TrainingExecution(db, () => new Date(2026, 8, 13, 12))
    expect((await recovered.load()).session?.id).toBe(first.id)
    await recovered.abandonWorkout(first.id)
    expect((await recovered.load()).currentDay?.status).toBe('SCHEDULED')
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM active_days'))[0]?.count).toBe(0)
    const second = await recovered.startWorkout(await recovered.load())
    expect(second.id).not.toBe(first.id)
    expect((await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM training_sessions WHERE lifecycle_status='IN_PROGRESS'"))[0]?.count).toBe(1)
  })

  it('does not advance plan or Active Day if completion transaction fails', async () => {
    const { db, sqlite } = await ready()
    const execution = new TrainingExecution(db, () => new Date(2026, 8, 13, 12))
    const workout = await new WorkoutRepository(db).create({ contentKind: 'FOLLOW_ALONG', sourceType: 'MANUAL' })
    const plan = await execution.createPlan('Atomic', [{ dayIndex: 1, items: [{ workoutContentId: workout.id, role: 'PRIMARY' }] }])
    const run = await execution.startPlan(plan.id)
    const session = await execution.startWorkout(await execution.load())
    sqlite.exec("CREATE TRIGGER reject_active_day BEFORE INSERT ON active_days BEGIN SELECT RAISE(ABORT,'forced failure'); END;")
    await expect(execution.completeWorkout(session.id, 10, 'COMPLETE')).rejects.toThrow('forced failure')
    expect((await execution.sessions.get(session.id))?.lifecycleStatus).toBe('IN_PROGRESS')
    expect((await execution.plans.getRunDays(run))[0]?.status).toBe('IN_PROGRESS')
    expect(await db.query('SELECT * FROM active_days')).toEqual([])
  })
})
