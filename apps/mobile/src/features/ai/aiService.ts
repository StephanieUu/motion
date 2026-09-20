import { parseFoodText, validateMealEstimate, validateTrainingPlanDraft, validateWorkoutMetadata,
  type AiConfidence, type AiMealEstimate, type MealType, type TrainingPlanImageDraft, type WorkoutMetadataDraft } from '@motion/domain'
import type { FoodEntryInput } from '../../db/repositories/NutritionRepository'
import { AiRepository, type CoachMessage } from '../../db/repositories/AiRepository'
import { NutritionRepository } from '../../db/repositories/NutritionRepository'
import { BodyRepository } from '../../db/repositories/BodyRepository'
import { WorkoutImportRepository } from '../../db/repositories/WorkoutImportRepository'
import { TrainingPlanRepository } from '../../db/repositories/TrainingPlanRepository'
import type { MotionAiPlugin, NativeMealImage } from '../../platform/ai/aiNative'
import { AiContextBuilder } from './contextBuilder'
import { AiRouter, type AiDiagnostic } from './aiRouter'
import { promptFor } from './aiPrompts'
import type { AiSettingsStore } from './aiSettings'

export interface MealAiDraft { confirmationId: string; mode: 'TEXT' | 'PHOTO'; originalText: string | null; image: NativeMealImage | null;
  estimate: AiMealEstimate; source: 'GEMINI' | 'DEEPSEEK'; mealType: MealType }
export interface CoachReply { message: string; actions: Array<{ label: string; path: string }> }
export interface MealPhotoDiagnostics { provider: 'GEMINI' | 'DEEPSEEK'; category: AiDiagnostic['category'];
  httpStatus: number | null; width: number; height: number; byteSize: number; mimeType: 'image/jpeg' }
export class MealPhotoAiError extends Error {
  constructor(readonly diagnostic: MealPhotoDiagnostics) { super('MEAL_PHOTO_AI_FAILED'); this.name = 'MealPhotoAiError' }
}
export interface ScreenshotAssistDraft { weightKg: number | null; bodyFatPercent: number | null; bmi: number | null;
  muscleMassKg: number | null; skeletalMuscle: number | null; bodyWaterPercent: number | null;
  visceralFatLevel: number | null; boneMassKg: number | null; bmrKcal: number | null; bodyAge: number | null }
const confidenceLevel = (value: AiConfidence) => value === 'HIGH' ? 'HIGH' : value === 'MEDIUM' ? 'MEDIUM' : 'LOW'
const unsafeCoachAdvice = /断食|禁食|热量债|卡路里债|惩罚.{0,8}(运动|训练)|强制.{0,8}(运动|训练)|偿还.{0,8}(热量|卡路里)|降低明天.{0,8}(热量|目标)|明天.{0,8}(少吃|不吃)/
const safeCoachMessage = (message: string): string => unsafeCoachAdvice.test(message.replace(/\s/g, ''))
  ? '今天的记录已经保留。无需通过禁食、降低明天的目标或惩罚性运动补偿，下一餐按平常节奏记录即可。'
  : message
const validateCoach = (value: unknown): { message: string } => {
  const message = typeof value === 'string' ? value.trim() : ''
  if (!message) throw new Error('INVALID_RESPONSE')
  return { message: safeCoachMessage(message.slice(0, 1200)) }
}

