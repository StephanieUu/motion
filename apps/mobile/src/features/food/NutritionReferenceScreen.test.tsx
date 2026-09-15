import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { NutritionService } from './nutritionService'
import { NutritionProfileScreen, NutritionReferenceScreen } from './NutritionReferenceScreen'

const profile = { id: 'p', birth_date: '1999-02-25', sex: 'FEMALE', height_cm: 170,
  goal_type: 'FAT_LOSS', target_weight_kg: 65, desired_weight_loss_rate: null, activity_level: 'ACTIVE' }
const day = { localDate: '2026-09-15', meals: [], target: { calories_min: 1650, calories_max: 1900,
  protein_min_g: 84, protein_max_g: 112 }, summary: {}, remaining: {}, targetUnavailableReason: null }

function service() {
  return { daily: vi.fn(async () => day), setup: vi.fn(async () => ({ profile,
    weight: { weight_kg: 70 } })), saveSetup: vi.fn(async () => undefined) } as unknown as NutritionService
}

describe('nutrition reference screens', () => {
  it('shows the saved reference and routes to personal profile editing', async () => {
    const user = userEvent.setup(), current = service()
    render(<MemoryRouter initialEntries={['/food/reference']}><Routes>
      <Route path="/food/reference" element={<NutritionReferenceScreen suppliedService={current} />} />
      <Route path="/food/profile" element={<NutritionProfileScreen suppliedService={current} />} />
    </Routes></MemoryRouter>)
    expect(await screen.findByText('1,650–1,900')).toBeVisible()
    expect(screen.getByText(/70 kg · 170 cm/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '调整个人资料 →' }))
    expect(await screen.findByRole('heading', { name: '编辑个人资料' })).toBeVisible()
  })

  it('saves profile edits through the existing setup transaction and returns to the reference', async () => {
    const user = userEvent.setup(), current = service()
    render(<MemoryRouter initialEntries={['/food/profile']}><Routes>
      <Route path="/food/reference" element={<NutritionReferenceScreen suppliedService={current} />} />
      <Route path="/food/profile" element={<NutritionProfileScreen suppliedService={current} />} />
    </Routes></MemoryRouter>)
    expect(await screen.findByRole('spinbutton', { name: '当前体重' })).toHaveValue(70)
    await user.clear(screen.getByLabelText('当前体重')); await user.type(screen.getByLabelText('当前体重'), '71')
    await user.click(screen.getByRole('button', { name: '保存并更新参考' }))
    expect(current.saveSetup).toHaveBeenCalledWith(expect.objectContaining({ birthDate: '1999-02-25',
      weightKg: 71, activityLevel: 'ACTIVE' }))
    expect(await screen.findByRole('heading', { name: '每日营养参考' })).toBeVisible()
  })

  it('shows the under-19 state without inventing an adult target', async () => {
    const current = service() as unknown as { daily: ReturnType<typeof vi.fn>; setup: ReturnType<typeof vi.fn> }
    current.daily.mockResolvedValue({ ...day, target: null, targetUnavailableReason: 'UNDER_19' })
    render(<MemoryRouter><NutritionReferenceScreen suppliedService={current as unknown as NutritionService} /></MemoryRouter>)
    expect(await screen.findByText('暂不生成成人参考')).toBeVisible()
  })
})
