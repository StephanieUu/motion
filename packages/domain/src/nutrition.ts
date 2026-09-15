import { addLocalDays } from './index'

export type ActivityLevel = 'INACTIVE' | 'LOW_ACTIVE' | 'ACTIVE' | 'VERY_ACTIVE'
export type NutritionSex = 'MALE' | 'FEMALE'
export type NutritionGoal = 'MAINTENANCE' | 'FAT_LOSS'
export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' | 'OTHER'
export type EstimationMethod = 'EXACT_WEIGHT' | 'PACKAGE_LABEL' | 'FOOD_DATABASE' | 'TEXT_AI' | 'PHOTO_AI' | 'ROUGH_CALORIE' | 'MANUAL'
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'ROUGH'
export const NUTRITION_CALCULATION_VERSION = 'NASEM_2023_M7_V1'
export const NUTRITION_PLAN_CALCULATION_VERSION = 'NASEM_2023_M8_V1'
export const NUTRITION_PLAN_CONFIG_VERSION = 1
export type NutritionBaseStrategy = 'STABLE_FAT_LOSS' | 'FOCUSED_FAT_LOSS' | 'MAINTENANCE'
export type NutritionPlanStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED'
export type NutritionDayType = 'NORMAL' | 'MAINTENANCE' | 'FLEXIBLE'

export interface NutritionPlanConfig {
  baseStrategy: NutritionBaseStrategy
  highProtein: boolean
  treEnabled: boolean
  treStartLocalTime: string | null
  treWindowMinutes: number | null
  flexibleWeekday: number | null
}

export interface NutritionPlanTargetInput extends Omit<TargetInput, 'goal'> {
  planRunId: string
  config: NutritionPlanConfig
}

export interface CalculatedPlanTarget {
  caloriesMin: number
  caloriesMax: number
  proteinMinG: number
  proteinMaxG: number
  dayType: NutritionDayType
  calculationVersion: typeof NUTRITION_PLAN_CALCULATION_VERSION
  rationale: Record<string, unknown>
}

export interface TargetInput {
  localDate: string
  birthDate: string | null
  sex: NutritionSex | null
  heightCm: number | null
  activityLevel: ActivityLevel | null
  goal: NutritionGoal | null
  targetWeightKg: number | null
  weight: { id: string; weightKg: number; localDate: string } | null
}

export interface CalculatedTarget {
  caloriesMin: number
  caloriesMax: number
  proteinMinG: number
  proteinMaxG: number
  dayType: 'NORMAL'
  calculationVersion: typeof NUTRITION_CALCULATION_VERSION
  rationale: {
    localDate: string; age: number; sex: NutritionSex; heightCm: number; weightKg: number
    bodyMeasurementId: string; weightLocalDate: string; activityLevel: ActivityLevel
    goal: NutritionGoal; estimatedEerKcal: number; deficitKcal: [number, number] | null
    calorieFloorKcal: number | null; proteinReferenceWeightKg: number
    proteinReferenceSource: 'CURRENT_WEIGHT' | 'TARGET_WEIGHT'; formulaVersion: typeof NUTRITION_CALCULATION_VERSION
  }
}

const coefficients: Record<NutritionSex, Record<ActivityLevel, [number, number, number, number]>> = {
  MALE: {
    INACTIVE: [753.07, -10.83, 6.50, 14.10],
    LOW_ACTIVE: [581.47, -10.83, 8.30, 14.94],
    ACTIVE: [1004.82, -10.83, 6.52, 15.91],
    VERY_ACTIVE: [-517.88, -10.83, 15.61, 19.11],
  },
  FEMALE: {
    INACTIVE: [584.90, -7.01, 5.72, 11.71],
    LOW_ACTIVE: [575.77, -7.01, 6.60, 12.14],
    ACTIVE: [710.25, -7.01, 6.54, 12.34],
    VERY_ACTIVE: [511.83, -7.01, 9.07, 12.56],
  },
}

function validLocalDate(value: string): boolean {
  try { return addLocalDays(value, 0) === value } catch { return false }
}