export class AiService {
  constructor(readonly router: AiRouter, readonly repository: AiRepository, readonly nutrition: NutritionRepository,
    readonly settings: AiSettingsStore, readonly context: AiContextBuilder, readonly native: MotionAiPlugin,
    private readonly now: () => Date = () => new Date()) {}
  localDate(): string { const d = this.now(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

  async prepareMealText(text: string, mealType: MealType): Promise<{ local: true } | { local: false; draft: MealAiDraft }> {
    const parsed = parseFoodText(text)
    if (parsed && (parsed.caloriesKcal !== null || parsed.proteinG !== null)) {
      const entry: FoodEntryInput = { name: parsed.name, quantity: null, unit: null, calories_kcal: parsed.caloriesKcal,
        protein_g: parsed.proteinG, carbs_g: null, fat_g: null, estimation_method: parsed.estimationMethod,
        confidence_level: parsed.confidenceLevel, raw_input: parsed.rawInput }
      await this.nutrition.addMealWithEntry(this.localDate(), parsed.mealType ?? mealType, entry)
      return { local: true }
    }
    const result = await this.router.run({ taskType: 'MEAL_TEXT', prompt: promptFor('MEAL_TEXT', { text }),
      validate: validateMealEstimate, fallback: () => { throw new Error('MEAL_AI_UNAVAILABLE') } })
    if (result.source !== 'GEMINI' && result.source !== 'DEEPSEEK') throw new Error('MEAL_AI_UNAVAILABLE')
    return { local: false, draft: { confirmationId: `ai-meal-${crypto.randomUUID()}`, mode: 'TEXT', originalText: text,
      image: null, estimate: result.value,
      source: result.source, mealType } }
  }

  async prepareMealPhoto(mealType: MealType): Promise<MealAiDraft | null> {
    let image: NativeMealImage
    try { image = await this.native.chooseMealImage() } catch (cause) {
      if (String(cause).includes('IMAGE_NOT_SELECTED')) return null
      throw cause
    }
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl)
    const metadata = { width: image.width, height: image.height, byteSize: image.byteSize, mimeType: image.mimeType }
    if (!match || image.mimeType !== 'image/jpeg' || image.byteSize <= 0 || image.byteSize > 14 * 1024 * 1024)
      throw new MealPhotoAiError({ provider: 'GEMINI', category: 'INVALID_REQUEST', httpStatus: null, ...metadata })
    const imageBase64 = match[1]!
    const result = await this.router.run<AiMealEstimate | null>({ taskType: 'MEAL_PHOTO',
      prompt: promptFor('MEAL_PHOTO', {}), imageBase64, validate: validateMealEstimate, fallback: () => null })
    if ((result.source !== 'GEMINI' && result.source !== 'DEEPSEEK') || !result.value) {
      const diagnostic = result.diagnostic ?? { provider: 'GEMINI' as const, category: 'PROVIDER' as const, httpStatus: null }
      throw new MealPhotoAiError({ ...diagnostic, ...metadata })
    }
    return { confirmationId: `ai-meal-${crypto.randomUUID()}`, mode: 'PHOTO', originalText: null, image,
      estimate: result.value, source: result.source, mealType }
  }

  async confirmMeal(draft: MealAiDraft): Promise<string> {
    const estimate = validateMealEstimate(draft.estimate)
    const entries: FoodEntryInput[] = estimate.items.map((item) => ({ name: item.name, quantity: null,
      unit: item.portionDescription, calories_kcal: item.caloriesKcal, protein_g: item.proteinG,
      carbs_g: item.carbsG, fat_g: item.fatG, estimation_method: draft.mode === 'PHOTO' ? 'PHOTO_AI' : 'TEXT_AI',
      confidence_level: confidenceLevel(item.confidence), raw_input: draft.originalText }))
    return this.nutrition.addAiMealWithEntries(this.localDate(), draft.mealType, entries, draft.confirmationId)
  }

  async coachState(): Promise<{ threadId: string; messages: CoachMessage[]; context: Record<string, unknown> }> {
    const thread = await this.repository.getOrCreateThread(), settings = await this.settings.load()
    return { threadId: thread.id, messages: await this.repository.messages(thread.id),
      context: await this.context.build('COACH', this.localDate(), settings) }
  }

  async sendCoach(threadId: string, text: string): Promise<CoachReply> {
    await this.repository.addMessage(threadId, 'USER', text)
    const normalized = text.replace(/\s/g, '')
    let reply: CoachReply | null = null
    if (/吃多|吃撑|超了/.test(normalized)) reply = { message: '今天的记录已经保留。无需通过禁食或惩罚性运动补偿，下一餐按平常节奏记录即可。',
      actions: [{ label: '查看今日营养参考', path: '/food' }] }
    else if (/集中减脂|减脂方案/.test(normalized)) reply = { message: '你可以先查看集中减脂方案的目标与生效日期，确认后才会启用。',
      actions: [{ label: '查看营养方案', path: '/food/plan/select' }] }
    else if (/换.*训练|不想练/.test(normalized)) reply = { message: '可以从现有训练库选择替代训练，或开始一个 4–10 分钟小练习。',
      actions: [{ label: '从训练库推荐', path: '/' }, { label: '打开训练', path: '/training' }] }
    if (!reply) {
      const settings = await this.settings.load(), context = await this.context.build('COACH', this.localDate(), settings)
      const routed = await this.router.run({ taskType: 'COACH', prompt: promptFor('COACH', { context,
        recentMessages: [{ role: 'USER', content: text.trim() }] }), validate: validateCoach,
        fallback: () => ({ message: '现在暂时无法生成回答。' }) })
      reply = { message: routed.value.message, actions: routed.source === 'FALLBACK'
        ? [{ label: '从训练库推荐', path: '/' }, { label: '今日营养参考', path: '/food' }] : [] }
    }
    await this.repository.addMessage(threadId, 'ASSISTANT', reply.message)
    return reply
  }

  async workoutMetadata(input: Record<string, unknown>): Promise<{ draft: WorkoutMetadataDraft; provider: 'GEMINI' | 'DEEPSEEK' }> {
    const result = await this.router.run({ taskType: 'WORKOUT_METADATA', prompt: promptFor('WORKOUT_METADATA', input),
      validate: validateWorkoutMetadata, fallback: () => { throw new Error('WORKOUT_AI_UNAVAILABLE') } })
    if (result.source !== 'GEMINI' && result.source !== 'DEEPSEEK') throw new Error('WORKOUT_AI_UNAVAILABLE')
    return { draft: result.value, provider: result.source }
  }
  async confirmWorkoutMetadata(workoutContentId: string, draft: WorkoutMetadataDraft, provider: 'GEMINI' | 'DEEPSEEK') {
    const confidence = draft.confidence === 'HIGH' ? .85 : draft.confidence === 'MEDIUM' ? .65 : .4
    return new WorkoutImportRepository(this.repository.db).saveAiAnalysis(workoutContentId, provider,
      draft as unknown as Record<string, unknown>, confidence)
  }
  async screenshotAssist(ocrText: string): Promise<ScreenshotAssistDraft> {
    const validate = (value: unknown): ScreenshotAssistDraft => {
      if (!value || typeof value !== 'object') throw new Error('INVALID_RESPONSE')
      const row = value as Record<string, unknown>
      const number = (key: string, maximum = 100_000) => {
        const candidate = row[key]
        if (candidate === null || candidate === undefined) return null
        if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0 || candidate > maximum)
          throw new Error('INVALID_RESPONSE')
        return candidate
      }
      return { weightKg: number('weightKg', 500), bodyFatPercent: number('bodyFatPercent', 100), bmi: number('bmi', 100),
        muscleMassKg: number('muscleMassKg', 500), skeletalMuscle: number('skeletalMuscle', 100),
        bodyWaterPercent: number('bodyWaterPercent', 100), visceralFatLevel: number('visceralFatLevel', 100),
        boneMassKg: number('boneMassKg', 50), bmrKcal: number('bmrKcal', 10_000), bodyAge: number('bodyAge', 150) }
    }
    return (await this.router.run({ taskType: 'SCREENSHOT_ASSIST', prompt: promptFor('SCREENSHOT_ASSIST', { ocrText }),
      validate, fallback: () => { throw new Error('SCREENSHOT_AI_UNAVAILABLE') } })).value
  }
  async confirmScreenshotAssist(draft: ScreenshotAssistDraft, measuredAt = this.now().toISOString()) {
    return new BodyRepository(this.repository.db).insert({ ...draft, measuredAt, localDate: measuredAt.slice(0, 10),
      sourceType: 'SCREENSHOT_OCR', confidenceLevel: 'LOW', userVerified: true,
      rawDataJson: JSON.stringify({ schemaVersion: 1, assistedBy: 'AI', values: draft }) })
  }
  async trainingPlanImage(imageBase64: string): Promise<TrainingPlanImageDraft> {
    return (await this.router.run({ taskType: 'TRAINING_PLAN_IMAGE', prompt: promptFor('TRAINING_PLAN_IMAGE', {}), imageBase64,
      validate: validateTrainingPlanDraft, fallback: () => { throw new Error('PLAN_AI_UNAVAILABLE') } })).value
  }
  confirmTrainingPlanDraft(draft: TrainingPlanImageDraft) {
    return new TrainingPlanRepository(this.repository.db).create({ title: draft.title?.trim() || '导入的训练计划',
      sourceType: 'MANUAL', days: draft.days.map((day) => ({ dayIndex: day.dayIndex,
        ...(day.title ? { title: day.title } : {}), isRestDay: day.isRestDay,
        originalLabel: day.originalLabel, expectedDurationMinutes: day.expectedDurationMinutes,
        expectedIntensity: day.expectedIntensity, notes: day.notes })) })
  }
  async testConnection(): Promise<{ ok: boolean; diagnostic?: AiDiagnostic }> {
    const result = await this.router.run({ taskType: 'COACH', prompt: 'Reply with exactly: OK',
      validate: (value) => typeof value === 'string' && value.trim() === 'OK' ? { message: 'OK' }
        : (() => { throw new Error('INVALID_RESPONSE') })(), fallback: () => ({ message: 'unavailable' }) })
    const ok = result.source === 'GEMINI' || result.source === 'DEEPSEEK'
    return { ok, ...(!ok && result.diagnostic ? { diagnostic: result.diagnostic } : {}) }
  }
}
