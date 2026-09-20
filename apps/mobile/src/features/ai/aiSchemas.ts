import type { AiTaskType } from '@motion/domain'

export type AiOutputContract = { mode: 'TEXT' } | { mode: 'JSON_SCHEMA'; schema: Record<string, unknown> }

const nullableNumber = (maximum: number) => ({ type: ['number', 'null'], minimum: 0, maximum })
const nullableString = () => ({ type: ['string', 'null'] })
const nullableEnum = (values: string[]) => ({ anyOf: [{ type: 'string', enum: values }, { type: 'null' }] })
const confidence = { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] }
const mealEstimateSchema = (): Record<string, unknown> => ({
  type: 'object', additionalProperties: false, required: ['items', 'mealEstimate', 'assumptions', 'confidence'],
  properties: {
    items: { type: 'array', minItems: 1, maxItems: 20, items: {
      type: 'object', additionalProperties: false,
      required: ['name', 'portionDescription', 'caloriesKcal', 'proteinG', 'carbsG', 'fatG', 'confidence'],
      properties: { name: { type: 'string' },
        portionDescription: nullableString(), caloriesKcal: nullableNumber(100_000),
        proteinG: nullableNumber(1_000), carbsG: nullableNumber(1_000), fatG: nullableNumber(1_000), confidence },
    } },
    mealEstimate: { type: 'object', additionalProperties: false,
      required: ['caloriesKcal', 'proteinG', 'carbsG', 'fatG'], properties: {
        caloriesKcal: nullableNumber(100_000), proteinG: nullableNumber(1_000),
        carbsG: nullableNumber(1_000), fatG: nullableNumber(1_000),
      } },
    assumptions: { type: 'array', maxItems: 8, items: { type: 'string' } }, confidence,
  },
})

export const MEAL_TEXT_SCHEMA = mealEstimateSchema()
export const MEAL_PHOTO_SCHEMA = mealEstimateSchema()
export const SCREENSHOT_ASSIST_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['weightKg', 'bodyFatPercent', 'bmi', 'muscleMassKg', 'skeletalMuscle', 'bodyWaterPercent',
    'visceralFatLevel', 'boneMassKg', 'bmrKcal', 'bodyAge'],
  properties: { weightKg: nullableNumber(500), bodyFatPercent: nullableNumber(100), bmi: nullableNumber(100),
    muscleMassKg: nullableNumber(500), skeletalMuscle: nullableNumber(100), bodyWaterPercent: nullableNumber(100),
    visceralFatLevel: nullableNumber(100), boneMassKg: nullableNumber(50), bmrKcal: nullableNumber(10_000),
    bodyAge: nullableNumber(150) },
}
export const WORKOUT_METADATA_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['activityType', 'estimatedIntensity', 'impactLevel', 'requiresEquipment', 'hasJumping', 'bodyAreas',
    'durationMinutes', 'confidence'],
  properties: { activityType: nullableString(),
    estimatedIntensity: nullableEnum(['LOW', 'MODERATE', 'HIGH']),
    impactLevel: nullableString(), requiresEquipment: { type: ['boolean', 'null'] },
    hasJumping: { type: ['boolean', 'null'] }, bodyAreas: { type: 'array', maxItems: 12,
      items: { type: 'string' } }, durationMinutes: nullableNumber(600), confidence },
}
export const TRAINING_PLAN_IMAGE_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['title', 'days'],
  properties: { title: nullableString(), days: { type: 'array', minItems: 1, maxItems: 366, items: {
    type: 'object', additionalProperties: false,
    required: ['dayIndex', 'originalLabel', 'title', 'isRestDay', 'expectedDurationMinutes', 'expectedIntensity', 'notes'],
    properties: { dayIndex: { type: 'integer', minimum: 1 }, originalLabel: nullableString(),
      title: nullableString(), isRestDay: { type: 'boolean' }, expectedDurationMinutes: nullableNumber(600),
      expectedIntensity: nullableEnum(['LOW', 'MODERATE', 'HIGH']), notes: nullableString() },
  } } },
}

export function outputContractFor(task: AiTaskType): AiOutputContract {
  switch (task) {
    case 'COACH': return { mode: 'TEXT' }
    case 'MEAL_TEXT': return { mode: 'JSON_SCHEMA', schema: MEAL_TEXT_SCHEMA }
    case 'MEAL_PHOTO': return { mode: 'JSON_SCHEMA', schema: MEAL_PHOTO_SCHEMA }
    case 'SCREENSHOT_ASSIST': return { mode: 'JSON_SCHEMA', schema: SCREENSHOT_ASSIST_SCHEMA }
    case 'WORKOUT_METADATA': return { mode: 'JSON_SCHEMA', schema: WORKOUT_METADATA_SCHEMA }
    case 'TRAINING_PLAN_IMAGE': return { mode: 'JSON_SCHEMA', schema: TRAINING_PLAN_IMAGE_SCHEMA }
  }
}