export function ageOnDate(birthDate: string, localDate: string): number | null {
  if (!validLocalDate(birthDate) || !validLocalDate(localDate) || birthDate > localDate) return null
  const [year, month, day] = birthDate.split('-').map(Number)
  const [atYear, atMonth, atDay] = localDate.split('-').map(Number)
  return atYear! - year! - (atMonth! < month! || (atMonth === month && atDay! < day!) ? 1 : 0)
}

export function estimatedEer(sex: NutritionSex, level: ActivityLevel, age: number,
  heightCm: number, weightKg: number): number {
  const [base, ageCoefficient, heightCoefficient, weightCoefficient] = coefficients[sex][level]
  return base + ageCoefficient * age + heightCoefficient * heightCm + weightCoefficient * weightKg
}

const round50 = (value: number) => Math.round(value / 50) * 50

export function validateNutritionPlanConfig(config: NutritionPlanConfig): void {
  if (!(['STABLE_FAT_LOSS', 'FOCUSED_FAT_LOSS', 'MAINTENANCE'] as const).includes(config.baseStrategy))
    throw new Error('Invalid nutrition base strategy')
  if (config.treEnabled) {
    if (!config.treStartLocalTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.treStartLocalTime))
      throw new Error('TRE start time is required')
    if (config.treWindowMinutes === null || config.treWindowMinutes < 480 || config.treWindowMinutes > 720 ||
      config.treWindowMinutes % 60 !== 0) throw new Error('TRE window must be 8–12 hours')
  } else if (config.treStartLocalTime !== null || config.treWindowMinutes !== null) {
    throw new Error('Disabled TRE must not retain a window')
  }
  if (config.flexibleWeekday !== null &&
    (!Number.isInteger(config.flexibleWeekday) || config.flexibleWeekday < 0 || config.flexibleWeekday > 6))
    throw new Error('Flexible weekday must be between 0 and 6')
  if (config.baseStrategy === 'MAINTENANCE' && config.flexibleWeekday !== null)
    throw new Error('Maintenance does not support a flexible day')
}

function nutritionInputs(input: Omit<TargetInput, 'goal'>, useTargetWeight: boolean) {
  const { birthDate, sex, heightCm, activityLevel, weight, targetWeightKg, localDate } = input
  if (!birthDate || !sex || !heightCm || !activityLevel || !weight || !validLocalDate(localDate) ||
    weight.localDate > localDate || !Number.isFinite(heightCm) || heightCm <= 0 ||
    !Number.isFinite(weight.weightKg) || weight.weightKg <= 0 || !(sex in coefficients) ||
    !(activityLevel in coefficients[sex])) return null
  const age = ageOnDate(birthDate, localDate)
  if (age === null || age < 19) return null
  const eer = estimatedEer(sex, activityLevel, age, heightCm, weight.weightKg)
  const validTargetWeight = useTargetWeight && targetWeightKg !== null && Number.isFinite(targetWeightKg) && targetWeightKg > 0 &&
    targetWeightKg < weight.weightKg && targetWeightKg >= 18.5 * (heightCm / 100) ** 2
  return { age, eer, reference: validTargetWeight ? targetWeightKg : weight.weightKg,
    referenceSource: validTargetWeight ? 'TARGET_WEIGHT' as const : 'CURRENT_WEIGHT' as const }
}

