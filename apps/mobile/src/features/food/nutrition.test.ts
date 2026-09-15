// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { ageOnDate, calculateDailyTarget, estimatedEer, parseFoodText,
  remainingIntake, summarizeIntake } from '@motion/domain'
import { Database, type SqlDriver, type SqlRow, type SqlValue } from '../../db/sqlite/Database'
import { migrateDatabase, migrations } from '../../db/migrations'
import { NutritionRepository, type FoodEntryInput } from '../../db/repositories/NutritionRepository'
import { AppPreferencesRepository } from '../../db/repositories/AppPreferencesRepository'
import { NutritionService } from './nutritionService'
import { todayNutritionCopy } from './nutritionPresentation'

class NodeDriver implements SqlDriver {
  constructor(readonly sqlite: DatabaseSync) {}
  async query<T extends SqlRow>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.sqlite.prepare(sql).all(...values) as T[]
  }
  async run(sql: string, values: SqlValue[] = []): Promise<void> { this.sqlite.prepare(sql).run(...values) }
  async execute(sql: string): Promise<void> { this.sqlite.exec(sql) }
  async begin(): Promise<void> { this.sqlite.exec('BEGIN IMMEDIATE') }
  async commit(): Promise<void> { this.sqlite.exec('COMMIT') }
  async rollback(): Promise<void> { this.sqlite.exec('ROLLBACK') }
}
const opened: DatabaseSync[] = []
async function ready(version = 7) {
  const sqlite = new DatabaseSync(':memory:')
  opened.push(sqlite)
  const db = new Database(new NodeDriver(sqlite))
  await migrateDatabase(db, migrations.slice(0, version))
  return { sqlite, db, repository: new NutritionRepository(db) }
}
afterEach(() => opened.splice(0).forEach((sqlite) => sqlite.close()))
const on = () => new Date(2026, 8, 15, 12)
const entry = (name: string, calories: number | null, protein: number | null): FoodEntryInput => ({
  name, quantity: null, unit: null, calories_kcal: calories, protein_g: protein,
  carbs_g: null, fat_g: null, estimation_method: 'MANUAL', confidence_level: 'MEDIUM', raw_input: name,
})

