import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { NutritionService } from '../food/nutritionService'
import { TodayNutrition } from './TodayNutrition'

describe('Today nutrition presentation', () => {
  it('presents intake, target, protein, range, and partial state as one factual module', async () => {
    const service = {
      daily: vi.fn(async () => ({
        localDate: '2026-09-15',
        meals: [{
          meal: { id: 'meal-1', meal_type: 'DINNER', logged_at: '2026-09-15T18:00:00.000Z' },
          entries: [{ calories_kcal: null, protein_g: null }],
        }],
        target: { calories_min: 1400, calories_max: 1650, protein_min_g: 80, protein_max_g: 100 },
        summary: { caloriesKnown: 1800, proteinKnown: 31, unknownCalories: 1, unknownProtein: 1, entryCount: 2 },
        remaining: { calorieState: 'OVER', caloriesRemainingMin: 0, caloriesRemainingMax: 0,
          proteinGapG: 49, caloriesPartial: true, proteinPartial: true },
        targetUnavailableReason: null,
        planRun: { id: 'run', base_strategy: 'STABLE_FAT_LOSS', high_protein: 1, tre_enabled: 0 },
      })),
    } as unknown as NutritionService

    render(<MemoryRouter><TodayNutrition suppliedService={service} /></MemoryRouter>)

    const section = await screen.findByRole('region', { name: '今日饮食' })
    expect(section).toHaveTextContent('1,800 kcal')
    expect(section).toHaveTextContent('目标 1,400–1,650 kcal')
    expect(section).toHaveTextContent('蛋白质还差 49 g')
    expect(section).toHaveTextContent('今日已超过目标范围')
    expect(section).toHaveTextContent('1 餐热量未知 · 1 餐蛋白质未知')
    expect(section).toHaveTextContent('稳定减脂 · 高蛋白')
    expect(screen.getByRole('link', { name: '去记录 →' })).toHaveAttribute('href', '/food')
  })
})
