import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { NutritionService } from './nutritionService'
import { NutritionPlanManagementScreen, NutritionPlanSelectionScreen } from './NutritionPlanScreens'

const target = { caloriesMin: 1400, caloriesMax: 1650, proteinMinG: 84, proteinMaxG: 96,
  dayType: 'NORMAL', calculationVersion: 'NASEM_2023_M8_V1', rationale: {} }
function selectionService(withMeals = false) {
  return { plans: vi.fn(async () => ({ active: null, scheduled: null, history: [] })),
    previewPlan: vi.fn(async (config) => ({ config, startsOn: withMeals ? '2026-09-16' : '2026-09-15',
      target, unavailableReason: null, startsTomorrow: withMeals })),
    confirmPlan: vi.fn(async () => 'run-1') } as unknown as NutritionService
}

describe('M8 nutrition plan screens', () => {
  it('selects one strategy and layered modifiers, previews, then confirms through the service', async () => {
    const user = userEvent.setup(), service = selectionService()
    render(<MemoryRouter initialEntries={['/food/plan/select']}><Routes>
      <Route path="/food/plan/select" element={<NutritionPlanSelectionScreen suppliedService={service} />} />
      <Route path="/food/plan" element={<h1>我的营养方案</h1>} />
    </Routes></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '选择营养方案' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /集中减脂/ }))
    await user.click(screen.getByRole('checkbox', { name: /高蛋白/ }))
    await user.click(screen.getByRole('checkbox', { name: /进食窗口/ }))
    await user.click(screen.getByRole('checkbox', { name: /每周宽松日/ }))
    await user.click(screen.getByRole('button', { name: '查看预计结果' }))
    expect(await screen.findByRole('heading', { name: '方案预览' })).toBeVisible()
    expect(screen.getByText('1,400–1,650')).toBeVisible()
    expect(service.previewPlan).toHaveBeenCalledWith(expect.objectContaining({ baseStrategy: 'FOCUSED_FAT_LOSS',
      highProtein: true, treEnabled: true, treWindowMinutes: 600, flexibleWeekday: 6 }))
    await user.click(screen.getByRole('button', { name: '确认并从今天开始' }))
    expect(service.confirmPlan).toHaveBeenCalledWith(expect.objectContaining({ baseStrategy: 'FOCUSED_FAT_LOSS' }))
    expect(await screen.findByRole('heading', { name: '我的营养方案' })).toBeVisible()
  })

  it('states the tomorrow effective date when today already has food', async () => {
    const user = userEvent.setup(), service = selectionService(true)
    render(<MemoryRouter><NutritionPlanSelectionScreen suppliedService={service} /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: '查看预计结果' }))
    expect(screen.getByText('今天已有饮食记录，新方案将从明天开始。')).toBeVisible()
    expect(screen.getByRole('button', { name: '确认并从明天开始' })).toBeVisible()
  })

  it('shows current configuration and immutable ended history', async () => {
    const active = { id: 'active', base_strategy: 'STABLE_FAT_LOSS', status: 'ACTIVE',
      starts_on: '2026-09-15', ends_on: null, high_protein: 1, tre_enabled: 1,
      tre_start_local_time: '09:00', tre_window_minutes: 600, flexible_weekday: 6,
      config_version: 1, ended_reason: null, created_at: 'now', updated_at: 'now' }
    const ended = { ...active, id: 'old', base_strategy: 'MAINTENANCE', status: 'ENDED',
      starts_on: '2026-08-01', ends_on: '2026-09-14', high_protein: 0, tre_enabled: 0,
      tre_start_local_time: null, tre_window_minutes: null, flexible_weekday: null }
    const service = { plans: vi.fn(async () => ({ active, scheduled: null, history: [active, ended] })) } as unknown as NutritionService
    render(<MemoryRouter><NutritionPlanManagementScreen suppliedService={service} /></MemoryRouter>)
    expect(await screen.findByText('稳定减脂')).toBeVisible()
    expect(screen.getByText('进食窗口 09:00–19:00')).toBeVisible()
    expect(screen.getByText('每周宽松日：周六')).toBeVisible()
    expect(screen.getByText('2026-08-01 – 2026-09-14')).toBeVisible()
  })
})
