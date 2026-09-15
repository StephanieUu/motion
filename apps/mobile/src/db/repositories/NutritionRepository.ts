import type { ActivityLevel, CalculatedTarget, ConfidenceLevel, EstimationMethod, MealType } from '@motion/domain'
import type { Database, SqlAccess, SqlRow } from '../sqlite/Database'

export interface NutritionProfile extends SqlRow {
  id: string; birth_date: string | null; sex: string | null; height_cm: number | null
  goal_type: string; target_weight_kg: number | null; desired_weight_loss_rate: number | null
  activity_level: ActivityLevel | null
}
export interface BodyMeasurementRecord extends SqlRow {
  id: string; measured_at: string; local_date: string; source_type: string; weight_kg: number
  user_verified: number; created_at: string
}
export interface MealRecord extends SqlRow {
  id: string; local_date: string; meal_type: MealType; logged_at: string; note: string | null
}
export interface FoodEntryRecord extends SqlRow {
  id: string; meal_id: string; name: string; quantity: number | null; unit: string | null
  calories_kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null
  estimation_method: EstimationMethod; confidence_level: ConfidenceLevel; raw_input: string | null; created_at: string
}
export type FoodEntryInput = Pick<FoodEntryRecord, 'name' | 'quantity' | 'unit' | 'calories_kcal' |
  'protein_g' | 'carbs_g' | 'fat_g' | 'estimation_method' | 'confidence_level' | 'raw_input'>
export interface DailyNutritionTargetRecord extends SqlRow {
  id: string; local_date: string; calories_min: number; calories_max: number
  protein_min_g: number; protein_max_g: number; carbs_target_g: number | null; fat_target_g: number | null
  day_type: 'NORMAL'; calculation_version: string; rationale_json: string; created_at: string
}
export interface MealTemplateSnapshot {
  schemaVersion: 1; mealType: MealType; note: string | null; entries: FoodEntryInput[]
}
export interface MealTemplateRecord extends SqlRow {
  id: string; name: string; template_data_json: string; last_used_at: string | null
  use_count: number; created_at: string
}
export interface MealWithEntries { meal: MealRecord; entries: FoodEntryRecord[] }

const entryFields = `id,meal_id,name,quantity,unit,calories_kcal,protein_g,carbs_g,fat_g,
  estimation_method,confidence_level,raw_input,created_at`

