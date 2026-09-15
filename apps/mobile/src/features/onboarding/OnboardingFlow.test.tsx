import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { NutritionService } from '../food/nutritionService'
import { OnboardingFlow } from './OnboardingFlow'
import { initialOnboardingDisposition, OnboardingService, type OnboardingDisposition,
  type OnboardingPreferenceStore } from './onboardingService'

function memoryStore(initial: OnboardingDisposition | null = null) {
  let value = initial
  const store: OnboardingPreferenceStore = { get: async () => value, set: async (next) => { value = next } }
  return { store, value: () => value }
}

function coordinator(initialVersion = 0) {
  const saveSetup = vi.fn(async () => undefined)
  const daily = vi.fn(async () => ({ localDate: '2026-09-15', meals: [],
    target: { calories_min: 1650, calories_max: 1900, protein_min_g: 84, protein_max_g: 112 },
    summary: {}, remaining: {}, targetUnavailableReason: null }))
  const memory = memoryStore()
  const nutrition = { saveSetup, daily } as unknown as NutritionService
  return { service: new OnboardingService(nutrition, memory.store, initialVersion), saveSetup, daily, memory }
}

describe('M7 onboarding', () => {
  it('only enters for a fresh database and remembers skip or completion', () => {
    expect(initialOnboardingDisposition(null, 0)).toBe('PENDING')
    expect(initialOnboardingDisposition(null, 6)).toBe('SKIPPED')
    expect(initialOnboardingDisposition('COMPLETED', 0)).toBe('COMPLETED')
  })

  it('shows Welcome again after system Back closes a fresh onboarding flow', async () => {
    const current = coordinator()
    expect(await current.service.status()).toBe('PENDING')
    const view = render(<OnboardingFlow service={current.service} onExit={() => undefined} />)
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(current.memory.value()).toBe('PENDING')
    view.unmount()
    const relaunched = new OnboardingService({} as NutritionService, current.memory.store, 7)
    expect(await relaunched.status()).toBe('PENDING')
    render(<OnboardingFlow service={relaunched} onExit={() => undefined} />)
    expect(screen.getByRole('heading', { name: /欢迎来到/ })).toBeVisible()
  })

  it('lets a fresh user explicitly skip without blocking the app and does not repeat', async () => {
    const user = userEvent.setup(), exit = vi.fn(), current = coordinator()
    expect(await current.service.status()).toBe('PENDING')
    render(<OnboardingFlow service={current.service} onExit={exit} />)
    await user.click(screen.getByRole('button', { name: '以后再说' }))
    await waitFor(() => expect(exit).toHaveBeenCalledOnce())
    expect(current.memory.value()).toBe('SKIPPED')
    expect(await new OnboardingService({} as NutritionService, current.memory.store, 7).status()).toBe('SKIPPED')
  })

  it('navigates back between steps and saves the required profile through the nutrition service', async () => {
    const user = userEvent.setup(), exit = vi.fn(), current = coordinator()
    render(<OnboardingFlow service={current.service} onExit={exit} />)
    await user.click(screen.getByRole('button', { name: '开始设置' }))
    expect(screen.getByRole('heading', { name: /达到什么目标/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /减脂建立可持续/ }))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('heading', { name: '关于你' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.getByRole('heading', { name: /达到什么目标/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '出生日期' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '出生年份' }), '1999')
    await user.selectOptions(screen.getByRole('combobox', { name: '出生月份' }), '2')
    await user.selectOptions(screen.getByRole('combobox', { name: '出生日期' }), '25')
    await user.click(screen.getByRole('button', { name: '女性' }))
    await user.type(screen.getByLabelText('身高'), '170')
    await user.type(screen.getByLabelText('当前体重'), '70')
    await user.type(screen.getByLabelText('目标体重'), '65')
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: /日常活动较多/ }))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(await screen.findByText('1,650–1,900')).toBeVisible()
    expect(current.saveSetup).toHaveBeenCalledWith(expect.objectContaining({ birthDate: '1999-02-25',
      sex: 'FEMALE', heightCm: 170, weightKg: 70, targetWeightKg: 65, activityLevel: 'ACTIVE', goal: 'FAT_LOSS' }))
    await user.click(screen.getByRole('button', { name: '开始使用 Motion' }))
    await waitFor(() => expect(exit).toHaveBeenCalledOnce())
    expect(current.memory.value()).toBe('COMPLETED')
    expect(await new OnboardingService({} as NutritionService, current.memory.store, 7).status()).toBe('COMPLETED')
  })

  it('uses system Back from step 2/4 to return to step 1/4 without skipping', async () => {
    const user = userEvent.setup(), current = coordinator()
    await current.service.status()
    render(<OnboardingFlow service={current.service} onExit={() => undefined} />)
    await user.click(screen.getByRole('button', { name: '开始设置' }))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('2/4')).toBeVisible()
    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    expect(screen.getByText('1/4')).toBeVisible()
    expect(current.memory.value()).toBe('PENDING')
  })

  it('requires current weight before generating a target', async () => {
    const user = userEvent.setup(), current = coordinator()
    render(<OnboardingFlow service={current.service} onExit={() => undefined} />)
    await user.click(screen.getByRole('button', { name: '开始设置' }))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '出生日期' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '出生年份' }), '1999')
    await user.selectOptions(screen.getByRole('combobox', { name: '出生月份' }), '2')
    await user.selectOptions(screen.getByRole('combobox', { name: '出生日期' }), '25')
    await user.click(screen.getByRole('button', { name: '女性' }))
    await user.type(screen.getByLabelText('身高'), '170')
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写当前体重')
  })
})
