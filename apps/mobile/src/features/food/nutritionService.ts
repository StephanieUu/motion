import { addLocalDays, ageOnDate, calculateDailyTarget, calculateNutritionPlanTarget, localDateAtStart,
  parseFoodText, remainingIntake, summarizeIntake, validateNutritionPlanConfig,
  type ActivityLevel, type MealType, type NutritionGoal, type NutritionPlanConfig, type NutritionSex } from '@motion/domain'
import { Capacitor } from '@capacitor/core'
import { NutritionRepository, type FoodEntryInput } from '../../db/repositories/NutritionRepository'
import { getNativeDatabase } from '../../db/sqlite/nativeDatabase'

export interface NutritionSetup {
  birthDate: string | null; sex: NutritionSex | null; heightCm: number | null
  activityLevel: ActivityLevel | null; goal: NutritionGoal; targetWeightKg: number | null
  weightKg: number | null
}

export function planConfigFromRecord(run: Awaited<ReturnType<NutritionRepository['applicablePlanRun']>>): NutritionPlanConfig | null {
  return run ? { baseStrategy: run.base_strategy, highProtein: run.high_protein === 1,
    treEnabled: run.tre_enabled === 1, treStartLocalTime: run.tre_start_local_time,
    treWindowMinutes: run.tre_window_minutes, flexibleWeekday: run.flexible_weekday } : null
}

export class NutritionService {
  constructor(readonly repository: NutritionRepository, private readonly now: () => Date = () => new Date()) {}
  today(): string { return localDateAtStart(this.now()) }

  private async planStartDate(today: string, mealCount: number, tx?: Parameters<NutritionRepository['currentPlanRuns']>[0]) {
    const current = await this.repository.currentPlanRuns(tx)
    return mealCount > 0 || current.active?.starts_on === today ? addLocalDays(today, 1) : today
  }

