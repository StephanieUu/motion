import type { AiTaskType } from '@motion/domain'

// Budget policy v1 deliberately uses conservative upper bounds. The estimates are
// for dispatch protection, not billing claims, and are kept in one versioned table.
export const AI_PRICING_POLICY_VERSION = 1
const MAX_PROMPT_CHARS = 32_000
const DEEPSEEK_CNY_PER_MILLION_INPUT_TOKENS = 4
const DEEPSEEK_CNY_PER_MILLION_OUTPUT_TOKENS = 8
const ESTIMATE_SAFETY_FACTOR = 1.5

const outputCaps: Partial<Record<AiTaskType, number>> = {
  COACH: 800,
  MEAL_TEXT: 1_200,
  SCREENSHOT_ASSIST: 700,
  WORKOUT_METADATA: 700,
}

export function maxOutputTokens(taskType: AiTaskType): number {
  return outputCaps[taskType] ?? 1_200
}

export function estimateDeepSeekUpperBoundCny(taskType: AiTaskType, prompt: string): number | null {
  const outputTokens = outputCaps[taskType]
  if (!outputTokens || prompt.length > MAX_PROMPT_CHARS) return null
  const conservativeInputTokens = Math.ceil(prompt.length / 2)
  const estimate = ESTIMATE_SAFETY_FACTOR * (
    conservativeInputTokens * DEEPSEEK_CNY_PER_MILLION_INPUT_TOKENS +
    outputTokens * DEEPSEEK_CNY_PER_MILLION_OUTPUT_TOKENS
  ) / 1_000_000
  return Math.ceil(estimate * 10_000) / 10_000
}
