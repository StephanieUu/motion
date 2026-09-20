// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateMealEstimate, validateTrainingPlanDraft, validateWorkoutMetadata, type AiTaskType } from '@motion/domain'
import { Database, type SqlDriver, type SqlRow, type SqlValue } from '../../db/sqlite/Database'
import { migrateDatabase, migrations } from '../../db/migrations'
import { AiRepository } from '../../db/repositories/AiRepository'
import { AppPreferencesRepository } from '../../db/repositories/AppPreferencesRepository'
import { NutritionRepository } from '../../db/repositories/NutritionRepository'
import { AiSettingsStore, DEFAULT_AI_SETTINGS } from './aiSettings'
import { AiProviderError, DirectByokAdapter, ProxyAdapter, type AiProviderAdapter, type ProviderRequest,
  type ProviderResult } from './aiProvider'
import { AiRouter, budgetPeriodUtc } from './aiRouter'
import { AiContextBuilder } from './contextBuilder'
import { AiService } from './aiService'
import { outputContractFor } from './aiSchemas'
import type { MotionAiPlugin } from '../../platform/ai/aiNative'

class NodeDriver implements SqlDriver {
  constructor(private readonly sqlite: DatabaseSync) {}
  async query<T extends SqlRow>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.sqlite.prepare(sql).all(...values) as T[]
  }
  async run(sql: string, values: SqlValue[] = []): Promise<void> { this.sqlite.prepare(sql).run(...values) }
  async execute(sql: string): Promise<void> { this.sqlite.exec(sql) }
  async begin(): Promise<void> { this.sqlite.exec('BEGIN IMMEDIATE') }
  async commit(): Promise<void> { this.sqlite.exec('COMMIT') }
  async rollback(): Promise<void> { this.sqlite.exec('ROLLBACK') }
}
const opened: DatabaseSync[] = []
async function ready(version = 10) {
  const sqlite = new DatabaseSync(':memory:'); opened.push(sqlite)
  const db = new Database(new NodeDriver(sqlite)); await migrateDatabase(db, migrations.slice(0, version))
  return { sqlite, db }
}
afterEach(() => { while (opened.length) opened.pop()!.close() })

class FakeAdapter implements AiProviderAdapter {
  calls: ProviderRequest[] = []
  constructor(private readonly result: (request: ProviderRequest) => ProviderResult | Promise<ProviderResult>) {}
  async send(request: ProviderRequest) { this.calls.push(request); return this.result(request) }
}
const meal = { items: [{ name: '海南鸡饭', portionDescription: '一份，去皮', caloriesKcal: 520,
  proteinG: 28, carbsG: 65, fatG: 12, confidence: 'MEDIUM' }],
  mealEstimate: { caloriesKcal: 520, proteinG: 28, carbsG: 65, fatG: 12 }, assumptions: ['按一份估算'], confidence: 'MEDIUM' }

async function routerFixture(adapter: AiProviderAdapter, now = () => new Date('2026-09-19T12:00:00Z')) {
  const { db } = await ready(), repository = new AiRepository(db)
  const settings = new AiSettingsStore(new AppPreferencesRepository(db))
  await settings.save({ ...DEFAULT_AI_SETTINGS, enabled: true, privacyAcknowledged: true })
  const credentials = { hasCredential: vi.fn(async () => ({ value: true })) }
  return { db, repository, settings, router: new AiRouter({ repository, settings, credentials,
    direct: adapter, proxy: adapter, now }), credentials }
}

describe('M10 migration and persistence', () => {
  it('migrates a fresh database through 010 with constrained usage and local Coach tables', async () => {
    const { db } = await ready()
    expect((await db.query<{ user_version: number }>('PRAGMA user_version'))[0]?.user_version).toBe(10)
    await expect(db.run(`INSERT INTO ai_usage_events (id,provider,model,task_type,route,status,started_at)
      VALUES ('bad','OPENAI','x','COACH','DIRECT_BYOK','SUCCESS','2026-09-19')`)).rejects.toThrow()
    const repository = new AiRepository(db), thread = await repository.getOrCreateThread()
    await repository.addMessage(thread.id, 'USER', '今天不想练')
    expect(await repository.recentMessages(thread.id)).toHaveLength(1)
    await db.run('DELETE FROM coach_threads WHERE id=?', [thread.id])
    expect(await db.query('SELECT * FROM coach_messages')).toHaveLength(0)
  })

  it('upgrades populated 009 without changing existing data and rolls 010 back atomically on failure', async () => {
    const { db } = await ready(9)
    await db.run(`INSERT INTO body_measurements
      (id,measured_at,local_date,source_type,weight_kg,user_verified,created_at,updated_at)
      VALUES ('body','2026-09-18T08:00:00Z','2026-09-18','MANUAL',64.3,1,'2026-09-18','2026-09-18')`)
    expect(await migrateDatabase(db)).toBe(10)
    expect((await db.query<{ weight_kg: number }>('SELECT weight_kg FROM body_measurements WHERE id=?',['body']))[0]?.weight_kg).toBe(64.3)

    const second = new DatabaseSync(':memory:'); opened.push(second); const rollbackDb = new Database(new NodeDriver(second))
    await migrateDatabase(rollbackDb, migrations.slice(0, 9))
    const broken = [...migrations.slice(0, 9), { version: 10,
      sql: `${migrations[9]!.sql}\nINSERT INTO missing_table VALUES (1);` }]
    await expect(migrateDatabase(rollbackDb, broken)).rejects.toThrow()
    expect((await rollbackDb.query<{ user_version: number }>('PRAGMA user_version'))[0]?.user_version).toBe(9)
    expect(await rollbackDb.query<{ name: string }>("SELECT name FROM sqlite_master WHERE name='ai_usage_events'" )).toHaveLength(0)
  })

  it('stores only non-secret AI preferences and defaults paid fallback to zero', async () => {
    const { db } = await ready(), store = new AiSettingsStore(new AppPreferencesRepository(db))
    expect(await store.load()).toEqual(DEFAULT_AI_SETTINGS)
    await store.save({ ...DEFAULT_AI_SETTINGS, enabled: true, monthlyPaidBudgetCny: 5 })
    const rows = await db.query<{ preference_key: string; preference_value: string }>(
      "SELECT preference_key,preference_value FROM app_preferences WHERE preference_key LIKE 'ai.%'")
    expect(rows.some((row) => /key|secret|credential/i.test(row.preference_key))).toBe(false)
    expect(rows.map((row) => row.preference_value).join(' ')).not.toContain('test-secret')
  })

  it('resolves the retired Gemini default to the current configured model', async () => {
    const { db } = await ready(), preferences = new AppPreferencesRepository(db)
    await preferences.set('ai.gemini.model', 'gemini-3.7-flash')
    const settings = await new AiSettingsStore(preferences).load()
    expect(settings.geminiModel).toBe('gemini-3.8-flash')
  })
})