export class NutritionRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(work: (tx: SqlAccess) => Promise<T>): Promise<T> { return this.db.transaction(work) }
  async getProfile(tx: SqlAccess = this.db): Promise<NutritionProfile | null> {
    return (await tx.query<NutritionProfile>('SELECT * FROM user_profile WHERE singleton_key=1'))[0] ?? null
  }
  async saveProfile(input: { birthDate: string | null; sex: string | null; heightCm: number | null;
    goalType: string; targetWeightKg: number | null; activityLevel: ActivityLevel | null }, tx: SqlAccess): Promise<void> {
    const current = await this.getProfile(tx)
    await tx.run(`INSERT INTO user_profile (singleton_key,id,birth_date,sex,height_cm,goal_type,
      target_weight_kg,desired_weight_loss_rate,created_at,activity_level) VALUES (1,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(singleton_key) DO UPDATE SET birth_date=excluded.birth_date,sex=excluded.sex,
      height_cm=excluded.height_cm,goal_type=excluded.goal_type,target_weight_kg=excluded.target_weight_kg,
      activity_level=excluded.activity_level`, [current?.id ?? crypto.randomUUID(), input.birthDate,
      input.sex, input.heightCm, input.goalType, input.targetWeightKg,
      current?.desired_weight_loss_rate ?? null, new Date().toISOString(), input.activityLevel])
  }
  async addManualWeight(weightKg: number, localDate: string, tx: SqlAccess = this.db): Promise<BodyMeasurementRecord> {
    if (!Number.isFinite(weightKg) || weightKg <= 0) throw new Error('Weight must be positive')
    const record: BodyMeasurementRecord = { id: crypto.randomUUID(), measured_at: new Date().toISOString(),
      local_date: localDate, source_type: 'MANUAL', weight_kg: weightKg, user_verified: 1,
      created_at: new Date().toISOString() }
    await tx.run(`INSERT INTO body_measurements (id,measured_at,local_date,source_type,weight_kg,user_verified,created_at)
      VALUES (?,?,?,?,?,?,?)`, [record.id, record.measured_at, record.local_date, record.source_type,
      record.weight_kg, record.user_verified, record.created_at])
    return record
  }
  async latestWeightOnOrBefore(localDate: string, tx: SqlAccess = this.db): Promise<BodyMeasurementRecord | null> {
    return (await tx.query<BodyMeasurementRecord>(`SELECT * FROM body_measurements
      WHERE local_date<=? AND user_verified=1 AND weight_kg>0
      ORDER BY local_date DESC,measured_at DESC,created_at DESC LIMIT 1`, [localDate]))[0] ?? null
  }
  async getTarget(localDate: string, tx: SqlAccess = this.db): Promise<DailyNutritionTargetRecord | null> {
    return (await tx.query<DailyNutritionTargetRecord>(
      'SELECT * FROM daily_nutrition_targets WHERE local_date=?', [localDate]))[0] ?? null
  }
  async insertTarget(localDate: string, target: CalculatedTarget, tx: SqlAccess): Promise<void> {
    await tx.run(`INSERT OR IGNORE INTO daily_nutrition_targets
      (id,local_date,calories_min,calories_max,protein_min_g,protein_max_g,carbs_target_g,fat_target_g,
      day_type,calculation_version,rationale_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [crypto.randomUUID(), localDate, target.caloriesMin, target.caloriesMax, target.proteinMinG, target.proteinMaxG,
      null, null, target.dayType, target.calculationVersion, JSON.stringify(target.rationale), new Date().toISOString()])
  }
  async replaceTodayTarget(localDate: string, target: CalculatedTarget, tx: SqlAccess): Promise<void> {
    await tx.run('DELETE FROM daily_nutrition_targets WHERE local_date=?', [localDate])
    await this.insertTarget(localDate, target, tx)
  }
  async clearTodayTarget(localDate: string, tx: SqlAccess): Promise<void> {
    await tx.run('DELETE FROM daily_nutrition_targets WHERE local_date=?', [localDate])
  }
  async mealsOn(localDate: string, tx: SqlAccess = this.db): Promise<MealWithEntries[]> {
    const meals = await tx.query<MealRecord>('SELECT * FROM meals WHERE local_date=? ORDER BY logged_at,id', [localDate])
    const result: MealWithEntries[] = []
    for (const meal of meals) result.push({ meal,
      entries: await tx.query<FoodEntryRecord>(`SELECT ${entryFields} FROM food_entries WHERE meal_id=? ORDER BY created_at,id`, [meal.id]) })
    return result
  }
  async addMealWithEntry(localDate: string, mealType: MealType, entry: FoodEntryInput, note: string | null = null): Promise<string> {
    return this.db.transaction(async (tx) => {
      const mealId = crypto.randomUUID()
      await tx.run('INSERT INTO meals (id,local_date,meal_type,logged_at,note) VALUES (?,?,?,?,?)',
        [mealId, localDate, mealType, new Date().toISOString(), note])
      await this.insertEntry(mealId, entry, tx)
      return mealId
    })
  }
  async insertEntry(mealId: string, entry: FoodEntryInput, tx: SqlAccess): Promise<string> {
    if (!entry.name.trim()) throw new Error('Food name is required')
    const id = crypto.randomUUID()
    await tx.run(`INSERT INTO food_entries (${entryFields}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, mealId, entry.name.trim(), entry.quantity, entry.unit, entry.calories_kcal, entry.protein_g,
        entry.carbs_g, entry.fat_g, entry.estimation_method, entry.confidence_level, entry.raw_input,
        new Date().toISOString()])
    return id
  }
  async updateEntry(id: string, changes: Partial<FoodEntryInput>): Promise<void> {
    await this.db.transaction(async (tx) => {
      const old = (await tx.query<FoodEntryRecord>('SELECT * FROM food_entries WHERE id=?', [id]))[0]
      if (!old) throw new Error('Food entry not found')
      const next = { ...old, ...changes }
      if (!next.name.trim()) throw new Error('Food name is required')
      await tx.run(`UPDATE food_entries SET name=?,quantity=?,unit=?,calories_kcal=?,protein_g=?,
        carbs_g=?,fat_g=?,estimation_method=?,confidence_level=?,raw_input=? WHERE id=?`,
      [next.name.trim(), next.quantity, next.unit, next.calories_kcal, next.protein_g, next.carbs_g,
        next.fat_g, next.estimation_method, next.confidence_level, next.raw_input, id])
    })
  }
  async deleteEntry(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = (await tx.query<{ meal_id: string }>('SELECT meal_id FROM food_entries WHERE id=?', [id]))[0]
      if (!row) return
      await tx.run('DELETE FROM food_entries WHERE id=?', [id])
      await tx.run('DELETE FROM meals WHERE id=? AND NOT EXISTS (SELECT 1 FROM food_entries WHERE meal_id=?)',
        [row.meal_id, row.meal_id])
    })
  }
  async templates(): Promise<MealTemplateRecord[]> {
    return this.db.query<MealTemplateRecord>('SELECT * FROM meal_templates ORDER BY use_count DESC,created_at DESC')
  }
  async saveTemplate(mealId: string, name: string): Promise<MealTemplateRecord> {
    if (!name.trim()) throw new Error('Template name is required')
    return this.db.transaction(async (tx) => {
      const meal = (await tx.query<MealRecord>('SELECT * FROM meals WHERE id=?', [mealId]))[0]
      if (!meal) throw new Error('Meal not found')
      const entries = await tx.query<FoodEntryRecord>(`SELECT ${entryFields} FROM food_entries WHERE meal_id=?`, [mealId])
      if (!entries.length) throw new Error('Cannot save an empty meal')
      const snapshot: MealTemplateSnapshot = { schemaVersion: 1, mealType: meal.meal_type, note: meal.note,
        entries: entries.map((entry) => ({ name: entry.name, quantity: entry.quantity, unit: entry.unit,
          calories_kcal: entry.calories_kcal, protein_g: entry.protein_g, carbs_g: entry.carbs_g,
          fat_g: entry.fat_g, estimation_method: entry.estimation_method,
          confidence_level: entry.confidence_level, raw_input: entry.raw_input })) }
      const id = crypto.randomUUID(), createdAt = new Date().toISOString()
      await tx.run(`INSERT INTO meal_templates (id,name,template_data_json,last_used_at,use_count,created_at)
        VALUES (?,?,?,NULL,0,?)`, [id, name.trim(), JSON.stringify(snapshot), createdAt])
      return { id, name: name.trim(), template_data_json: JSON.stringify(snapshot), last_used_at: null,
        use_count: 0, created_at: createdAt }
    })
  }
  async applyTemplate(templateId: string, localDate: string): Promise<string> {
    return this.db.transaction(async (tx) => {
      const template = (await tx.query<MealTemplateRecord>('SELECT * FROM meal_templates WHERE id=?', [templateId]))[0]
      if (!template) throw new Error('Template not found')
      const snapshot = JSON.parse(template.template_data_json) as MealTemplateSnapshot
      if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.entries) || !snapshot.entries.length)
        throw new Error('Unsupported meal template')
      const id = crypto.randomUUID()
      await tx.run('INSERT INTO meals (id,local_date,meal_type,logged_at,note) VALUES (?,?,?,?,?)',
        [id, localDate, snapshot.mealType, new Date().toISOString(), snapshot.note])
      for (const entry of snapshot.entries) await this.insertEntry(id, entry, tx)
      await tx.run('UPDATE meal_templates SET use_count=use_count+1,last_used_at=? WHERE id=?',
        [new Date().toISOString(), templateId])
      return id
    })
  }
  async copyYesterday(today: string, allowDuplicate = false): Promise<number> {
    const yesterday = new Date(`${today}T00:00:00Z`)
    if (Number.isNaN(yesterday.getTime()) || yesterday.toISOString().slice(0, 10) !== today)
      throw new Error('Invalid local date')
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const sourceDate = yesterday.toISOString().slice(0, 10)
    return this.db.transaction(async (tx) => {
      const existing = await tx.query<{ count: number }>('SELECT COUNT(*) AS count FROM meals WHERE local_date=?', [today])
      if ((existing[0]?.count ?? 0) > 0 && !allowDuplicate) throw new Error('DUPLICATE_CONFIRMATION_REQUIRED')
      const source = await this.mealsOn(sourceDate, tx)
      for (const item of source) {
        const id = crypto.randomUUID()
        await tx.run('INSERT INTO meals (id,local_date,meal_type,logged_at,note) VALUES (?,?,?,?,?)',
          [id, today, item.meal.meal_type, new Date().toISOString(), item.meal.note])
        for (const entry of item.entries) await this.insertEntry(id, {
          name: entry.name, quantity: entry.quantity, unit: entry.unit, calories_kcal: entry.calories_kcal,
          protein_g: entry.protein_g, carbs_g: entry.carbs_g, fat_g: entry.fat_g,
          estimation_method: entry.estimation_method, confidence_level: entry.confidence_level,
          raw_input: entry.raw_input,
        }, tx)
      }
      return source.length
    })
  }
}
