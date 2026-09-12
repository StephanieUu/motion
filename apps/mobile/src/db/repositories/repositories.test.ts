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
    expect(await migrateDatabase(db)).toBe(2)
    expect(await migrateDatabase(db)).toBe(2)
    expect((await db.query<{ count: number }>('SELECT COUNT(*) AS count FROM activity_types'))[0]?.count).toBe(19)
    expect((await db.query<{ id: string }>("SELECT id FROM activity_types WHERE system_key='OTHER'"))[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect((await db.query<{ probe_value: string }>('SELECT probe_value FROM m0_storage_probe'))[0]?.probe_value).toBe('retained')
    expect((await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM activity_preferences WHERE inferred_score<0"))[0]?.count).toBe(4)
  })

  it('upgrades a version-1 historical fixture without breaking references', async () => {
    const { db, sqlite } = open()
    sqlite.exec(migrations[0]!.sql)
    sqlite.exec("PRAGMA user_version=1; INSERT INTO activity_types VALUES ('old-type','CUSTOM','Custom',0,1); INSERT INTO workout_contents (id,content_kind,source_type,primary_activity_type_id,created_at,updated_at) VALUES ('old-workout','FOLLOW_ALONG','MANUAL','old-type','2026-01-01','2026-01-01'); INSERT INTO training_sessions (id,local_date,local_date_source,started_at,ended_at,duration_minutes,workout_content_id,activity_type_id,session_origin,lifecycle_status,completion_status,created_at,updated_at) VALUES ('old-session','2026-01-01','USER_SELECTED','2026-01-01','2026-01-01',10,'old-workout','old-type','EXISTING_LIBRARY','COMPLETED','COMPLETE','2026-01-01','2026-01-01');")
    expect(await migrateDatabase(db)).toBe(2)
    expect((await db.query<{ workout_content_id: string }>('SELECT workout_content_id FROM training_sessions WHERE id=?', ['old-session']))[0]?.workout_content_id).toBe('old-workout')
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
