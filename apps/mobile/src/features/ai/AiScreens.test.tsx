import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiService, MealAiDraft } from './aiService'
import { CoachScreen } from './CoachScreen'
import { AiSettingsScreen } from './AiSettingsScreen'
import { MealAiPreviewScreen } from './MealAiPreviewScreen'
import { DEFAULT_AI_SETTINGS } from './aiSettings'
import type { AiSettings } from './aiSettings'
import { MotionAi } from '../../platform/ai/aiNative'

vi.mock('../../platform/ai/aiNative', () => ({ MotionAi: { hasCredential: vi.fn(async () => ({ value: false })),
  setCredential: vi.fn(async () => undefined), deleteCredential: vi.fn(async () => undefined),
  request: vi.fn(), chooseMealImage: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(MotionAi.hasCredential).mockResolvedValue({ value: false })
  vi.mocked(MotionAi.setCredential).mockResolvedValue(undefined)
  vi.mocked(MotionAi.deleteCredential).mockResolvedValue(undefined)
})

const enabledSettings: AiSettings = { ...DEFAULT_AI_SETTINGS, enabled: true, privacyAcknowledged: true }

describe('M10 AI surfaces', () => {
  it('renders minimized Coach context, sends a quick prompt, and shows local actions', async () => {
    const sendCoach = vi.fn(async () => ({ message: '可以从现有训练库选择。', actions: [{ label: '打开训练', path: '/training' }] }))
    const messages = [{ id: 'm1', thread_id: 't', role: 'ASSISTANT' as const, content: '先看今天的状态。', created_at: '2026-09-19' }]
    const service = { coachState: vi.fn(async () => ({ threadId: 't', messages,
      context: { training: { latestSessionStatus: 'NONE', currentStreakDays: 2 },
        nutrition: { knownCaloriesKcal: 600, target: { calories_min: 1400, calories_max: 1650 } },
        bodyTrend: { latestWeightKg: 64.3, change30dKg: -1.2 } } })), sendCoach } as unknown as AiService
    const user = userEvent.setup()
    render(<MemoryRouter><CoachScreen suppliedService={service} /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Coach' })).toBeVisible()
    expect(screen.queryByText('根据你选择共享的 Motion 摘要提供建议。')).not.toBeInTheDocument()
    expect(screen.getByText('600 kcal / 1400–1650')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '今天不想练' }))
    await waitFor(() => expect(sendCoach).toHaveBeenCalledWith('t', '今天不想练'))
    expect(await screen.findByRole('button', { name: '打开训练 →' })).toBeVisible()
  })

  it('uses the restrained visual pending state while Coach opens and waits for a reply', async () => {
    let resolveLoad!: (value: { threadId: string; messages: never[]; context: Record<string, unknown> }) => void
    const initial = new Promise<{ threadId: string; messages: never[]; context: Record<string, unknown> }>(
      (resolve) => { resolveLoad = resolve })
    let resolveReply!: (value: { message: string; actions: never[] }) => void
    const reply = new Promise<{ message: string; actions: never[] }>((resolve) => { resolveReply = resolve })
    const service = { coachState: vi.fn().mockImplementationOnce(() => initial).mockResolvedValue({
      threadId: 't', messages: [], context: {},
    }), sendCoach: vi.fn(() => reply) } as unknown as AiService
    const user = userEvent.setup()
    render(<MemoryRouter><CoachScreen suppliedService={service} /></MemoryRouter>)
    expect(screen.getByRole('status', { name: 'Coach 正在准备' })).toBeVisible()
    expect(screen.queryByText('正在生成回答…')).not.toBeInTheDocument()
    resolveLoad({ threadId: 't', messages: [], context: {} })
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Coach 正在准备' })).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '今天不想练' }))
    expect(screen.getByRole('status', { name: 'Coach 正在回复' })).toBeVisible()
    resolveReply({ message: '可以先休息。', actions: [] })
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Coach 正在回复' })).not.toBeInTheDocument())
  })

  it('requires explicit privacy acknowledgement and saves non-secret AI controls', async () => {
    const save = vi.fn<(settings: AiSettings) => Promise<void>>(async () => undefined)
    const service = { settings: { load: vi.fn(async () => DEFAULT_AI_SETTINGS), save }, testConnection: vi.fn() } as unknown as AiService
    const user = userEvent.setup()
    render(<MemoryRouter><AiSettingsScreen suppliedService={service} /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'AI 与隐私' })).toBeVisible()
    expect(screen.queryByText('AI 仅处理完成所选任务需要的内容。你始终掌控本机数据。')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /启用外部 AI/ }))
    await user.click(screen.getByRole('checkbox', { name: /我已阅读数据发送说明/ }))
    await user.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    const saved = save.mock.calls[0]![0]
    expect(saved).toMatchObject({ enabled: true, privacyAcknowledged: true, monthlyPaidBudgetCny: 0 })
    expect(JSON.stringify(saved)).not.toMatch(/secret|apiKey/i)
    expect(MotionAi.setCredential).not.toHaveBeenCalled()
  })

  it('enables connection testing from persisted credential state after secure save clears the input', async () => {
    const stored = new Set<string>()
    vi.mocked(MotionAi.hasCredential).mockImplementation(async ({ provider }) => ({ value: stored.has(provider) }))
    vi.mocked(MotionAi.setCredential).mockImplementation(async ({ provider }) => { stored.add(provider) })
    const testConnection = vi.fn(async () => ({ ok: true })), service = {
      settings: { load: vi.fn(async () => enabledSettings), save: vi.fn() }, testConnection,
    } as unknown as AiService
    const user = userEvent.setup()
    render(<MemoryRouter><AiSettingsScreen suppliedService={service} /></MemoryRouter>)
    const test = await screen.findByRole('button', { name: '测试连接（不发送个人摘要）' })
    expect(test).toBeDisabled()
    const input = screen.getByPlaceholderText('输入 API 密钥')
    await user.type(input, 'temporary-key')
    await user.click(screen.getByRole('button', { name: '安全保存' }))
    expect(await screen.findByText('已配置 · gemini-3.8-flash')).toBeVisible()
    expect(input).toHaveValue('')
    expect(test).toBeEnabled()
    await user.click(test)
    await waitFor(() => expect(testConnection).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('连接测试成功。')).toBeVisible()
  })

  it('keeps connection testing disabled when no secure credential exists', async () => {
    const service = { settings: { load: vi.fn(async () => enabledSettings), save: vi.fn() },
      testConnection: vi.fn() } as unknown as AiService
    render(<MemoryRouter><AiSettingsScreen suppliedService={service} /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: '测试连接（不发送个人摘要）' })).toBeDisabled()
  })

  it('shows only the sanitized provider category and HTTP status for a failed connection test', async () => {
    vi.mocked(MotionAi.hasCredential).mockImplementation(async ({ provider }) => ({ value: provider === 'GEMINI' }))
    const service = { settings: { load: vi.fn(async () => enabledSettings), save: vi.fn() },
      testConnection: vi.fn(async () => ({ ok: false, diagnostic: {
        provider: 'GEMINI' as const, category: 'PROVIDER' as const, httpStatus: 503,
      } })) } as unknown as AiService
    const user = userEvent.setup()
    render(<MemoryRouter><AiSettingsScreen suppliedService={service} /></MemoryRouter>)
    const test = await screen.findByRole('button', { name: '测试连接（不发送个人摘要）' })
    await waitFor(() => expect(test).toBeEnabled())
    await user.click(test)
    expect(await screen.findByText('连接测试未成功：PROVIDER（HTTP 503）')).toBeVisible()
  })

  it('shows connection loading immediately, coalesces taps, and restores the action after completion', async () => {
    vi.mocked(MotionAi.hasCredential).mockImplementation(async ({ provider }) => ({ value: provider === 'GEMINI' }))
    let resolve!: (value: { ok: true }) => void
    const pending = new Promise<{ ok: true }>((done) => { resolve = done })
    const testConnection = vi.fn(() => pending), service = {
      settings: { load: vi.fn(async () => enabledSettings), save: vi.fn() }, testConnection,
    } as unknown as AiService
    const user = userEvent.setup()
    render(<MemoryRouter><AiSettingsScreen suppliedService={service} /></MemoryRouter>)
    const test = await screen.findByRole('button', { name: '测试连接（不发送个人摘要）' })
    await waitFor(() => expect(test).toBeEnabled())
    await user.click(test)
    expect(screen.getByRole('button', { name: '正在测试连接…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('正在测试连接…')
    fireEvent.click(screen.getByRole('button', { name: '正在测试连接…' }))
    expect(testConnection).toHaveBeenCalledTimes(1)
    resolve({ ok: true })
    expect(await screen.findByText('连接测试成功。')).toBeVisible()
    expect(screen.getByRole('button', { name: '测试连接（不发送个人摘要）' })).toBeEnabled()
  })

  it('renders a visible sanitized timeout and makes the connection action reusable', async () => {
    vi.mocked(MotionAi.hasCredential).mockImplementation(async ({ provider }) => ({ value: provider === 'GEMINI' }))
    const testConnection = vi.fn(async () => ({ ok: false, diagnostic: {
      provider: 'GEMINI' as const, category: 'TIMEOUT' as const, httpStatus: null,
    } })), service = { settings: { load: vi.fn(async () => enabledSettings), save: vi.fn() },
      testConnection } as unknown as AiService
    const user = userEvent.setup()
    render(<MemoryRouter><AiSettingsScreen suppliedService={service} /></MemoryRouter>)
    const test = await screen.findByRole('button', { name: '测试连接（不发送个人摘要）' })
    await waitFor(() => expect(test).toBeEnabled())
    await user.click(test)
    expect(await screen.findByText('连接测试未成功：TIMEOUT')).toBeVisible()
    expect(test).toBeEnabled()
  })

  it('keeps testing enabled after replacing an existing secure credential', async () => {
    vi.mocked(MotionAi.hasCredential).mockImplementation(async ({ provider }) => ({ value: provider === 'GEMINI' }))
    const service = { settings: { load: vi.fn(async () => enabledSettings), save: vi.fn() },
      testConnection: vi.fn() } as unknown as AiService
    const user = userEvent.setup()
    render(<MemoryRouter><AiSettingsScreen suppliedService={service} /></MemoryRouter>)
    const test = await screen.findByRole('button', { name: '测试连接（不发送个人摘要）' })
    await waitFor(() => expect(test).toBeEnabled())
    const input = screen.getByPlaceholderText('输入 API 密钥')
    await user.type(input, 'replacement-key')
    await user.click(screen.getByRole('button', { name: '安全保存' }))
    await waitFor(() => expect(MotionAi.setCredential).toHaveBeenCalledWith({
      provider: 'GEMINI', secret: 'replacement-key',
    }))
    expect(input).toHaveValue('')
    expect(test).toBeEnabled()
  })

  it('disables connection testing immediately after deleting the persisted credential', async () => {
    const stored = new Set(['GEMINI'])
    vi.mocked(MotionAi.hasCredential).mockImplementation(async ({ provider }) => ({ value: stored.has(provider) }))
    vi.mocked(MotionAi.deleteCredential).mockImplementation(async ({ provider }) => { stored.delete(provider) })
    const service = { settings: { load: vi.fn(async () => enabledSettings), save: vi.fn() },
      testConnection: vi.fn() } as unknown as AiService
    const user = userEvent.setup()
    render(<MemoryRouter><AiSettingsScreen suppliedService={service} /></MemoryRouter>)
    const test = await screen.findByRole('button', { name: '测试连接（不发送个人摘要）' })
    await waitFor(() => expect(test).toBeEnabled())
    await user.click(await screen.findByRole('button', { name: '删除已保存密钥' }))
    expect(MotionAi.deleteCredential).toHaveBeenCalledWith({ provider: 'GEMINI' })
    expect(await screen.findByText('已删除保存的密钥。')).toBeVisible()
    expect(test).toBeDisabled()
  })

  it('restores configured and testable state from secure storage after settings remount', async () => {
    vi.mocked(MotionAi.hasCredential).mockImplementation(async ({ provider }) => ({ value: provider === 'GEMINI' }))
    const service = { settings: { load: vi.fn(async () => enabledSettings), save: vi.fn() },
      testConnection: vi.fn() } as unknown as AiService
    const first = render(<MemoryRouter><AiSettingsScreen suppliedService={service} /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('button', { name: '测试连接（不发送个人摘要）' })).toBeEnabled())
    first.unmount()
    render(<MemoryRouter><AiSettingsScreen suppliedService={service} /></MemoryRouter>)
    expect(await screen.findByText('已配置 · gemini-3.8-flash')).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: '测试连接（不发送个人摘要）' })).toBeEnabled())
  })

  it('keeps AI meal output editable and does not persist until explicit confirmation', async () => {
    const draft: MealAiDraft = { confirmationId: 'ai-meal-123e4567-e89b-42d3-a456-426614174000', mode: 'TEXT',
      originalText: '一份海南鸡饭', image: null, source: 'GEMINI', mealType: 'LUNCH',
      estimate: { items: [{ name: '海南鸡饭', portionDescription: '一份', caloriesKcal: 520, proteinG: 28,
        carbsG: 65, fatG: 12, confidence: 'MEDIUM' }], mealEstimate: { caloriesKcal: 520, proteinG: 28,
        carbsG: 65, fatG: 12 }, assumptions: ['按常见份量估算'], confidence: 'MEDIUM' } }
    const confirmMeal = vi.fn<(draft: MealAiDraft) => Promise<string>>(async () => 'meal-id'), service = { confirmMeal } as unknown as AiService
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={[{ pathname: '/food/ai-preview', state: { draft } }]}><Routes>
      <Route path="/food/ai-preview" element={<MealAiPreviewScreen suppliedService={service} />} />
      <Route path="/food" element={<h1>饮食</h1>} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'AI 饮食估算' })).toBeVisible()
    expect(confirmMeal).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/^热量/), { target: { value: '500' } })
    await user.click(screen.getByRole('button', { name: '确认并保存' }))
    await waitFor(() => expect(confirmMeal).toHaveBeenCalled())
    expect(confirmMeal.mock.calls[0]![0].estimate.items[0]!.caloriesKcal).toBe(500)
    expect(await screen.findByRole('heading', { name: '饮食' })).toBeVisible()
  })
})