export function calculateNutritionPlanTarget(input: NutritionPlanTargetInput): CalculatedPlanTarget | null {
  validateNutritionPlanConfig(input.config)
  const facts = nutritionInputs(input, input.config.baseStrategy !== 'MAINTENANCE')
  if (!facts) return null
  const weekday = new Date(`${input.localDate}T00:00:00Z`).getUTCDay()
  const flexible = input.config.flexibleWeekday === weekday && input.config.baseStrategy !== 'MAINTENANCE'
  const effectiveStrategy: NutritionBaseStrategy = flexible ? 'MAINTENANCE' : input.config.baseStrategy
  const deficit: [number, number] | null = effectiveStrategy === 'STABLE_FAT_LOSS' ? [500, 300]
    : effectiveStrategy === 'FOCUSED_FAT_LOSS' ? [750, 500] : null
  const floor = deficit ? (input.sex === 'FEMALE' ? 1200 : 1500) : null
  const caloriesMin = deficit ? round50(Math.max(floor!, facts.eer - deficit[0])) : round50(facts.eer - 100)
  const caloriesMax = deficit ? round50(Math.max(floor!, facts.eer - deficit[1])) : round50(facts.eer + 100)
  const factors: [number, number] = input.config.highProtein
    ? input.config.baseStrategy === 'MAINTENANCE' ? [1.2, 1.6] : [1.4, 1.6]
    : input.config.baseStrategy === 'MAINTENANCE' ? [0.8, 1.2] : [1.2, 1.6]
  const dayType: NutritionDayType = flexible ? 'FLEXIBLE'
    : input.config.baseStrategy === 'MAINTENANCE' ? 'MAINTENANCE' : 'NORMAL'
  return { caloriesMin, caloriesMax, proteinMinG: Math.round(facts.reference * factors[0]),
    proteinMaxG: Math.round(facts.reference * factors[1]), dayType,
    calculationVersion: NUTRITION_PLAN_CALCULATION_VERSION,
    rationale: { localDate: input.localDate, age: facts.age, sex: input.sex, heightCm: input.heightCm,
      weightKg: input.weight!.weightKg, bodyMeasurementId: input.weight!.id,
      weightLocalDate: input.weight!.localDate, activityLevel: input.activityLevel,
      proteinReferenceWeightKg: facts.reference, proteinReferenceSource: facts.referenceSource,
      estimatedEerKcal: facts.eer, baseStrategy: input.config.baseStrategy,
      effectiveStrategy, deficitKcal: deficit, calorieFloorKcal: floor,
      highProtein: input.config.highProtein, proteinFactors: factors,
      treEnabled: input.config.treEnabled, treStartLocalTime: input.config.treStartLocalTime,
      treWindowMinutes: input.config.treWindowMinutes, flexibleWeekday: input.config.flexibleWeekday,
      flexibleDay: flexible, nutritionPlanRunId: input.planRunId,
      nutritionPlanConfigVersion: NUTRITION_PLAN_CONFIG_VERSION, dayType,
      formulaVersion: NUTRITION_PLAN_CALCULATION_VERSION } }
}

export function calculateDailyTarget(input: TargetInput): CalculatedTarget | null {
  const { birthDate, sex, heightCm, activityLevel, goal, weight, targetWeightKg, localDate } = input
  if (!birthDate || !sex || !heightCm || !activityLevel || !goal || !weight ||
    !validLocalDate(localDate) || weight.localDate > localDate || !Number.isFinite(heightCm) || heightCm <= 0 ||
    !Number.isFinite(weight.weightKg) || weight.weightKg <= 0 ||
    !(sex in coefficients) || !(activityLevel in coefficients[sex]) ||
    (goal !== 'MAINTENANCE' && goal !== 'FAT_LOSS')) return null
  const age = ageOnDate(birthDate, localDate)
  if (age === null || age < 19) return null
  const eer = estimatedEer(sex, activityLevel, age, heightCm, weight.weightKg)
  const floor = goal === 'FAT_LOSS' ? (sex === 'FEMALE' ? 1200 : 1500) : null
  const caloriesMin = goal === 'FAT_LOSS' ? round50(Math.max(floor!, eer - 750)) : round50(eer - 100)
  const caloriesMax = goal === 'FAT_LOSS' ? round50(Math.max(floor!, eer - 500)) : round50(eer + 100)
  const validTargetWeight = goal === 'FAT_LOSS' && targetWeightKg !== null &&
    Number.isFinite(targetWeightKg) && targetWeightKg > 0 && targetWeightKg < weight.weightKg &&
    targetWeightKg >= 18.5 * (heightCm / 100) ** 2
  const reference = validTargetWeight ? targetWeightKg : weight.weightKg
  const proteinFactors = goal === 'FAT_LOSS' ? [1.2, 1.6] : [0.8, 1.2]
  return {
    caloriesMin, caloriesMax,
    proteinMinG: Math.round(reference * proteinFactors[0]!),
    proteinMaxG: Math.round(reference * proteinFactors[1]!),
    dayType: 'NORMAL', calculationVersion: NUTRITION_CALCULATION_VERSION,
    rationale: {
      localDate, age, sex, heightCm, weightKg: weight.weightKg, bodyMeasurementId: weight.id,
      weightLocalDate: weight.localDate, activityLevel, goal, estimatedEerKcal: eer,
      deficitKcal: goal === 'FAT_LOSS' ? [750, 500] : null, calorieFloorKcal: floor,
      proteinReferenceWeightKg: reference,
      proteinReferenceSource: validTargetWeight ? 'TARGET_WEIGHT' : 'CURRENT_WEIGHT',
      formulaVersion: NUTRITION_CALCULATION_VERSION,
    },
  }
}