describe('AI Router and paid budget', () => {
  it('returns local deterministic output without a provider call', async () => {
    const adapter = new FakeAdapter(() => ({ output: meal, inputTokens: 1, outputTokens: 1 }))
    const { router } = await routerFixture(adapter)
    const result = await router.run({ taskType: 'MEAL_TEXT', prompt: 'not sent', validate: validateMealEstimate,
      local: () => validateMealEstimate(meal), fallback: () => validateMealEstimate(meal) })
    expect(result.source).toBe('LOCAL'); expect(adapter.calls).toHaveLength(0)
  })

  it('uses Gemini, validates structured output, and persists metadata without content', async () => {
    const adapter = new FakeAdapter(() => ({ output: meal, inputTokens: 12, outputTokens: 20 }))
    const { router, db } = await routerFixture(adapter)
    const result = await router.run({ taskType: 'MEAL_TEXT', prompt: 'private meal description',
      validate: validateMealEstimate, fallback: () => { throw new Error('fallback') } })
    expect(result.source).toBe('GEMINI')
    const event = (await db.query<Record<string, unknown>>('SELECT * FROM ai_usage_events'))[0]!
    expect(event).toMatchObject({ provider: 'GEMINI', status: 'SUCCESS', used_free_tier: null,
      input_tokens: 12, output_tokens: 20 })
    expect(JSON.stringify(event)).not.toContain('private meal description')
  })

  it('fails closed for every external task without recorded consent while keeping local work available', async () => {
    const adapter = new FakeAdapter(() => ({ output: meal, inputTokens: 1, outputTokens: 1 }))
    const fixture = await routerFixture(adapter)
    await fixture.settings.save({ ...DEFAULT_AI_SETTINGS, enabled: true, privacyAcknowledged: false })
    const tasks: AiTaskType[] = ['COACH','MEAL_TEXT','MEAL_PHOTO','SCREENSHOT_ASSIST','WORKOUT_METADATA','TRAINING_PLAN_IMAGE']
    for (const taskType of tasks) {
      const result = await fixture.router.run({ taskType, prompt: `private-${taskType}`,
        validate: (value) => value, fallback: () => 'local-fallback' })
      expect(result).toEqual({ value: 'local-fallback', source: 'FALLBACK' })
    }
    const local = await fixture.router.run({ taskType: 'MEAL_TEXT', prompt: 'never sent',
      local: () => 'local-result', validate: (value) => value, fallback: () => 'fallback' })
    expect(local).toEqual({ value: 'local-result', source: 'LOCAL' })
    expect(adapter.calls).toHaveLength(0)
  })

  it('does not dispatch after the required native credential is unavailable or deleted', async () => {
    const adapter = new FakeAdapter(() => ({ output: meal, inputTokens: 1, outputTokens: 1 }))
    const fixture = await routerFixture(adapter)
    fixture.credentials.hasCredential.mockResolvedValue({ value: false })
    const result = await fixture.router.run({ taskType: 'MEAL_TEXT', prompt: 'must stay local',
      validate: validateMealEstimate, fallback: () => validateMealEstimate(meal) })
    expect(result.source).toBe('FALLBACK')
    expect(fixture.credentials.hasCredential).toHaveBeenCalledWith({ provider: 'GEMINI' })
    expect(adapter.calls).toHaveLength(0)
  })

  it('falls back locally after quota when DeepSeek is disabled', async () => {
    const adapter = new FakeAdapter(() => { throw new AiProviderError('QUOTA') })
    const { router, db } = await routerFixture(adapter)
    const result = await router.run({ taskType: 'MEAL_TEXT', prompt: 'x', validate: validateMealEstimate,
      fallback: () => validateMealEstimate(meal) })
    expect(result.source).toBe('FALLBACK'); expect(adapter.calls).toHaveLength(1)
    expect((await db.query<{ error_code: string }>('SELECT error_code FROM ai_usage_events'))[0]?.error_code).toBe('QUOTA')
  })

  it('blocks paid DeepSeek before dispatch at the default ¥0 budget', async () => {
    const adapter = new FakeAdapter((request) => request.provider === 'GEMINI'
      ? Promise.reject(new AiProviderError('NETWORK')) : ({ output: meal, inputTokens: 2, outputTokens: 3 }))
    const fixture = await routerFixture(adapter)
    await fixture.settings.save({ ...DEFAULT_AI_SETTINGS, enabled: true, privacyAcknowledged: true, deepseekEnabled: true })
    const result = await fixture.router.run({ taskType: 'MEAL_TEXT', prompt: 'x', validate: validateMealEstimate,
      fallback: () => validateMealEstimate(meal) })
    expect(result.source).toBe('FALLBACK')
    expect(adapter.calls.map((call) => call.provider)).toEqual(['GEMINI'])
    expect((await fixture.db.query<{ status: string }>("SELECT status FROM ai_usage_events WHERE provider='DEEPSEEK'"))[0]?.status).toBe('BLOCKED_BUDGET')
  })

  it('uses paid fallback only when the estimate fits the remaining UTC-month budget', async () => {
    const adapter = new FakeAdapter((request) => request.provider === 'GEMINI'
      ? Promise.reject(new AiProviderError('NETWORK')) : ({ output: meal, inputTokens: 2, outputTokens: 3 }))
    const fixture = await routerFixture(adapter)
    await fixture.settings.save({ ...DEFAULT_AI_SETTINGS, enabled: true, privacyAcknowledged: true,
      deepseekEnabled: true, monthlyPaidBudgetCny: .02 })
    const result = await fixture.router.run({ taskType: 'MEAL_TEXT', prompt: 'x', validate: validateMealEstimate,
      fallback: () => validateMealEstimate(meal), estimatedPaidCostCny: .01 })
    expect(result.source).toBe('DEEPSEEK')
    expect(await fixture.repository.paidSpendCny('2026-09')).toBe(.01)
    expect(await fixture.repository.paidSpendCny('2026-10')).toBe(0)
  })

  it('reserves paid budget atomically across concurrent dispatches', async () => {
    const adapter = new FakeAdapter(async (request) => {
      if (request.provider === 'GEMINI') throw new AiProviderError('NETWORK')
      await new Promise((resolve) => setTimeout(resolve, 15))
      return { output: meal, inputTokens: 2, outputTokens: 3 }
    })
    const fixture = await routerFixture(adapter)
    await fixture.settings.save({ ...DEFAULT_AI_SETTINGS, enabled: true, privacyAcknowledged: true,
      deepseekEnabled: true, monthlyPaidBudgetCny: .02 })
    const task = (prompt: string) => fixture.router.run({ taskType: 'MEAL_TEXT' as const, prompt,
      validate: validateMealEstimate, fallback: () => validateMealEstimate(meal), estimatedPaidCostCny: .015 })
    const results = await Promise.all([task('request one'), task('request two')])
    expect(results.map((result) => result.source).sort()).toEqual(['DEEPSEEK','FALLBACK'])
    expect(adapter.calls.filter((call) => call.provider === 'DEEPSEEK')).toHaveLength(1)
    expect(await fixture.repository.paidSpendCny('2026-09')).toBe(.015)
    expect(await fixture.db.query("SELECT * FROM ai_usage_events WHERE status='RESERVED'")).toHaveLength(0)
  })

  it('keeps a dispatched paid timeout budget-accounted without retrying it', async () => {
    const adapter = new FakeAdapter((request) => { throw new AiProviderError(
      request.provider === 'GEMINI' ? 'NETWORK' : 'TIMEOUT') })
    const fixture = await routerFixture(adapter)
    await fixture.settings.save({ ...DEFAULT_AI_SETTINGS, enabled: true, privacyAcknowledged: true,
      deepseekEnabled: true, monthlyPaidBudgetCny: .02 })
    const result = await fixture.router.run({ taskType: 'MEAL_TEXT', prompt: 'paid timeout',
      validate: validateMealEstimate, fallback: () => validateMealEstimate(meal), estimatedPaidCostCny: .01 })
    expect(result.source).toBe('FALLBACK')
    expect(adapter.calls.filter((call) => call.provider === 'DEEPSEEK')).toHaveLength(1)
    expect(await fixture.repository.paidSpendCny('2026-09')).toBe(.01)
    expect((await fixture.db.query<{ status: string; error_code: string; estimated_cost_cny: number }>(
      "SELECT status,error_code,estimated_cost_cny FROM ai_usage_events WHERE provider='DEEPSEEK'"))[0])
      .toMatchObject({ status: 'FAILED', error_code: 'TIMEOUT', estimated_cost_cny: .01 })
  })

  it('releases reserved cost when paid dispatch fails locally before reaching a provider', async () => {
    const adapter = new FakeAdapter((request) => { throw new AiProviderError(
      request.provider === 'GEMINI' ? 'NETWORK' : 'AUTH', request.provider === 'GEMINI') })
    const fixture = await routerFixture(adapter)
    await fixture.settings.save({ ...DEFAULT_AI_SETTINGS, enabled: true, privacyAcknowledged: true,
      deepseekEnabled: true, monthlyPaidBudgetCny: .02 })
    const result = await fixture.router.run({ taskType: 'MEAL_TEXT', prompt: 'local dispatch failure',
      validate: validateMealEstimate, fallback: () => validateMealEstimate(meal), estimatedPaidCostCny: .01 })
    expect(result.source).toBe('FALLBACK')
    expect(await fixture.repository.paidSpendCny('2026-09')).toBe(0)
    expect((await fixture.db.query<{ status: string; error_code: string; estimated_cost_cny: number }>(
      "SELECT status,error_code,estimated_cost_cny FROM ai_usage_events WHERE provider='DEEPSEEK'"))[0])
      .toMatchObject({ status: 'FAILED', error_code: 'AUTH', estimated_cost_cny: 0 })
  })

  it('uses an explicit UTC calendar-month policy and counts unresolved reservations conservatively', async () => {
    const { db } = await ready(), repository = new AiRepository(db)
    const base = { provider: 'DEEPSEEK' as const, model: 'deepseek-chat', taskType: 'MEAL_TEXT' as const,
      route: 'DIRECT_BYOK' as const, usedFreeTier: false, inputTokens: null, outputTokens: null }
    await repository.recordUsage({ ...base, status: 'SUCCESS', estimatedCostCny: .01,
      startedAt: '2026-09-30T23:59:59.999Z', completedAt: '2026-10-01T00:00:00.100Z' })
    await repository.recordUsage({ ...base, status: 'SUCCESS', estimatedCostCny: .02,
      startedAt: '2026-10-01T00:00:00.000Z', completedAt: '2026-10-01T00:00:00.100Z' })
    expect(budgetPeriodUtc(new Date('2026-10-01T01:00:00+02:00'))).toBe('2026-09')
    expect(await repository.paidSpendCny('2026-09')).toBe(.01)
    expect(await repository.paidSpendCny('2026-10')).toBe(.02)
    const reserved = await repository.reservePaidUsage({ ...base, estimatedCostCny: .015,
      startedAt: '2026-10-02T00:00:00.000Z' }, '2026-10', .04)
    expect(reserved).not.toBeNull()
    expect(await repository.paidSpendCny('2026-10')).toBe(.035)
  })

  it('blocks unbounded paid fallback and coalesces rapid duplicate external submissions', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const adapter = new FakeAdapter(async (request) => {
      if (request.provider === 'GEMINI' && request.prompt.length > 32_000) throw new AiProviderError('NETWORK')
      await gate
      return { output: meal, inputTokens: 2, outputTokens: 3 }
    })
    const fixture = await routerFixture(adapter)
    const duplicate = { taskType: 'MEAL_TEXT' as const, prompt: 'same request',
      validate: validateMealEstimate, fallback: () => validateMealEstimate(meal) }
    const first = fixture.router.run(duplicate), second = fixture.router.run(duplicate)
    await vi.waitFor(() => expect(adapter.calls).toHaveLength(1)); release()
    expect((await Promise.all([first, second])).map((result) => result.source)).toEqual(['GEMINI','GEMINI'])

    await fixture.settings.save({ ...DEFAULT_AI_SETTINGS, enabled: true, privacyAcknowledged: true,
      deepseekEnabled: true, monthlyPaidBudgetCny: 10 })
    const oversized = await fixture.router.run({ taskType: 'MEAL_TEXT', prompt: 'x'.repeat(32_001),
      validate: validateMealEstimate, fallback: () => validateMealEstimate(meal) })
    expect(oversized.source).toBe('FALLBACK')
    expect(adapter.calls.filter((call) => call.provider === 'DEEPSEEK')).toHaveLength(0)
  })

  it('rejects non-HTTPS proxy endpoints outside an explicitly enabled local-development route', async () => {
    const request: ProviderRequest = { provider: 'GEMINI', model: 'model', taskType: 'COACH', prompt: 'x',
      maxOutputTokens: 10, output: outputContractFor('COACH') }
    await expect(new ProxyAdapter('http://example.com').send(request)).rejects.toMatchObject({ code: 'AUTH' })
    await expect(new ProxyAdapter('http://localhost:8787').send(request)).rejects.toMatchObject({ code: 'AUTH' })
  })

  it('rejects malformed provider output and handles auth and timeout as sanitized failures', async () => {
    for (const failure of [new Error('INVALID_RESPONSE'), new AiProviderError('AUTH'), new AiProviderError('TIMEOUT')]) {
      const adapter = new FakeAdapter(() => { throw failure }), fixture = await routerFixture(adapter)
      const result = await fixture.router.run({ taskType: 'MEAL_TEXT', prompt: 'never persisted', validate: validateMealEstimate,
        fallback: () => validateMealEstimate(meal) })
      expect(result.source).toBe('FALLBACK')
      const code = (await fixture.db.query<{ error_code: string }>('SELECT error_code FROM ai_usage_events'))[0]?.error_code
      expect(['INVALID_RESPONSE','AUTH','TIMEOUT']).toContain(code)
      expect(adapter.calls).toHaveLength(1)
    }
  })
})

