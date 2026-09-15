import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FoodScreen } from './FoodScreen'
import type { NutritionService } from './nutritionService'

describe('M7 Food entry presentation', () => {
  it('keeps logging available without target setup and passes the selected meal to the same entry service', async () => {
    const logText = vi.fn(async () => undefined)
    const service = { daily: vi.fn(async () => ({ localDate: '2026-09-15', meals: [], target: null,
      summary: { caloriesKnown: 0, proteinKnown: 0, unknownCalories: 0, unknownProtein: 0, entryCount: 0 },
      remaining: { calorieState: 'NO_TARGET', caloriesRemainingMin: null, caloriesRemainingMax: null,
        proteinGapG: null, caloriesPartial: false, proteinPartial: false } })),
    templates: vi.fn(async () => []), setup: vi.fn(async () => ({ profile: null, weight: null })),
    logText } as unknown as NutritionService
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/food']}><Routes>
      <Route path="/food" element={<FoodScreen suppliedService={service} />} />
      <Route path="/food/reference" element={<h1>参考详情</h1>} />
    </Routes></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '饮食' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '今天吃了什么' })).toBeVisible()
    expect(screen.getByRole('region', { name: '早餐' })).toBeVisible()
    expect(screen.queryByText('温柔地照顾自己。')).not.toBeInTheDocument()
    expect(screen.queryByText(/让今天更明亮|每一笔记录，都算数|按已知记录|简单记录，就是好的开始/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('食物或已知数值')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '记一餐' }))
    expect(screen.getByRole('dialog', { name: '记一餐' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '午餐' }))
    await user.type(screen.getByLabelText('食物或已知数值'), '吃了鸡胸肉、米饭和青菜')
    await user.click(screen.getByRole('button', { name: '保存记录' }))
    expect(logText).toHaveBeenCalledWith('吃了鸡胸肉、米饭和青菜', 'LUNCH')
  })

  it('opens the dedicated daily nutrition reference instead of an inline settings form', async () => {
    const current = { daily: vi.fn(async () => ({ localDate: '2026-09-15', meals: [], target: null,
      summary: { caloriesKnown: 0, proteinKnown: 0, unknownCalories: 0, unknownProtein: 0, entryCount: 0 },
      remaining: {}, targetUnavailableReason: 'MISSING_SETUP' })), templates: vi.fn(async () => []) } as unknown as NutritionService
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/food']}><Routes>
      <Route path="/food" element={<FoodScreen suppliedService={current} />} />
      <Route path="/food/reference" element={<h1>参考详情</h1>} />
    </Routes></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: /每日营养参考/ }))
    expect(screen.getByRole('heading', { name: '参考详情' })).toBeVisible()
    expect(screen.queryByLabelText('身高')).not.toBeInTheDocument()
  })

  it('shows the current plan as a restrained route without changing the food hero', async () => {
    const current = { daily: vi.fn(async () => ({ localDate: '2026-09-15', meals: [],
      target: { calories_min: 1400, calories_max: 1650, protein_min_g: 80, day_type: 'FLEXIBLE' },
      summary: { caloriesKnown: 0, proteinKnown: 0, unknownCalories: 0, unknownProtein: 0, entryCount: 0 },
      remaining: { calorieState: 'BELOW', proteinGapG: 80 },
      planRun: { id: 'run', base_strategy: 'STABLE_FAT_LOSS', high_protein: 1, tre_enabled: 1,
        tre_start_local_time: '09:00', tre_window_minutes: 600 } })), templates: vi.fn(async () => []) } as unknown as NutritionService
    render(<MemoryRouter><FoodScreen suppliedService={current} /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: /今日 · 宽松日/ })).toBeVisible()
    expect(screen.getByText('1,400–1,650 kcal')).toBeVisible()
  })
})