  async ensureDailyNutritionTarget(localDate: string) {
    return this.repository.transaction(async (tx) => {
      await this.repository.activateDuePlan(this.today(), tx)
      const existing = await this.repository.getTarget(localDate, tx)
      if (existing) return existing
      const profile = await this.repository.getProfile(tx)
      const weight = await this.repository.latestWeightOnOrBefore(localDate, tx)
      const baseInput = { localDate, birthDate: profile?.birth_date ?? null,
        sex: profile?.sex as NutritionSex | null ?? null, heightCm: profile?.height_cm ?? null,
        activityLevel: profile?.activity_level ?? null,
        targetWeightKg: profile?.target_weight_kg ?? null,
        weight: weight ? { id: weight.id, localDate: weight.local_date, weightKg: weight.weight_kg } : null }
      const run = await this.repository.applicablePlanRun(localDate, tx)
      const config = planConfigFromRecord(run)
      const calculated = run && config ? calculateNutritionPlanTarget({ ...baseInput, planRunId: run.id, config })
        : calculateDailyTarget({ ...baseInput, goal: profile?.goal_type as NutritionGoal | null ?? null })
      if (!calculated) return null
      await this.repository.insertTarget(localDate, calculated, tx, run?.id ?? null)
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
    const planRun = await this.repository.applicablePlanRun(localDate)
    return { localDate, meals, target, summary, remaining, planRun, planConfig: planConfigFromRecord(planRun),
      targetUnavailableReason: !target ? age !== null && age < 19 ? 'UNDER_19' as const
        : 'MISSING_SETUP' as const : null }
  }

  async setup() {
    const profile = await this.repository.getProfile()
    const weight = await this.repository.latestWeightOnOrBefore(this.today())
    return { profile, weight }
  }

  async plans() {
    await this.repository.transaction((tx) => this.repository.activateDuePlan(this.today(), tx))
    const [current, history] = await Promise.all([this.repository.currentPlanRuns(), this.repository.planHistory()])
    return { ...current, history }
  }

  async previewPlan(config: NutritionPlanConfig) {
    validateNutritionPlanConfig(config)
    const today = this.today()
    await this.repository.transaction((tx) => this.repository.activateDuePlan(today, tx))
    const [profile, weight, mealCount] = await Promise.all([this.repository.getProfile(),
      this.repository.latestWeightOnOrBefore(today), this.repository.mealCountOn(today)])
    const startsOn = await this.planStartDate(today, mealCount)
    const target = calculateNutritionPlanTarget({ localDate: startsOn, planRunId: 'PREVIEW', config,
      birthDate: profile?.birth_date ?? null, sex: profile?.sex as NutritionSex | null ?? null,
      heightCm: profile?.height_cm ?? null, activityLevel: profile?.activity_level ?? null,
      targetWeightKg: profile?.target_weight_kg ?? null,
      weight: weight ? { id: weight.id, localDate: weight.local_date, weightKg: weight.weight_kg } : null })
    const age = profile?.birth_date ? ageOnDate(profile.birth_date, startsOn) : null
    return { config, startsOn, target, unavailableReason: target ? null
      : age !== null && age < 19 ? 'UNDER_19' as const : 'MISSING_SETUP' as const,
      startsTomorrow: startsOn !== today }
  }

  async confirmPlan(config: NutritionPlanConfig): Promise<string> {
    validateNutritionPlanConfig(config)
    const today = this.today()
    return this.repository.transaction(async (tx) => {
      await this.repository.activateDuePlan(today, tx)
      const mealCount = await this.repository.mealCountOn(today, tx)
      const startsOn = await this.planStartDate(today, mealCount, tx)
      const profile = await this.repository.getProfile(tx)
      const weight = await this.repository.latestWeightOnOrBefore(startsOn, tx)
      const target = calculateNutritionPlanTarget({ localDate: startsOn, planRunId: 'PENDING', config,
        birthDate: profile?.birth_date ?? null, sex: profile?.sex as NutritionSex | null ?? null,
        heightCm: profile?.height_cm ?? null, activityLevel: profile?.activity_level ?? null,
        targetWeightKg: profile?.target_weight_kg ?? null,
        weight: weight ? { id: weight.id, localDate: weight.local_date, weightKg: weight.weight_kg } : null })
      const age = profile?.birth_date ? ageOnDate(profile.birth_date, startsOn) : null
      if (!target) throw new Error(age !== null && age < 19
        ? '成人自动营养方案适用于 19 岁及以上用户。' : '请先完善个人资料。')
      const id = await this.repository.createPlanRun(config, startsOn, today, tx)
      if (startsOn === today) {
        await this.repository.clearTodayTarget(today, tx)
        const persisted = { ...target, rationale: { ...target.rationale, nutritionPlanRunId: id } }
        await this.repository.insertTarget(today, persisted, tx, id)
      }
      return id
    })
  }

  async saveSetup(input: NutritionSetup): Promise<void> {
    const localDate = this.today()
    await this.repository.transaction(async (tx) => {
      await this.repository.activateDuePlan(localDate, tx)
      await this.repository.saveProfile({ birthDate: input.birthDate, sex: input.sex,
        heightCm: input.heightCm, goalType: input.goal, targetWeightKg: input.targetWeightKg,
        activityLevel: input.activityLevel }, tx)
      if (input.weightKg !== null) await this.repository.addManualWeight(input.weightKg, localDate, tx)
      const weight = await this.repository.latestWeightOnOrBefore(localDate, tx)
      const run = await this.repository.applicablePlanRun(localDate, tx)
      const config = planConfigFromRecord(run)
      const targetInput = { localDate, birthDate: input.birthDate, sex: input.sex,
        heightCm: input.heightCm, activityLevel: input.activityLevel,
        targetWeightKg: input.targetWeightKg,
        weight: weight ? { id: weight.id, localDate: weight.local_date, weightKg: weight.weight_kg } : null }
      const calculated = run && config ? calculateNutritionPlanTarget({ ...targetInput, planRunId: run.id, config })
        : calculateDailyTarget({ ...targetInput, goal: input.goal })
      if (calculated) {
        await this.repository.clearTodayTarget(localDate, tx)
        await this.repository.insertTarget(localDate, calculated, tx, run?.id ?? null)
      }
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
