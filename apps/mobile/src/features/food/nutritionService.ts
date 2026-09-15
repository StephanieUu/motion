import { ageOnDate, calculateDailyTarget, localDateAtStart, parseFoodText, remainingIntake, summarizeIntake,
  type ActivityLevel, type MealType, type NutritionGoal, type NutritionSex } from '@motion/domain'
import { Capacitor } from '@capacitor/core'
import { NutritionRepository, type FoodEntryInput } from '../../db/repositories/NutritionRepository'
import { getNativeDatabase } from '../../db/sqlite/nativeDatabase'

export interface NutritionSetup {
  birthDate: string | null; sex: NutritionSex | null; heightCm: number | null
  activityLevel: ActivityLevel | null; goal: NutritionGoal; targetWeightKg: number | null
  weightKg: number | null
}

export class NutritionService {
  constructor(readonly repository: NutritionRepository, private readonly now: () => Date = () => new Date()) {}
  today(): string { return localDateAtStart(this.now()) }

  async ensureDailyNutritionTarget(localDate: string) {
    return this.repository.transaction(async (tx) => {
      const existing = await this.repository.getTarget(localDate, tx)
      if (existing) return existing
      const profile = await this.repository.getProfile(tx)
      const weight = await this.repository.latestWeightOnOrBefore(localDate, tx)
      const calculated = calculateDailyTarget({ localDate, birthDate: profile?.birth_date ?? null,
        sex: profile?.sex as NutritionSex | null ?? null, heightCm: profile?.height_cm ?? null,
        activityLevel: profile?.activity_level ?? null, goal: profile?.goal_type as NutritionGoal | null ?? null,
        targetWeightKg: profile?.target_weight_kg ?? null,
        weight: weight ? { id: weight.id, localDate: weight.local_date, weightKg: weight.weight_kg } : null })
      if (!calculated) return null
      await this.repository.insertTarget(localDate, calculated, tx)
      return this.repository.getTarget(localDate, tx)
    })
  }

  async daily(localDate = this.today()) {
    const target = await this.ensureDailyNutritionTarget(localDate)
    const meals = await this.repository.mealsOn(localDate)
    const profile = !target ? await this.repository.getProfile() : null
    const age = profile?.birth_date ? ageOnDate(profile.birth_date, localDate) : null
    const summary = summarizeIntake(meals.flatMap((item) => item.entries.map((entry) => ({
      caloriesKcal: entry.calories_kcal, proteinG: entry.protein_g }))))
    const remaining = remainingIntake(summary, target ? {
      caloriesMin: target.calories_min, caloriesMax: target.calories_max, proteinMinG: target.protein_min_g,
    } : null)
    return { localDate, meals, target, summary, remaining,
      targetUnavailableReason: !target ? age !== null && age < 19 ? 'UNDER_19' as const
        : 'MISSING_SETUP' as const : null }
  }

  async setup() {
    const profile = await this.repository.getProfile()
    const weight = await this.repository.latestWeightOnOrBefore(this.today())
    return { profile, weight }
  }

  async saveSetup(input: NutritionSetup): Promise<void> {
    const localDate = this.today()
    await this.repository.transaction(async (tx) => {
      await this.repository.saveProfile({ birthDate: input.birthDate, sex: input.sex,
        heightCm: input.heightCm, goalType: input.goal, targetWeightKg: input.targetWeightKg,
        activityLevel: input.activityLevel }, tx)
      if (input.weightKg !== null) await this.repository.addManualWeight(input.weightKg, localDate, tx)
      const weight = await this.repository.latestWeightOnOrBefore(localDate, tx)
      const calculated = calculateDailyTarget({ localDate, birthDate: input.birthDate, sex: input.sex,
        heightCm: input.heightCm, activityLevel: input.activityLevel, goal: input.goal,
        targetWeightKg: input.targetWeightKg,
        weight: weight ? { id: weight.id, localDate: weight.local_date, weightKg: weight.weight_kg } : null })
      if (calculated) await this.repository.replaceTodayTarget(localDate, calculated, tx)
      else await this.repository.clearTodayTarget(localDate, tx)
    })
  }

  async logText(text: string, selectedMealType: MealType): Promise<void> {
    const parsed = parseFoodText(text)
    if (!parsed) throw new Error('请输入有效记录，不要使用负数。')
    const entry: FoodEntryInput = { name: parsed.name, quantity: null, unit: null,
      calories_kcal: parsed.caloriesKcal, protein_g: parsed.proteinG, carbs_g: null, fat_g: null,
      estimation_method: parsed.estimationMethod, confidence_level: parsed.confidenceLevel,
      raw_input: parsed.rawInput }
    await this.repository.addMealWithEntry(this.today(), parsed.mealType ?? selectedMealType, entry)
  }

  updateEntry(id: string, changes: Partial<FoodEntryInput>): Promise<void> {
    return this.repository.updateEntry(id, changes)
  }
  deleteEntry(id: string): Promise<void> { return this.repository.deleteEntry(id) }
  saveTemplate(mealId: string, name: string) { return this.repository.saveTemplate(mealId, name) }
  applyTemplate(id: string): Promise<string> { return this.repository.applyTemplate(id, this.today()) }
  templates() { return this.repository.templates() }
  copyYesterday(allowDuplicate: boolean): Promise<number> {
    return this.repository.copyYesterday(this.today(), allowDuplicate)
  }
}

export async function openNutritionService(): Promise<NutritionService> {
  if (!Capacitor.isNativePlatform()) throw new Error('Nutrition requires native SQLite')
  return new NutritionService(new NutritionRepository(await getNativeDatabase()))
}