describe('M7 schema and repository', () => {
  it('creates version 7 from fresh and enables foreign keys', async () => {
    const { db } = await ready()
    expect((await db.query<{ user_version: number }>('PRAGMA user_version'))[0]?.user_version).toBe(7)
    expect((await db.query<{ foreign_keys: number }>('PRAGMA foreign_keys'))[0]?.foreign_keys).toBe(1)
    expect(await db.query('SELECT * FROM meals')).toEqual([])
    expect(await db.query('SELECT * FROM app_preferences')).toEqual([])
  })
  it('upgrades populated M6 without changing prior records or notification defaults', async () => {
    const { db } = await ready(6)
    await db.run("INSERT INTO user_profile (singleton_key,id,goal_type,created_at) VALUES (1,'u','MAINTENANCE','2026-09-14')")
    const before = await db.query('SELECT * FROM user_profile')
    expect(await migrateDatabase(db)).toBe(7)
    expect(await db.query('SELECT id,goal_type,activity_level FROM user_profile')).toEqual([
      { id: 'u', goal_type: 'MAINTENANCE', activity_level: null },
    ])
    expect((before[0] as { id: string }).id).toBe('u')
    expect((await db.query<{ rescue_notifications_enabled: number }>(
      'SELECT rescue_notifications_enabled FROM app_preference'))[0]?.rescue_notifications_enabled).toBe(0)
    expect(await db.query('SELECT * FROM app_preferences')).toEqual([])
  })
  it('persists generic application preferences independently from the M0 storage probe', async () => {
    const { db } = await ready()
    const preferences = new AppPreferencesRepository(db)
    await preferences.set('onboarding.disposition', 'PENDING')
    expect(await preferences.get('onboarding.disposition')).toBe('PENDING')
    await preferences.set('onboarding.disposition', 'COMPLETED')
    expect(await preferences.get('onboarding.disposition')).toBe('COMPLETED')
    await expect(preferences.set('', 'value')).rejects.toThrow('Preference key is required')
    expect(await db.query(`SELECT * FROM sqlite_master WHERE type='table' AND name='m0_storage_probe'`)).toEqual([])
  })
  it('enforces nutrition foreign keys, checks and one target per date', async () => {
    const { db } = await ready()
    await expect(db.run(`INSERT INTO food_entries (id,meal_id,name,estimation_method,confidence_level,created_at)
      VALUES ('e','missing','x','MANUAL','MEDIUM','now')`)).rejects.toThrow()
    await expect(db.run("INSERT INTO body_measurements VALUES ('w','now','2026-09-15','MANUAL',-1,1,'now')"))
      .rejects.toThrow()
    await expect(db.run("INSERT INTO meals VALUES ('m','2026-09-15','INVALID','now',NULL)"))
      .rejects.toThrow()
    await expect(db.run("INSERT INTO user_profile (singleton_key,id,goal_type,created_at,activity_level) VALUES (1,'u','MAINTENANCE','now','EXTRA')"))
      .rejects.toThrow()
    await db.run("INSERT INTO meals VALUES ('valid-meal','2026-09-15','OTHER','now',NULL)")
    await expect(db.run(`INSERT INTO food_entries (id,meal_id,name,calories_kcal,estimation_method,
      confidence_level,created_at) VALUES ('negative','valid-meal','x',-1,'MANUAL','MEDIUM','now')`))
      .rejects.toThrow()
    await expect(db.run(`INSERT INTO daily_nutrition_targets
      (id,local_date,calories_min,calories_max,protein_min_g,protein_max_g,day_type,
      calculation_version,rationale_json,created_at)
      VALUES ('bad','2026-09-15',2000,1000,80,120,'NORMAL','v1','{}','now')`)).rejects.toThrow()
    await db.run(`INSERT INTO daily_nutrition_targets
      (id,local_date,calories_min,calories_max,protein_min_g,protein_max_g,day_type,
      calculation_version,rationale_json,created_at)
      VALUES ('good','2026-09-15',1000,2000,80,120,'NORMAL','v1','{}','now')`)
    await expect(db.run(`INSERT INTO daily_nutrition_targets
      (id,local_date,calories_min,calories_max,protein_min_g,protein_max_g,day_type,
      calculation_version,rationale_json,created_at)
      VALUES ('dupe','2026-09-15',1000,2000,80,120,'NORMAL','v1','{}','now')`)).rejects.toThrow()
  })
  it('rolls back failed multi-write operations', async () => {
    const { db } = await ready()
    await expect(db.transaction(async (tx) => {
      await tx.run("INSERT INTO meals VALUES ('m','2026-09-15','LUNCH','now',NULL)")
      await tx.run("INSERT INTO food_entries (id,meal_id,name,estimation_method,confidence_level,created_at) VALUES ('e','m','x','BAD','MEDIUM','now')")
    })).rejects.toThrow()
    expect(await db.query('SELECT * FROM meals')).toEqual([])
  })
  it('logs, corrects, deletes and removes an empty meal', async () => {
    const { repository } = await ready()
    await repository.addMealWithEntry('2026-09-15', 'LUNCH', entry('米饭', null, null))
    const logged = (await repository.mealsOn('2026-09-15'))[0]!
    expect(logged.entries[0]?.calories_kcal).toBeNull()
    await repository.updateEntry(logged.entries[0]!.id, { calories_kcal: 240, protein_g: 4 })
    expect((await repository.mealsOn('2026-09-15'))[0]?.entries[0]?.calories_kcal).toBe(240)
    await repository.deleteEntry(logged.entries[0]!.id)
    expect(await repository.mealsOn('2026-09-15')).toEqual([])
  })
  it('saves a versioned content-only template and applies it with fresh identities', async () => {
    const { repository } = await ready()
    const mealId = await repository.addMealWithEntry('2026-09-14', 'BREAKFAST', entry('鸡蛋', 80, 6))
    const template = await repository.saveTemplate(mealId, '早餐一')
    const snapshot = JSON.parse(template.template_data_json)
    expect(snapshot).toMatchObject({ schemaVersion: 1, mealType: 'BREAKFAST',
      entries: [{ name: '鸡蛋', calories_kcal: 80 }] })
    expect(template.template_data_json).not.toMatch(/2026-09-14|mealId|created_at|logged_at/)
    const newId = await repository.applyTemplate(template.id, '2026-09-15')
    expect(newId).not.toBe(mealId)
    const before = (await repository.mealsOn('2026-09-14'))[0]!
    const after = (await repository.mealsOn('2026-09-15'))[0]!
    expect(after.entries[0]?.id).not.toBe(before.entries[0]?.id)
    expect(after.entries[0]?.calories_kcal).toBe(80)
    expect((await repository.templates())[0]?.use_count).toBe(1)
  })
  it('copies yesterday transactionally, requires duplicate confirmation and leaves target behind', async () => {
    const { repository, db } = await ready()
    await repository.addMealWithEntry('2026-09-14', 'DINNER', entry('汤', 100, null))
    await db.run(`INSERT INTO daily_nutrition_targets (id,local_date,calories_min,calories_max,
      protein_min_g,protein_max_g,day_type,calculation_version,rationale_json,created_at)
      VALUES ('y','2026-09-14',1000,1200,60,80,'NORMAL','v1','{}','now')`)
    expect(await repository.copyYesterday('2026-09-15')).toBe(1)
    expect((await repository.mealsOn('2026-09-15'))[0]?.entries[0]?.name).toBe('汤')
    expect(await repository.getTarget('2026-09-15')).toBeNull()
    await expect(repository.copyYesterday('2026-09-15')).rejects.toThrow('DUPLICATE_CONFIRMATION_REQUIRED')
    expect((await repository.mealsOn('2026-09-15')).length).toBe(1)
    expect(await repository.copyYesterday('2026-09-15', true)).toBe(1)
    expect((await repository.mealsOn('2026-09-15')).length).toBe(2)
  })
  it('does not leave a partial copied day if a later insert fails', async () => {
    const { repository, db } = await ready()
    await repository.addMealWithEntry('2026-09-14', 'LUNCH', entry('饭', 200, 5))
    await repository.addMealWithEntry('2026-09-14', 'DINNER', entry('汤', 100, 2))
    await db.execute(`CREATE TRIGGER fail_second_copy BEFORE INSERT ON food_entries
      WHEN NEW.name='汤' AND (SELECT local_date FROM meals WHERE id=NEW.meal_id)='2026-09-15'
      BEGIN SELECT RAISE(ABORT, 'copy failed'); END;`)
    await expect(repository.copyYesterday('2026-09-15')).rejects.toThrow('copy failed')
    expect(await repository.mealsOn('2026-09-15')).toEqual([])
  })
  it('chooses the latest verified measurement on or before the target date', async () => {
    const { repository } = await ready()
    await repository.addManualWeight(70, '2026-09-14')
    await repository.addManualWeight(68, '2026-09-16')
    expect((await repository.latestWeightOnOrBefore('2026-09-15'))?.weight_kg).toBe(70)
  })
})