export interface NutritionAmount { caloriesKcal: number | null; proteinG: number | null }
export interface IntakeSummary {
  caloriesKnown: number; proteinKnown: number; unknownCalories: number; unknownProtein: number
  entryCount: number
}
export function summarizeIntake(entries: readonly NutritionAmount[]): IntakeSummary {
  return entries.reduce<IntakeSummary>((total, entry) => ({
    caloriesKnown: total.caloriesKnown + (entry.caloriesKcal ?? 0),
    proteinKnown: total.proteinKnown + (entry.proteinG ?? 0),
    unknownCalories: total.unknownCalories + Number(entry.caloriesKcal === null),
    unknownProtein: total.unknownProtein + Number(entry.proteinG === null),
    entryCount: total.entryCount + 1,
  }), { caloriesKnown: 0, proteinKnown: 0, unknownCalories: 0, unknownProtein: 0, entryCount: 0 })
}

export type CalorieRangeState = 'NO_TARGET' | 'BELOW' | 'IN_RANGE' | 'OVER'
export function remainingIntake(summary: IntakeSummary, target: Pick<CalculatedTarget,
  'caloriesMin' | 'caloriesMax' | 'proteinMinG'> | null) {
  const calorieState: CalorieRangeState = !target ? 'NO_TARGET' : summary.caloriesKnown < target.caloriesMin
    ? 'BELOW' : summary.caloriesKnown > target.caloriesMax ? 'OVER' : 'IN_RANGE'
  return { calorieState,
    caloriesRemainingMin: target ? Math.max(0, target.caloriesMin - summary.caloriesKnown) : null,
    caloriesRemainingMax: target ? Math.max(0, target.caloriesMax - summary.caloriesKnown) : null,
    proteinGapG: target ? Math.max(0, target.proteinMinG - summary.proteinKnown) : null,
    caloriesPartial: summary.unknownCalories > 0, proteinPartial: summary.unknownProtein > 0 }
}

export interface ParsedFoodText {
  name: string; rawInput: string; mealType: MealType | null; caloriesKcal: number | null
  proteinG: number | null; estimationMethod: EstimationMethod; confidenceLevel: ConfidenceLevel
}
export function parseFoodText(rawInput: string): ParsedFoodText | null {
  const text = rawInput.trim()
  if (!text || /(?:^|[^\d])[-−]\s*\d+(?:\.\d+)?\s*(?:kcal|千卡|大卡|克|g)/i.test(text)) return null
  const calorie = /(?:^|[^\d])(?:约|大约)?\s*(\d+(?:\.\d+)?)\s*(?:kcal|千卡|大卡)/i.exec(text)
  const protein = /蛋白质?\s*(\d+(?:\.\d+)?)\s*(?:克|g)/i.exec(text)
  const mealType: MealType | null = /早餐|早饭/.test(text) ? 'BREAKFAST'
    : /午餐|午饭/.test(text) ? 'LUNCH' : /晚餐|晚饭/.test(text) ? 'DINNER'
      : /零食|加餐/.test(text) ? 'SNACK' : null
  const rough = /大约|约|左右|差不多/.test(text)
  const name = text.replace(/(?:大约|约)?\s*\d+(?:\.\d+)?\s*(?:kcal|千卡|大卡)/ig, '')
    .replace(/蛋白质?\s*\d+(?:\.\d+)?\s*(?:克|g)/ig, '').replace(/[，,、·\s]+$/g, '').trim()
  return { name: name || '快速记录', rawInput: text, mealType,
    caloriesKcal: calorie ? Number(calorie[1]) : null, proteinG: protein ? Number(protein[1]) : null,
    estimationMethod: rough ? 'ROUGH_CALORIE' : 'MANUAL', confidenceLevel: rough ? 'ROUGH' : 'MEDIUM' }
}
