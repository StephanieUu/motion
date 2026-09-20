import type { AiErrorCode, AiProvider, AiTaskType } from '@motion/domain'
import { AiRepository } from '../../db/repositories/AiRepository'
import type { MotionAiPlugin } from '../../platform/ai/aiNative'
import type { AiDiagnosticCategory, AiProviderAdapter } from './aiProvider'
import { AiProviderError } from './aiProvider'
import type { AiSettings, AiSettingsStore } from './aiSettings'
import { estimateDeepSeekUpperBoundCny, maxOutputTokens } from './aiPricing'
import { outputContractFor } from './aiSchemas'

export interface AiRouterDependencies {
  repository: AiRepository
  settings: AiSettingsStore
  credentials: Pick<MotionAiPlugin, 'hasCredential'>
  direct: AiProviderAdapter
  proxy: AiProviderAdapter
  now?: () => Date
}
export interface RoutedTask<T> {
  taskType: AiTaskType
  prompt: string
  imageBase64?: string
  validate: (value: unknown) => T
  local?: () => Promise<T | null> | T | null
  fallback: () => Promise<T> | T
  estimatedPaidCostCny?: number
}
export interface AiDiagnostic { provider: AiProvider; category: AiDiagnosticCategory; httpStatus: number | null }
export interface RoutedResult<T> { value: T; source: 'LOCAL' | AiProvider | 'FALLBACK'; diagnostic?: AiDiagnostic }

const safeError = (cause: unknown): AiErrorCode => cause instanceof AiProviderError ? cause.code :
  cause instanceof Error && cause.message === 'INVALID_RESPONSE' ? 'INVALID_RESPONSE' : 'PROVIDER'
export const budgetPeriodUtc = (date: Date) => date.toISOString().slice(0, 7)
const fingerprint = (task: RoutedTask<unknown>): string => {
  let hash = 2166136261
  const content = `${task.taskType}\0${task.prompt}\0${task.imageBase64 ?? ''}`
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index); hash = Math.imul(hash, 16777619)
  }
  return `${task.taskType}:${hash >>> 0}`
}

export class AiRouter {
  private readonly now: () => Date
  private readonly inFlight = new Map<string, Promise<RoutedResult<unknown>>>()
  constructor(private readonly dependencies: AiRouterDependencies) { this.now = dependencies.now ?? (() => new Date()) }

  async run<T>(task: RoutedTask<T>): Promise<RoutedResult<T>> {
    const local = await task.local?.()
    if (local !== null && local !== undefined) return { value: local, source: 'LOCAL' }
    const key = fingerprint(task)
    const existing = this.inFlight.get(key) as Promise<RoutedResult<T>> | undefined
    if (existing) return existing
    const pending = this.runExternal(task)
    this.inFlight.set(key, pending as Promise<RoutedResult<unknown>>)
    try { return await pending } finally { if (this.inFlight.get(key) === pending) this.inFlight.delete(key) }
  }

  private async runExternal<T>(task: RoutedTask<T>): Promise<RoutedResult<T>> {
    const settings = await this.dependencies.settings.load()
    if (!settings.enabled || !settings.privacyAcknowledged) return { value: await task.fallback(), source: 'FALLBACK' }
    const gemini = await this.available('GEMINI', settings)
    let diagnostic: AiDiagnostic | undefined
    if (gemini) {
      const attempt = await this.attempt('GEMINI', settings, task)
      if (attempt.result) return attempt.result
      diagnostic = attempt.diagnostic
    }
    if (settings.deepseekEnabled && this.supportsDeepSeek(task.taskType) && await this.available('DEEPSEEK', settings)) {
      const supplied = task.estimatedPaidCostCny
      const estimated = supplied === undefined ? estimateDeepSeekUpperBoundCny(task.taskType, task.prompt)
        : Number.isFinite(supplied) && supplied > 0 ? supplied : null
      const startedAt = this.now().toISOString()
      const reservationId = estimated === null ? null : await this.dependencies.repository.reservePaidUsage({
        provider: 'DEEPSEEK', model: this.dependencies.settings.modelFor('DEEPSEEK', settings),
        taskType: task.taskType, route: settings.route, usedFreeTier: false, inputTokens: null,
        outputTokens: null, estimatedCostCny: estimated, startedAt,
      }, budgetPeriodUtc(this.now()), settings.monthlyPaidBudgetCny)
      if (!reservationId) {
        await this.record('DEEPSEEK', settings, task.taskType, 'BLOCKED_BUDGET', 'BUDGET', null, null, null)
      } else {
        const attempt = await this.attempt('DEEPSEEK', settings, task, estimated, reservationId, startedAt)
        if (attempt.result) return attempt.result
        diagnostic = attempt.diagnostic
      }
    }
    return { value: await task.fallback(), source: 'FALLBACK', ...(diagnostic ? { diagnostic } : {}) }
  }