describe('M7 pure nutrition rules', () => {
  it.each([
    ['MALE','INACTIVE',2520.17], ['MALE','LOW_ACTIVE',2713.37],
    ['MALE','ACTIVE',2902.02], ['MALE','VERY_ACTIVE',3148.62],
    ['FEMALE','INACTIVE',2166.7], ['FEMALE','LOW_ACTIVE',2337.27],
    ['FEMALE','ACTIVE',2475.55], ['FEMALE','VERY_ACTIVE',2722.63],
  ] as const)('computes 2023 EER %s %s', (sex, level, result) => {
    expect(estimatedEer(sex, level, 30, 170, 70)).toBeCloseTo(result, 2)
  })
  it('uses local birthday boundaries and declines under-19 estimates', () => {
    expect(ageOnDate('2007-09-16', '2026-09-15')).toBe(18)
    expect(ageOnDate('2007-09-16', '2026-09-16')).toBe(19)
    expect(calculateDailyTarget({ localDate: '2026-09-15', birthDate: '2007-09-16', sex: 'FEMALE',
      heightCm: 170, activityLevel: 'INACTIVE', goal: 'MAINTENANCE', targetWeightKg: null,
      weight: { id: 'w', localDate: '2026-09-15', weightKg: 70 } })).toBeNull()
  })
  it('requires enough profile and a non-future weight', () => {
    const base = { localDate: '2026-09-15', birthDate: '1996-01-01', sex: 'FEMALE' as const,
      heightCm: 170, activityLevel: 'INACTIVE' as const, goal: 'MAINTENANCE' as const,
      targetWeightKg: null, weight: { id: 'w', localDate: '2026-09-16', weightKg: 70 } }
    expect(calculateDailyTarget(base)).toBeNull()
    expect(calculateDailyTarget({ ...base, weight: null })).toBeNull()
    expect(calculateDailyTarget({ ...base, sex: null })).toBeNull()
  })
  it('applies fat-loss range, floor and reference-weight rule', () => {
    const base = { localDate: '2026-09-15', birthDate: '1996-01-01', sex: 'FEMALE' as const,
      heightCm: 170, activityLevel: 'INACTIVE' as const, goal: 'FAT_LOSS' as const,
      weight: { id: 'w', localDate: '2026-09-15', weightKg: 70 } }
    const target = calculateDailyTarget({ ...base, targetWeightKg: 60 })!
    expect(target.caloriesMin).toBe(1400)
    expect(target.caloriesMax).toBe(1650)
    expect(target.proteinMinG).toBe(72)
    expect(target.proteinMaxG).toBe(96)
    expect(target.rationale.proteinReferenceSource).toBe('TARGET_WEIGHT')
    expect(calculateDailyTarget({ ...base, targetWeightKg: 40 })?.rationale.proteinReferenceSource)
      .toBe('CURRENT_WEIGHT')
    const low = calculateDailyTarget({ ...base, weight: { id: 'low', localDate: '2026-09-15', weightKg: 48 },
      targetWeightKg: null })!
    expect(low.caloriesMin).toBeGreaterThanOrEqual(1200)
    expect(low.caloriesMax).toBeGreaterThanOrEqual(low.caloriesMin)
  })
  it('keeps historical target snapshots when setup changes; no calorie compensation', async () => {
    const { repository } = await ready()
    const service = new NutritionService(repository, on)
    await service.saveSetup({ birthDate: '1996-01-01', sex: 'FEMALE', heightCm: 170,
      activityLevel: 'INACTIVE', goal: 'MAINTENANCE', targetWeightKg: null, weightKg: 70 })
    const first = (await service.ensureDailyNutritionTarget('2026-09-15'))!
    await service.logText('3000 kcal', 'DINNER')
    const over = await service.daily()
    expect(over.remaining.calorieState).toBe('OVER')
    expect(over.remaining.caloriesRemainingMin).toBe(0)
    await service.saveSetup({ birthDate: '1996-01-01', sex: 'FEMALE', heightCm: 170,
      activityLevel: 'ACTIVE', goal: 'MAINTENANCE', targetWeightKg: null, weightKg: null })
    const changedToday = (await service.ensureDailyNutritionTarget('2026-09-15'))!
    expect(changedToday.calories_min).not.toBe(first.calories_min)
    const tomorrow = (await service.ensureDailyNutritionTarget('2026-09-16'))!
    expect(tomorrow.calories_min).toBe(changedToday.calories_min)
    expect((await service.ensureDailyNutritionTarget('2026-09-15'))?.id).toBe(changedToday.id)
  })
  it('leaves yesterday’s target unchanged after today’s setup changes', async () => {
    const { repository } = await ready()
    await repository.addManualWeight(70, '2026-09-14')
    await repository.transaction(async (tx) => repository.saveProfile({ birthDate: '1996-01-01',
      sex: 'FEMALE', heightCm: 170, activityLevel: 'INACTIVE', goalType: 'MAINTENANCE',
      targetWeightKg: null }, tx))
    const service = new NutritionService(repository, on)
    const yesterday = (await service.ensureDailyNutritionTarget('2026-09-14'))!
    await service.saveSetup({ birthDate: '1996-01-01', sex: 'FEMALE', heightCm: 170,
      activityLevel: 'VERY_ACTIVE', goal: 'MAINTENANCE', targetWeightKg: null, weightKg: 68 })
    const persisted = (await service.ensureDailyNutritionTarget('2026-09-14'))!
    expect(persisted).toEqual(yesterday)
    expect((await service.ensureDailyNutritionTarget('2026-09-15'))?.calories_min)
      .not.toBe(yesterday.calories_min)
  })
  it('removes only today’s adult target when an updated profile is under 19', async () => {
    const { repository } = await ready()
    const service = new NutritionService(repository, on)
    await repository.addManualWeight(60, '2026-09-14')
    await repository.transaction(async (tx) => repository.saveProfile({ birthDate: '1996-01-01',
      sex: 'FEMALE', heightCm: 165, activityLevel: 'LOW_ACTIVE', goalType: 'MAINTENANCE',
      targetWeightKg: null }, tx))
    const yesterday = await service.ensureDailyNutritionTarget('2026-09-14')
    await service.ensureDailyNutritionTarget('2026-09-15')
    await service.saveSetup({ birthDate: '2008-09-16', sex: 'FEMALE', heightCm: 165,
      activityLevel: 'LOW_ACTIVE', goal: 'MAINTENANCE', targetWeightKg: null, weightKg: 60 })
    expect(await repository.getTarget('2026-09-15')).toBeNull()
    expect(await repository.getTarget('2026-09-14')).toEqual(yesterday)
    expect((await repository.latestWeightOnOrBefore('2026-09-15'))?.source_type).toBe('MANUAL')
  })
  it('allows a selected meal type but gives explicit text precedence', async () => {
    const { repository } = await ready()
    const service = new NutritionService(repository, on)
    await service.logText('午饭680 kcal，蛋白质35g', 'BREAKFAST')
    expect((await repository.mealsOn('2026-09-15'))[0]?.meal.meal_type).toBe('LUNCH')
    await service.logText('600 kcal', 'SNACK')
    expect((await repository.mealsOn('2026-09-15')).map((item) => item.meal.meal_type))
      .toContain('SNACK')
  })
  it('returns explicit remaining states and treats unknown values as partial known amounts', () => {
    const summary = summarizeIntake([{ caloriesKcal: 800, proteinG: 20 },
      { caloriesKcal: null, proteinG: null }])
    expect(summary).toMatchObject({ caloriesKnown: 800, proteinKnown: 20, unknownCalories: 1, unknownProtein: 1 })
    expect(remainingIntake(summary, { caloriesMin: 1200, caloriesMax: 1500, proteinMinG: 75 }))
      .toMatchObject({ calorieState: 'BELOW', caloriesRemainingMin: 400, proteinGapG: 55,
        caloriesPartial: true, proteinPartial: true })
    expect(remainingIntake({ ...summary, caloriesKnown: 1600 },
      { caloriesMin: 1200, caloriesMax: 1500, proteinMinG: 75 }).caloriesRemainingMax).toBe(0)
  })
  it.each([
    ['600 kcal', null, 600, null, 'MANUAL'],
    ['午饭大约700 kcal', 'LUNCH', 700, null, 'ROUGH_CALORIE'],
    ['午饭680 kcal，蛋白质35g', 'LUNCH', 680, 35, 'MANUAL'],
    ['吃了鸡胸肉、米饭和青菜', null, null, null, 'MANUAL'],
  ] as const)('parses %s without inventing values', (text, mealType, calories, protein, method) => {
    expect(parseFoodText(text)).toMatchObject({ mealType, caloriesKcal: calories,
      proteinG: protein, estimationMethod: method })
  })
  it('rejects empty and negative calorie input', () => {
    expect(parseFoodText('   ')).toBeNull()
    expect(parseFoodText('-600 kcal')).toBeNull()
  })
})

