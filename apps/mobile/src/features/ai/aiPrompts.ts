import type { AiTaskType } from '@motion/domain'

const safetyRules = `Do not diagnose disease, prescribe medication,
or recommend punishment exercise, fasting compensation, calorie debt, or extreme restriction. State uncertainty factually.`
const rules = `Return only valid JSON. Unknown numeric values must be null. ${safetyRules}`

export function promptFor(task: AiTaskType, payload: Record<string, unknown>): string {
  const input = JSON.stringify(payload)
  switch (task) {
    case 'MEAL_TEXT': return `${rules}\nEstimate the described meal. Schema: {"items":[{"name":string,"portionDescription":string|null,"caloriesKcal":number|null,"proteinG":number|null,"carbsG":number|null,"fatG":number|null,"confidence":"HIGH"|"MEDIUM"|"LOW"}],"mealEstimate":{"caloriesKcal":number|null,"proteinG":number|null,"carbsG":number|null,"fatG":number|null},"assumptions":string[],"confidence":"HIGH"|"MEDIUM"|"LOW"}. Input: ${input}`
    case 'MEAL_PHOTO': return `${rules}\nEstimate only visible food. Use the same meal schema. Image has been selected by the user. Metadata was removed. Details: ${input}`
    case 'COACH': return `${safetyRules}\nYou are Motion Coach. Provide only a concise Simplified Chinese answer grounded in the supplied summaries. Input: ${input}`
    case 'SCREENSHOT_ASSIST': return `${rules}\nExtract body metrics from the supplied OCR text only. Return {"weightKg":number|null,"bodyFatPercent":number|null,"bmi":number|null,"muscleMassKg":number|null,"skeletalMuscle":number|null,"bodyWaterPercent":number|null,"visceralFatLevel":number|null,"boneMassKg":number|null,"bmrKcal":number|null,"bodyAge":number|null}. Input: ${input}`
    case 'WORKOUT_METADATA': return `${rules}\nInfer a workout metadata draft. Return {"activityType":string|null,"estimatedIntensity":string|null,"impactLevel":string|null,"requiresEquipment":boolean|null,"hasJumping":boolean|null,"bodyAreas":string[],"durationMinutes":number|null,"confidence":"HIGH"|"MEDIUM"|"LOW"}. Input: ${input}`
    case 'TRAINING_PLAN_IMAGE': return `${rules}\nTranscribe the training plan image into an editable draft. Return {"title":string|null,"days":[{"dayIndex":number,"originalLabel":string|null,"title":string|null,"isRestDay":boolean,"expectedDurationMinutes":number|null,"expectedIntensity":string|null,"notes":string|null}]}. Do not invent workout database IDs. Input: ${input}`
  }
}