  private supportsDeepSeek(taskType: AiTaskType): boolean {
    return taskType !== 'MEAL_PHOTO' && taskType !== 'TRAINING_PLAN_IMAGE'
  }

  private async available(provider: AiProvider, settings: AiSettings): Promise<boolean> {
    if (provider === 'GEMINI' && !settings.geminiEnabled) return false
    if (settings.route === 'PROXY') return true
    try { return (await this.dependencies.credentials.hasCredential({ provider })).value } catch { return false }
  }

  private async attempt<T>(provider: AiProvider, settings: AiSettings, task: RoutedTask<T>, cost: number | null = null,
    reservationId: string | null = null, started = this.now().toISOString()): Promise<{
      result: RoutedResult<T> | null; diagnostic?: AiDiagnostic
    }> {
    try {
      const adapter = settings.route === 'PROXY' ? this.dependencies.proxy : this.dependencies.direct
      const response = await adapter.send({ provider, model: this.dependencies.settings.modelFor(provider, settings),
        taskType: task.taskType, prompt: task.prompt, maxOutputTokens: maxOutputTokens(task.taskType),
        output: outputContractFor(task.taskType),
        ...(task.imageBase64 ? { imageBase64: task.imageBase64 } : {}) })
      const value = task.validate(response.output)
      if (reservationId) await this.dependencies.repository.completeUsage(reservationId, { status: 'SUCCESS',
        inputTokens: response.inputTokens, outputTokens: response.outputTokens, estimatedCostCny: cost,
        completedAt: this.now().toISOString(), errorCode: null })
      else await this.record(provider, settings, task.taskType, 'SUCCESS', null, response.inputTokens,
        response.outputTokens, cost, started)
      return { result: { value, source: provider } }
    } catch (cause) {
      const errorCode = safeError(cause)
      const accountedCost = cause instanceof AiProviderError && !cause.mayHaveReachedProvider ? 0 : cost
      if (reservationId) await this.dependencies.repository.completeUsage(reservationId, { status: 'FAILED',
        inputTokens: null, outputTokens: null, estimatedCostCny: accountedCost,
        completedAt: this.now().toISOString(), errorCode })
      else await this.record(provider, settings, task.taskType, 'FAILED', errorCode, null, null, null, started)
      return { result: null, ...(cause instanceof AiProviderError ? { diagnostic: {
        provider, category: cause.diagnosticCategory, httpStatus: cause.httpStatus,
      } } : {}) }
    }
  }

  private record(provider: AiProvider, settings: AiSettings, taskType: AiTaskType,
    status: 'SUCCESS' | 'FAILED' | 'BLOCKED_BUDGET', errorCode: AiErrorCode | null,
    inputTokens: number | null, outputTokens: number | null, cost: number | null,
    startedAt = this.now().toISOString()) {
    return this.dependencies.repository.recordUsage({ provider,
      model: this.dependencies.settings.modelFor(provider, settings), taskType, route: settings.route,
      status, usedFreeTier: provider === 'GEMINI' ? null : false, inputTokens, outputTokens,
      estimatedCostCny: cost, startedAt, completedAt: this.now().toISOString(), errorCode })
  }
}
