import type { AiProvider, AiRoute } from '@motion/domain'
import { AppPreferencesRepository } from '../../db/repositories/AppPreferencesRepository'

export type AiStrategy = 'FREE_FIRST'
export interface AiSettings {
  enabled: boolean
  privacyAcknowledged: boolean
  route: AiRoute
  strategy: AiStrategy
  geminiEnabled: boolean
  deepseekEnabled: boolean
  geminiModel: string
  deepseekModel: string
  monthlyPaidBudgetCny: number
  context: { trainingToday: boolean; nutritionToday: boolean; currentPlans: boolean;
    bodyTrend: boolean; healthSummary: boolean }
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false, privacyAcknowledged: false, route: 'DIRECT_BYOK', strategy: 'FREE_FIRST',
  geminiEnabled: true, deepseekEnabled: false, geminiModel: 'gemini-3.8-flash', deepseekModel: 'deepseek-chat',
  monthlyPaidBudgetCny: 0,
  context: { trainingToday: true, nutritionToday: true, currentPlans: true, bodyTrend: true, healthSummary: true },
}

const keys = {
  enabled: 'ai.enabled', acknowledged: 'ai.privacyAcknowledged', route: 'ai.route', strategy: 'ai.strategy',
  gemini: 'ai.gemini.enabled', deepseek: 'ai.deepseek.enabled', geminiModel: 'ai.gemini.model',
  deepseekModel: 'ai.deepseek.model', budget: 'ai.monthlyPaidBudgetCny', training: 'ai.context.trainingToday',
  nutrition: 'ai.context.nutritionToday', plans: 'ai.context.currentPlans', body: 'ai.context.bodyTrend',
  health: 'ai.context.healthSummary',
} as const
const bool = (value: string | null, fallback: boolean) => value === null ? fallback : value === 'true'
const currentGeminiModel = (stored: string | null): string => {
  const model = stored?.trim()
  return !model || model === 'gemini-3.7-flash' ? DEFAULT_AI_SETTINGS.geminiModel : model
}

export class AiSettingsStore {
  constructor(private readonly preferences: AppPreferencesRepository) {}
  async load(): Promise<AiSettings> {
    const values = await Promise.all(Object.values(keys).map((key) => this.preferences.get(key)))
    const value = Object.fromEntries(Object.keys(keys).map((key, index) => [key, values[index]])) as Record<keyof typeof keys, string | null>
    const budget = Number(value.budget)
    return { enabled: bool(value.enabled, false), privacyAcknowledged: bool(value.acknowledged, false),
      route: value.route === 'PROXY' ? 'PROXY' : 'DIRECT_BYOK', strategy: 'FREE_FIRST',
      geminiEnabled: bool(value.gemini, true), deepseekEnabled: bool(value.deepseek, false),
      geminiModel: currentGeminiModel(value.geminiModel),
      deepseekModel: value.deepseekModel?.trim() || DEFAULT_AI_SETTINGS.deepseekModel,
      monthlyPaidBudgetCny: Number.isFinite(budget) && budget >= 0 ? budget : 0,
      context: { trainingToday: bool(value.training, true), nutritionToday: bool(value.nutrition, true),
        currentPlans: bool(value.plans, true), bodyTrend: bool(value.body, true), healthSummary: bool(value.health, true) } }
  }
  async save(settings: AiSettings): Promise<void> {
    const values: Array<[string, string]> = [[keys.enabled, String(settings.enabled)],
      [keys.acknowledged, String(settings.privacyAcknowledged)], [keys.route, settings.route],
      [keys.strategy, settings.strategy], [keys.gemini, String(settings.geminiEnabled)],
      [keys.deepseek, String(settings.deepseekEnabled)], [keys.geminiModel, settings.geminiModel],
      [keys.deepseekModel, settings.deepseekModel], [keys.budget, String(Math.max(0, settings.monthlyPaidBudgetCny))],
      [keys.training, String(settings.context.trainingToday)], [keys.nutrition, String(settings.context.nutritionToday)],
      [keys.plans, String(settings.context.currentPlans)], [keys.body, String(settings.context.bodyTrend)],
      [keys.health, String(settings.context.healthSummary)]]
    for (const [key, value] of values) await this.preferences.set(key, value)
  }
  modelFor(provider: AiProvider, settings: AiSettings): string {
    return provider === 'GEMINI' ? settings.geminiModel : settings.deepseekModel
  }
}