describe('context, meals, and Coach guardrails', () => {
  it('builds only enabled task summaries and keeps missing health unknown instead of zero', async () => {
    const { db } = await ready(), builder = new AiContextBuilder(db)
    const disabled = { ...DEFAULT_AI_SETTINGS, context: { trainingToday: false, nutritionToday: false,
      currentPlans: false, bodyTrend: false, healthSummary: false } }
    expect(await builder.build('COACH', '2026-09-19', disabled)).toEqual({ localDate: '2026-09-19' })
    const enabled = await builder.build('COACH', '2026-09-19', DEFAULT_AI_SETTINGS)
    expect(enabled).toHaveProperty('training'); expect(enabled).toHaveProperty('nutrition')
    expect(enabled.health).toEqual({ localDate: null, available: false })
    expect(JSON.stringify(enabled)).not.toContain('raw_data_json')
    for (const task of ['MEAL_TEXT','MEAL_PHOTO','SCREENSHOT_ASSIST','WORKOUT_METADATA','TRAINING_PLAN_IMAGE'] as AiTaskType[])
      expect(await builder.build(task, '2026-09-19', DEFAULT_AI_SETTINGS)).toEqual({ localDate: '2026-09-19' })

    const mapping = { trainingToday: 'training', nutritionToday: 'nutrition', currentPlans: 'plans',
      bodyTrend: 'bodyTrend', healthSummary: 'health' } as const
    for (const [setting, field] of Object.entries(mapping) as Array<[keyof typeof mapping, typeof mapping[keyof typeof mapping]]>) {
      const next = { ...DEFAULT_AI_SETTINGS, context: { ...DEFAULT_AI_SETTINGS.context, [setting]: false } }
      expect(await builder.build('COACH', '2026-09-19', next)).not.toHaveProperty(field)
    }
  })

  it('applies a saved context-toggle change to the immediately following Coach request', async () => {
    const adapter = new FakeAdapter(() => ({ output: '只使用当前允许的摘要。',
      inputTokens: 2, outputTokens: 3 }))
    const fixture = await routerFixture(adapter), service = new AiService(fixture.router, fixture.repository,
      new NutritionRepository(fixture.db), fixture.settings, new AiContextBuilder(fixture.db), {} as MotionAiPlugin,
      () => new Date('2026-09-19T12:00:00Z'))
    await fixture.db.run(`INSERT INTO body_measurements
      (id,measured_at,local_date,source_type,weight_kg,user_verified,created_at,updated_at)
      VALUES ('private-weight','2026-09-19T08:00:00Z','2026-09-19','MANUAL',64.3,1,'now','now')`)
    await fixture.settings.save({ ...DEFAULT_AI_SETTINGS, enabled: true, privacyAcknowledged: true,
      context: { ...DEFAULT_AI_SETTINGS.context, bodyTrend: false } })
    const state = await service.coachState()
    await service.sendCoach(state.threadId, '解释当前状态')
    const sent = adapter.calls.at(-1)!.prompt
    expect(sent).not.toContain('bodyTrend')
    expect(sent).not.toContain('64.3')
  })

  it('tests the provider connection without sending Motion personal context', async () => {
    const adapter = new FakeAdapter(() => ({ output: 'OK', inputTokens: 1, outputTokens: 1 }))
    const fixture = await routerFixture(adapter), service = new AiService(fixture.router, fixture.repository,
      new NutritionRepository(fixture.db), fixture.settings, new AiContextBuilder(fixture.db), {} as MotionAiPlugin,
      () => new Date('2026-09-19T12:00:00Z'))
    await fixture.db.run(`INSERT INTO body_measurements
      (id,measured_at,local_date,source_type,weight_kg,user_verified,created_at,updated_at)
      VALUES ('private-weight','2026-09-19T08:00:00Z','2026-09-19','MANUAL',64.3,1,'now','now')`)
    expect(await service.testConnection()).toEqual({ ok: true })
    expect(adapter.calls).toHaveLength(1)
    const sent = adapter.calls[0]!.prompt
    expect(sent).toBe('Reply with exactly: OK')
    expect(adapter.calls[0]!.output).toEqual({ mode: 'TEXT' })
    expect(sent).not.toContain('64.3')
    expect(sent).not.toContain('bodyTrend')
    expect(sent).not.toContain('nutrition')
    expect(sent).not.toContain('training')
  })

  it('classifies Gemini HTTP failures without exposing provider bodies or request content', async () => {
    const request: ProviderRequest = { provider: 'GEMINI', model: 'gemini-3.8-flash', taskType: 'COACH',
      prompt: 'context-free connectivity probe', maxOutputTokens: 10, output: outputContractFor('COACH') }
    for (const [status, category] of [[400, 'INVALID_REQUEST'], [401, 'AUTH'], [403, 'PERMISSION'],
      [404, 'MODEL_NOT_FOUND'], [429, 'QUOTA'], [500, 'PROVIDER']] as const) {
      const native = { request: vi.fn(async () => ({ status, body: 'secret provider details' })) } as unknown as MotionAiPlugin
      await expect(new DirectByokAdapter(native).send(request)).rejects.toMatchObject({
        diagnosticCategory: category, httpStatus: status,
      })
    }
  })

  it('sends plain connection and Coach calls while forwarding each structured task schema', async () => {
    const envelope = (text: string) => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } })
    const request = vi.fn(async (options: { outputMode: string }) => ({ status: 200,
      body: envelope(options.outputMode === 'TEXT' ? 'OK' : '{}') }))
    const adapter = new DirectByokAdapter({ request } as unknown as MotionAiPlugin)
    const plain = (prompt: string): ProviderRequest => ({ provider: 'GEMINI', model: 'gemini-3.8-flash',
      taskType: 'COACH', prompt, maxOutputTokens: 64, output: outputContractFor('COACH') })
    await adapter.send(plain('Reply with exactly: OK'))
    await adapter.send(plain('给出一句简短建议'))
    for (const taskType of ['MEAL_TEXT','MEAL_PHOTO','WORKOUT_METADATA','SCREENSHOT_ASSIST',
      'TRAINING_PLAN_IMAGE'] as const) await adapter.send({ provider: 'GEMINI', model: 'gemini-3.8-flash',
        taskType, prompt: taskType, maxOutputTokens: 64, output: outputContractFor(taskType),
        ...(taskType === 'MEAL_PHOTO' || taskType === 'TRAINING_PLAN_IMAGE' ? { imageBase64: 'Zm9v' } : {}) })
    expect(request.mock.calls[0]![0]).toMatchObject({ outputMode: 'TEXT', prompt: 'Reply with exactly: OK' })
    expect(request.mock.calls[0]![0]).not.toHaveProperty('responseSchema')
    expect(request.mock.calls[1]![0]).toMatchObject({ outputMode: 'TEXT', prompt: '给出一句简短建议' })
    expect(request.mock.calls[1]![0]).not.toHaveProperty('responseSchema')
    const structured = request.mock.calls.slice(2).map(([options]) => options as unknown as {
      outputMode: string; responseSchema: { properties: Record<string, unknown> } })
    expect(structured).toHaveLength(5)
    expect(structured.every((call) => call.outputMode === 'JSON_SCHEMA')).toBe(true)
    expect(structured[0]!.responseSchema.properties).toHaveProperty('items')
    expect(structured[1]!.responseSchema.properties).toHaveProperty('items')
    expect(structured[2]!.responseSchema.properties).toHaveProperty('activityType')
    expect(structured[3]!.responseSchema.properties).toHaveProperty('weightKg')
    expect(structured[4]!.responseSchema.properties).toHaveProperty('days')
  })

  it('retains local validation after a schema-constrained provider response', async () => {
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [] }) }] } }] })
    const native = { request: vi.fn(async () => ({ status: 200, body })) } as unknown as MotionAiPlugin
    const response = await new DirectByokAdapter(native).send({ provider: 'GEMINI', model: 'gemini-3.8-flash',
      taskType: 'MEAL_TEXT', prompt: 'meal', maxOutputTokens: 64, output: outputContractFor('MEAL_TEXT') })
    expect(() => validateMealEstimate(response.output)).toThrow('INVALID_RESPONSE')
  })

  it('propagates a sanitized connection diagnostic while keeping the probe context-free', async () => {
    const adapter = new FakeAdapter(() => { throw new AiProviderError('AUTH', true, 403, 'PERMISSION') })
    const fixture = await routerFixture(adapter), service = new AiService(fixture.router, fixture.repository,
      new NutritionRepository(fixture.db), fixture.settings, new AiContextBuilder(fixture.db), {} as MotionAiPlugin)
    expect(await service.testConnection()).toEqual({
      ok: false, diagnostic: { provider: 'GEMINI', category: 'PERMISSION', httpStatus: 403 },
    })
    expect(adapter.calls[0]!.prompt).toBe('Reply with exactly: OK')
    expect(adapter.calls[0]!.prompt).not.toMatch(/bodyTrend|nutrition|training|64\.3/)
    expect(JSON.stringify(await fixture.db.query('SELECT * FROM ai_usage_events'))).not.toContain('403')
  })

  it('uses local explicit nutrition, previews ambiguous AI output, and persists only after confirmation with provenance', async () => {
    const adapter = new FakeAdapter(() => ({ output: meal, inputTokens: 4, outputTokens: 8 }))
    const fixture = await routerFixture(adapter), nutrition = new NutritionRepository(fixture.db)
    const native = { chooseMealImage: vi.fn(), hasCredential: vi.fn(), setCredential: vi.fn(), deleteCredential: vi.fn(), request: vi.fn() } as unknown as MotionAiPlugin
    const service = new AiService(fixture.router, fixture.repository, nutrition, fixture.settings,
      new AiContextBuilder(fixture.db), native, () => new Date('2026-09-19T12:00:00'))
    expect(await service.prepareMealText('600 kcal', 'LUNCH')).toEqual({ local: true })
    expect(await service.prepareMealText('午饭 700 kcal，蛋白质 30 g', 'LUNCH')).toEqual({ local: true })
    expect(adapter.calls).toHaveLength(0)
    const prepared = await service.prepareMealText('午饭吃了一份海南鸡饭，鸡皮没吃，大概半碗饭', 'LUNCH')
    expect(prepared.local).toBe(false)
    expect(await nutrition.mealCountOn('2026-09-19')).toBe(2)
    if (!prepared.local) await service.confirmMeal(prepared.draft)
    const meals = await nutrition.mealsOn('2026-09-19')
    expect(meals).toHaveLength(3)
    expect(meals[2]!.entries[0]).toMatchObject({ estimation_method: 'TEXT_AI', raw_input: '午饭吃了一份海南鸡饭，鸡皮没吃，大概半碗饭' })
  })

  it('keeps photo bytes in memory only and saves PHOTO_AI after explicit confirmation', async () => {
    const adapter = new FakeAdapter(() => ({ output: meal, inputTokens: 4, outputTokens: 8 }))
    const fixture = await routerFixture(adapter), nutrition = new NutritionRepository(fixture.db)
    const native = { chooseMealImage: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,Zm9v', width: 800,
      height: 600, mimeType: 'image/jpeg', byteSize: 3 })) } as unknown as MotionAiPlugin
    const service = new AiService(fixture.router, fixture.repository, nutrition, fixture.settings,
      new AiContextBuilder(fixture.db), native, () => new Date('2026-09-19T12:00:00'))
    const draft = await service.prepareMealPhoto('DINNER')
    expect(adapter.calls[0]).toMatchObject({ provider: 'GEMINI', taskType: 'MEAL_PHOTO', imageBase64: 'Zm9v' })
    expect(adapter.calls[0]!.prompt).toContain('Estimate only visible food')
    expect(await nutrition.mealCountOn('2026-09-19')).toBe(0)
    const edited = { ...draft!, estimate: { ...draft!.estimate, items: draft!.estimate.items.map((item) =>
      ({ ...item, caloriesKcal: 499 })) } }
    const ids = await Promise.all([service.confirmMeal(edited), service.confirmMeal(edited)])
    expect(ids[0]).toBe(ids[1])
    expect(await nutrition.mealCountOn('2026-09-19')).toBe(1)
    expect((await nutrition.mealsOn('2026-09-19'))[0]!.entries[0]!.estimation_method).toBe('PHOTO_AI')
    expect((await nutrition.mealsOn('2026-09-19'))[0]!.entries[0]!.calories_kcal).toBe(499)
    expect(JSON.stringify(await fixture.db.query('SELECT * FROM ai_usage_events'))).not.toContain('Zm9v')
  })

  it('reports sanitized Meal Photo provider diagnostics with preprocessing metadata', async () => {
    const adapter = new FakeAdapter(() => { throw new AiProviderError('PROVIDER', true, 503, 'PROVIDER') })
    const fixture = await routerFixture(adapter), native = { chooseMealImage: vi.fn(async () => ({
      dataUrl: 'data:image/jpeg;base64,Zm9v', width: 960, height: 1280, mimeType: 'image/jpeg', byteSize: 3,
    })) } as unknown as MotionAiPlugin
    const service = new AiService(fixture.router, fixture.repository, new NutritionRepository(fixture.db),
      fixture.settings, new AiContextBuilder(fixture.db), native)
    await expect(service.prepareMealPhoto('DINNER')).rejects.toMatchObject({ diagnostic: {
      provider: 'GEMINI', category: 'PROVIDER', httpStatus: 503, width: 960, height: 1280,
      byteSize: 3, mimeType: 'image/jpeg',
    } })
    expect(adapter.calls).toHaveLength(1)
    expect(JSON.stringify(await fixture.db.query('SELECT * FROM ai_usage_events'))).not.toContain('Zm9v')
  })

  it('treats picker cancellation as no draft and does not call a provider', async () => {
    const adapter = new FakeAdapter(() => ({ output: meal, inputTokens: 1, outputTokens: 1 }))
    const fixture = await routerFixture(adapter), native = {
      chooseMealImage: vi.fn(async () => { throw new Error('IMAGE_NOT_SELECTED') }),
    } as unknown as MotionAiPlugin
    const service = new AiService(fixture.router, fixture.repository, new NutritionRepository(fixture.db), fixture.settings,
      new AiContextBuilder(fixture.db), native)
    expect(await service.prepareMealPhoto('LUNCH')).toBeNull()
    expect(adapter.calls).toHaveLength(0)
  })

  it('keeps screenshot, workout metadata, and plan-image output as drafts until explicit confirmation', async () => {
    const adapter = new FakeAdapter((request) => ({ output: request.taskType === 'SCREENSHOT_ASSIST'
      ? { weightKg: 64.3, bodyFatPercent: null, bmi: null, muscleMassKg: null, skeletalMuscle: null,
        bodyWaterPercent: null, visceralFatLevel: null, boneMassKg: null, bmrKcal: null, bodyAge: null }
      : request.taskType === 'WORKOUT_METADATA' ? { activityType: 'HIIT', estimatedIntensity: 'MODERATE',
        impactLevel: 'MEDIUM', requiresEquipment: false, hasJumping: true, bodyAreas: ['FULL_BODY'],
        durationMinutes: 20, confidence: 'MEDIUM' }
        : { title: '两日计划', days: [{ dayIndex: 1, originalLabel: 'D1', title: '全身训练', isRestDay: false,
          expectedDurationMinutes: 20, expectedIntensity: 'MODERATE', notes: null }, { dayIndex: 2,
          originalLabel: 'D2', title: '休息', isRestDay: true, expectedDurationMinutes: null,
          expectedIntensity: null, notes: null }] }, inputTokens: 3, outputTokens: 5 }))
    const fixture = await routerFixture(adapter), service = new AiService(fixture.router, fixture.repository,
      new NutritionRepository(fixture.db), fixture.settings, new AiContextBuilder(fixture.db), {} as MotionAiPlugin,
      () => new Date('2026-09-19T12:00:00Z'))
    await fixture.db.run(`INSERT INTO workout_contents
      (id,content_kind,title,source_type,user_visibility,created_at,updated_at)
      VALUES ('workout','FOLLOW_ALONG','训练','MANUAL','ACTIVE','now','now')`)
    const bodyDraft = await service.screenshotAssist('体重 64.3 kg')
    const workoutDraft = await service.workoutMetadata({ title: '20 分钟全身 HIIT' })
    const planDraft = await service.trainingPlanImage('ZmFrZQ==')
    expect(await fixture.db.query('SELECT * FROM body_measurements')).toHaveLength(0)
    expect(await fixture.db.query("SELECT * FROM content_analyses WHERE method IN ('GEMINI','DEEPSEEK')")).toHaveLength(0)
    expect(await fixture.db.query('SELECT * FROM training_plans')).toHaveLength(0)
    await service.confirmScreenshotAssist(bodyDraft)
    await service.confirmWorkoutMetadata('workout', workoutDraft.draft, workoutDraft.provider)
    await service.confirmTrainingPlanDraft(planDraft)
    expect(await fixture.db.query('SELECT * FROM body_measurements')).toHaveLength(1)
    expect(await fixture.db.query("SELECT * FROM content_analyses WHERE method='GEMINI'")).toHaveLength(1)
    expect((await fixture.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM training_plan_days'))[0]?.count).toBe(2)
  })

  it('limits provider Coach history and enforces safe local routing without plan mutation', async () => {
    const adapter = new FakeAdapter(() => ({ output: '根据当前摘要，先看今天可执行的选项。', inputTokens: 3, outputTokens: 4 }))
    const fixture = await routerFixture(adapter), nutrition = new NutritionRepository(fixture.db)
    const service = new AiService(fixture.router, fixture.repository, nutrition, fixture.settings,
      new AiContextBuilder(fixture.db), {} as MotionAiPlugin, () => new Date('2026-09-19T12:00:00'))
    const state = await service.coachState()
    const safe = await service.sendCoach(state.threadId, '今天吃多了')
    expect(safe.message).toContain('无需通过禁食或惩罚性运动补偿')
    const route = await service.sendCoach(state.threadId, '我想开始集中减脂')
    expect(route.actions).toContainEqual({ label: '查看营养方案', path: '/food/plan/select' })
    expect(await fixture.db.query('SELECT * FROM nutrition_plan_runs')).toHaveLength(0)
    for (let index = 0; index < 8; index++) await fixture.repository.addMessage(state.threadId,
      index % 2 ? 'ASSISTANT' : 'USER', `old private health message ${index}`)
    await service.sendCoach(state.threadId, '解释一下今天状态')
    const sent = adapter.calls.at(-1)!.prompt
    expect(sent).not.toContain('old private health message')
    expect(sent).toContain('解释一下今天状态')
  })

  it('post-processes unsafe Coach text output', async () => {
    const adapter = new FakeAdapter(() => ({ output: '明天降低热量目标并禁食，再用惩罚性运动偿还热量债。',
      inputTokens: 2, outputTokens: 3 }))
    const fixture = await routerFixture(adapter), service = new AiService(fixture.router, fixture.repository,
      new NutritionRepository(fixture.db), fixture.settings, new AiContextBuilder(fixture.db), {} as MotionAiPlugin,
      () => new Date('2026-09-19T12:00:00Z'))
    const state = await service.coachState(), reply = await service.sendCoach(state.threadId, '说点其他建议')
    expect(reply.message).toContain('无需通过禁食')
    expect(reply.message).not.toContain('热量债')
    expect(reply.actions).toEqual([])
  })

  it('rejects hostile numeric and schema values before any draft can be persisted', () => {
    expect(() => validateMealEstimate({ ...meal, items: [{ ...meal.items[0], caloriesKcal: -1 }] })).toThrow('INVALID_RESPONSE')
    expect(() => validateMealEstimate({ ...meal, items: [{ ...meal.items[0], proteinG: Number.POSITIVE_INFINITY }] })).toThrow('INVALID_RESPONSE')
    expect(() => validateWorkoutMetadata({ activityType: 'HIIT', estimatedIntensity: 'impossible', impactLevel: null,
      requiresEquipment: null, hasJumping: null, bodyAreas: [], durationMinutes: 20, confidence: 'MEDIUM' })).toThrow('INVALID_RESPONSE')
    expect(() => validateTrainingPlanDraft({ title: 'x', days: [{ dayIndex: '1', originalLabel: null,
      title: 'x', isRestDay: false, expectedDurationMinutes: 20, expectedIntensity: 'MODERATE', notes: null }] }))
      .toThrow('INVALID_RESPONSE')
    const safe = validateMealEstimate({ ...meal, ignoredSqlIdentifier: 'DROP TABLE meals' })
    expect(safe).not.toHaveProperty('ignoredSqlIdentifier')
  })
})
