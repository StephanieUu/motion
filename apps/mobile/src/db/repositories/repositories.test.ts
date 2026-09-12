// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
  opened.splice(0).forEach((sqlite) => sqlite.close())
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
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
    expect(await migrateDatabase(db)).toBe(5)
    expect(await migrateDatabase(db)).toBe(5)
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
    expect(await migrateDatabase(db)).toBe(5)
    expect((await db.query<{ workout_content_id: string }>('SELECT workout_content_id FROM training_sessions WHERE id=?', ['old-session']))[0]?.workout_content_id).toBe('old-workout')
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([])
  })

  it('upgrades an existing M1 database to the Chinese default without losing workouts', async () => {
    const { db, sqlite } = open()
    sqlite.exec(migrations[0]!.sql)
    sqlite.exec(migrations[1]!.sql)
    sqlite.exec("PRAGMA user_version=2; INSERT INTO workout_contents (id,content_kind,source_type,created_at,updated_at) VALUES ('saved-workout','FOLLOW_ALONG','MANUAL','2026-01-01','2026-01-01');")
    expect(await migrateDatabase(db)).toBe(5)
    expect((await db.query<{ locale: string }>('SELECT locale FROM app_preference'))[0]?.locale).toBe('zh-CN')
    expect((await db.query<{ name: string }>("SELECT name FROM activity_types WHERE system_key='OTHER'"))[0]?.name).toBe('其他')
    expect((await db.query<{ id: string }>('SELECT id FROM workout_contents WHERE id=?', ['saved-workout']))[0]?.id).toBe('saved-workout')
  })

  it('upgrades an accepted M2 database with workouts and reactions intact', async () => {
    const { db, sqlite } = open()
    for (const step of migrations.slice(0, 4)) sqlite.exec(step.sql)
    sqlite.exec("PRAGMA user_version=4; INSERT INTO workout_contents (id,content_kind,source_type,created_at,updated_at) VALUES ('m2-workout','FOLLOW_ALONG','BILIBILI','2026-01-01','2026-01-01'); INSERT INTO workout_preferences (workout_content_id,explicit_preference,updated_at) VALUES ('m2-workout','LOVE','2026-01-01');")
    expect(await migrateDatabase(db)).toBe(5)
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
    expect(await migrateDatabase(db)).toBe(5)
    expect(await migrateDatabase(db)).toBe(5)
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
