export type AiTaskType = 'COACH' | 'MEAL_TEXT' | 'MEAL_PHOTO' | 'SCREENSHOT_ASSIST' |
  'WORKOUT_METADATA' | 'TRAINING_PLAN_IMAGE'
export type AiProvider = 'GEMINI' | 'DEEPSEEK'
export type AiRoute = 'PROXY' | 'DIRECT_BYOK'
export type AiUsageStatus = 'RESERVED' | 'SUCCESS' | 'FAILED' | 'BLOCKED_BUDGET' | 'FALLBACK' | 'CANCELLED'
export type AiErrorCode = 'NETWORK' | 'QUOTA' | 'AUTH' | 'BUDGET' | 'INVALID_RESPONSE' |
  'PROVIDER' | 'TIMEOUT'
export type AiConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface AiMealItem {
  name: string
  portionDescription: string | null
  caloriesKcal: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  confidence: AiConfidence
}
export interface AiMealEstimate {
  items: AiMealItem[]
  mealEstimate: { caloriesKcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null }
  assumptions: string[]
  confidence: AiConfidence
}
export interface WorkoutMetadataDraft {
  activityType: string | null
  estimatedIntensity: string | null
  impactLevel: string | null
  requiresEquipment: boolean | null
  hasJumping: boolean | null
  bodyAreas: string[]
  durationMinutes: number | null
  confidence: AiConfidence
}
export interface TrainingPlanImageDraft {
  title: string | null
  days: Array<{ dayIndex: number; originalLabel: string | null; title: string | null; isRestDay: boolean
    expectedDurationMinutes: number | null; expectedIntensity: string | null; notes: string | null }>
}

const finiteOrNull = (value: unknown, maximum = 100_000): number | null => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum)
    throw new Error('INVALID_RESPONSE')
  return value
}
const textOrNull = (value: unknown, max = 240): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
const confidence = (value: unknown): AiConfidence => {
  if (value === 'HIGH' || value === 'MEDIUM' || value === 'LOW') return value
  throw new Error('INVALID_RESPONSE')
}

export function validateMealEstimate(value: unknown): AiMealEstimate {
  if (!value || typeof value !== 'object') throw new Error('INVALID_RESPONSE')
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.items) || !record.items.length || record.items.length > 20) throw new Error('INVALID_RESPONSE')
  const items = record.items.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('INVALID_RESPONSE')
    const row = item as Record<string, unknown>, name = textOrNull(row.name, 80)
    if (!name) throw new Error('INVALID_RESPONSE')
    return { name, portionDescription: textOrNull(row.portionDescription, 120), caloriesKcal: finiteOrNull(row.caloriesKcal),
      proteinG: finiteOrNull(row.proteinG, 1_000), carbsG: finiteOrNull(row.carbsG, 1_000),
      fatG: finiteOrNull(row.fatG, 1_000), confidence: confidence(row.confidence) }
  })
  const estimate = record.mealEstimate && typeof record.mealEstimate === 'object'
    ? record.mealEstimate as Record<string, unknown> : {}
  return { items, mealEstimate: { caloriesKcal: finiteOrNull(estimate.caloriesKcal),
    proteinG: finiteOrNull(estimate.proteinG, 1_000), carbsG: finiteOrNull(estimate.carbsG, 1_000),
    fatG: finiteOrNull(estimate.fatG, 1_000) }, assumptions: Array.isArray(record.assumptions)
      ? record.assumptions.map((item) => textOrNull(item, 160)).filter((item): item is string => !!item).slice(0, 8) : [],
    confidence: confidence(record.confidence) }
}

export function validateWorkoutMetadata(value: unknown): WorkoutMetadataDraft {
  if (!value || typeof value !== 'object') throw new Error('INVALID_RESPONSE')
  const row = value as Record<string, unknown>
  const nullableBoolean = (item: unknown) => {
    if (item === null || item === undefined) return null
    if (typeof item !== 'boolean') throw new Error('INVALID_RESPONSE')
    return item
  }
  const intensity = textOrNull(row.estimatedIntensity, 40)?.toUpperCase()
  if (intensity && intensity !== 'LOW' && intensity !== 'MODERATE' && intensity !== 'HIGH')
    throw new Error('INVALID_RESPONSE')
  return { activityType: textOrNull(row.activityType, 80), estimatedIntensity:
    intensity === 'LOW' || intensity === 'MODERATE' || intensity === 'HIGH' ? intensity : null,
    impactLevel: textOrNull(row.impactLevel, 40), requiresEquipment: nullableBoolean(row.requiresEquipment),
    hasJumping: nullableBoolean(row.hasJumping), bodyAreas: Array.isArray(row.bodyAreas)
      ? row.bodyAreas.map((item) => textOrNull(item, 40)).filter((item): item is string => !!item).slice(0, 12) : [],
    durationMinutes: finiteOrNull(row.durationMinutes, 600), confidence: confidence(row.confidence) }
}

export function validateTrainingPlanDraft(value: unknown): TrainingPlanImageDraft {
  if (!value || typeof value !== 'object') throw new Error('INVALID_RESPONSE')
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.days) || !row.days.length || row.days.length > 366) throw new Error('INVALID_RESPONSE')
  const seen = new Set<number>()
  const days = row.days.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('INVALID_RESPONSE')
    const day = item as Record<string, unknown>, dayIndex = day.dayIndex
    if (typeof dayIndex !== 'number' || !Number.isInteger(dayIndex) || dayIndex <= 0 || seen.has(dayIndex))
      throw new Error('INVALID_RESPONSE')
    seen.add(dayIndex)
    if (typeof day.isRestDay !== 'boolean') throw new Error('INVALID_RESPONSE')
    const expectedIntensity = textOrNull(day.expectedIntensity, 40)?.toUpperCase()
    if (expectedIntensity && expectedIntensity !== 'LOW' && expectedIntensity !== 'MODERATE' && expectedIntensity !== 'HIGH')
      throw new Error('INVALID_RESPONSE')
    return { dayIndex, originalLabel: textOrNull(day.originalLabel), title: textOrNull(day.title),
      isRestDay: day.isRestDay === true, expectedDurationMinutes: finiteOrNull(day.expectedDurationMinutes, 600),
      expectedIntensity: expectedIntensity === 'LOW' || expectedIntensity === 'MODERATE' || expectedIntensity === 'HIGH'
        ? expectedIntensity : null, notes: textOrNull(day.notes, 500) }
  }).sort((a, b) => a.dayIndex - b.dayIndex)
  if (days.some((day, index) => day.dayIndex !== index + 1)) throw new Error('INVALID_RESPONSE')
  return { title: textOrNull(row.title, 120), days }
}