describe('M7 Today nutrition presentation', () => {
  it('uses factual empty and no-target states', async () => {
    const { repository } = await ready()
    const service = new NutritionService(repository, on)

    expect(todayNutritionCopy(await service.daily())).toMatchObject({
      lead: '今天还没有饮食记录',
      target: '尚未设置营养目标',
      state: '',
    })

    await repository.addMealWithEntry('2026-09-15', 'LUNCH', entry('饭', 600, null))
    expect(todayNutritionCopy(await service.daily())).toMatchObject({
      lead: '600 kcal',
      target: '尚未设置营养目标',
      protein: '',
      partial: '1 餐蛋白质未知',
    })
  })

  it('names each missing nutrition value instead of using an ambiguous partial label', async () => {
    const { repository } = await ready()
    const service = new NutritionService(repository, on)
    await repository.addMealWithEntry('2026-09-15', 'BREAKFAST', entry('早餐', null, 12))
    await repository.addMealWithEntry('2026-09-15', 'DINNER', entry('晚餐', null, null))

    expect(todayNutritionCopy(await service.daily()).partial)
      .toBe('2 餐热量未知 · 1 餐蛋白质未知')
  })

  it('shows below, in-range and over-range states without debt language', async () => {
    const { repository } = await ready()
    const service = new NutritionService(repository, on)
    await service.saveSetup({ birthDate: '1996-01-01', sex: 'FEMALE', heightCm: 170,
      activityLevel: 'INACTIVE', goal: 'MAINTENANCE', targetWeightKg: null, weightKg: 70 })
    await service.logText('500 kcal', 'LUNCH')
    expect(todayNutritionCopy(await service.daily()).state).toContain('距离目标范围')
    await service.logText('1600 kcal', 'DINNER')
    expect(todayNutritionCopy(await service.daily()).state).toContain('目标范围内')
    await service.logText('700 kcal', 'SNACK')
    const copy = todayNutritionCopy(await service.daily())
    expect(copy.state).toBe('今日已超过目标范围')
    expect(copy.state).not.toMatch(/欠|补偿|偿还/)
  })

  it('explains why an under-19 user has no automatic target while keeping logs visible', async () => {
    const { repository } = await ready()
    const service = new NutritionService(repository, on)
    await service.saveSetup({ birthDate: '2008-01-01', sex: 'FEMALE', heightCm: 165,
      activityLevel: 'LOW_ACTIVE', goal: 'MAINTENANCE', targetWeightKg: null, weightKg: 60 })
    await service.logText('午饭 600 kcal', 'BREAKFAST')
    const day = await service.daily()
    expect(day.target).toBeNull()
    expect(day.targetUnavailableReason).toBe('UNDER_19')
    expect(todayNutritionCopy(day)).toMatchObject({
      lead: '600 kcal',
      target: '暂无成人自动目标',
    })
  })
})
