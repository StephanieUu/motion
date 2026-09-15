import type { NutritionService } from './nutritionService'

export type DailyNutrition = Awaited<ReturnType<NutritionService['daily']>>

export interface TodayNutritionCopy {
  lead: string
  target: string
  protein: string
  state: string
  partial: string
}

const formatted = (value: number) => Math.round(value).toLocaleString('zh-CN')

export function todayNutritionCopy(day: DailyNutrition): TodayNutritionCopy {
  const { summary, target, remaining } = day
  const unknownCalorieMeals = day.meals.filter((meal) => meal.entries.some((entry) =>
    entry.calories_kcal === null)).length
  const unknownProteinMeals = day.meals.filter((meal) => meal.entries.some((entry) =>
    entry.protein_g === null)).length
  const lead = summary.entryCount === 0
    ? '今天还没有饮食记录'
    : summary.unknownCalories === summary.entryCount ? '热量未知' : `${formatted(summary.caloriesKnown)} kcal`
  const partial = [
    unknownCalorieMeals ? `${unknownCalorieMeals} 餐热量未知` : '',
    unknownProteinMeals ? `${unknownProteinMeals} 餐蛋白质未知` : '',
  ].filter(Boolean).join(' · ')

  if (!target) {
    return {
      lead,
      target: day.targetUnavailableReason === 'UNDER_19' ? '暂无成人自动目标' : '尚未设置营养目标',
      state: '',
      partial,
      protein: summary.entryCount && summary.unknownProtein < summary.entryCount
        ? `已记录蛋白质 ${formatted(summary.proteinKnown)} g`
        : '',
    }
  }

  const targetCopy = `目标 ${formatted(target.calories_min)}–${formatted(target.calories_max)} kcal`
  const protein = summary.entryCount === 0
    ? `蛋白质目标 ${formatted(target.protein_min_g)}–${formatted(target.protein_max_g)} g`
    : summary.unknownProtein === summary.entryCount
      ? '蛋白质未知'
      : (remaining.proteinGapG ?? 0) > 0
        ? `蛋白质还差 ${formatted(remaining.proteinGapG ?? 0)} g`
        : '蛋白质已达参考下限'
  const state = summary.entryCount === 0
    ? ''
    : summary.unknownCalories === summary.entryCount
      ? '暂无法比较目标范围'
      : remaining.calorieState === 'OVER'
        ? '今日已超过目标范围'
        : remaining.calorieState === 'IN_RANGE'
          ? '今日已在目标范围内'
          : `距离目标范围 ${formatted(remaining.caloriesRemainingMin ?? 0)}–${formatted(remaining.caloriesRemainingMax ?? 0)} kcal`

  return { lead, target: targetCopy, protein, state, partial }
}
