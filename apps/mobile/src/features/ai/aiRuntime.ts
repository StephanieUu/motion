import { AppPreferencesRepository } from '../../db/repositories/AppPreferencesRepository'
import { AiRepository } from '../../db/repositories/AiRepository'
import { NutritionRepository } from '../../db/repositories/NutritionRepository'
import { getNativeDatabase } from '../../db/sqlite/nativeDatabase'
import { MotionAi } from '../../platform/ai/aiNative'
import { AiContextBuilder } from './contextBuilder'
import { DirectByokAdapter, ProxyAdapter } from './aiProvider'
import { AiRouter } from './aiRouter'
import { AiService } from './aiService'
import { AiSettingsStore } from './aiSettings'

let servicePromise: Promise<AiService> | undefined
export function openAiService(): Promise<AiService> {
  servicePromise ??= getNativeDatabase().then((db) => {
    const repository = new AiRepository(db), settings = new AiSettingsStore(new AppPreferencesRepository(db))
    const router = new AiRouter({ repository, settings, credentials: MotionAi,
      direct: new DirectByokAdapter(MotionAi), proxy: new ProxyAdapter(
        import.meta.env.VITE_MOTION_AI_PROXY_URL ?? '', 20_000, import.meta.env.DEV) })
    return new AiService(router, repository, new NutritionRepository(db), settings,
      new AiContextBuilder(db), MotionAi)
  }).catch((cause) => { servicePromise = undefined; throw cause })
  return servicePromise
}
