import type { NutritionBaseStrategy, NutritionPlanConfig } from '@motion/domain'
import type { NutritionPlanRunRecord } from '../../db/repositories/NutritionRepository'

export const strategyLabels: Record<NutritionBaseStrategy, string> = {
  STABLE_FAT_LOSS: '稳定减脂', FOCUSED_FAT_LOSS: '集中减脂', MAINTENANCE: '维持体重',
}
export const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export function treWindow(config: Pick<NutritionPlanConfig, 'treEnabled' | 'treStartLocalTime' | 'treWindowMinutes'>): string | null {
  if (!config.treEnabled || !config.treStartLocalTime || !config.treWindowMinutes) return null
  const [hour, minute] = config.treStartLocalTime.split(':').map(Number)
  const total = (hour! * 60 + minute! + config.treWindowMinutes) % 1440
  return `${config.treStartLocalTime}–${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function compactPlanLabel(run: NutritionPlanRunRecord | null, dayType?: string): string {
  if (!run) return ''
  if (dayType === 'FLEXIBLE') return '今日 · 宽松日'
  const parts = [strategyLabels[run.base_strategy]]
  if (run.high_protein) parts.push('高蛋白')
  const window = treWindow({ treEnabled: !!run.tre_enabled, treStartLocalTime: run.tre_start_local_time,
    treWindowMinutes: run.tre_window_minutes })
  if (window) parts.push(window)
  return parts.join(' · ')
}

export function configFromRun(run: NutritionPlanRunRecord): NutritionPlanConfig {
  return { baseStrategy: run.base_strategy, highProtein: !!run.high_protein,
    treEnabled: !!run.tre_enabled, treStartLocalTime: run.tre_start_local_time,
    treWindowMinutes: run.tre_window_minutes, flexibleWeekday: run.flexible_weekday }
}
