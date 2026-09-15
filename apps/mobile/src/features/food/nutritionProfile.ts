import type { ActivityLevel, NutritionGoal, NutritionSex } from '@motion/domain'
import type { NutritionProfile } from '../../db/repositories/NutritionRepository'
import type { NutritionSetup } from './nutritionService'

export interface NutritionProfileDraft {
  birthDate: string
  sex: NutritionSex | ''
  heightCm: string
  weightKg: string
  goal: NutritionGoal
  targetWeightKg: string
  activityLevel: ActivityLevel | ''
}

export const activityOptions: ReadonlyArray<{ value: ActivityLevel; title: string; detail: string; symbol: string }> = [
  { value: 'INACTIVE', title: '多数时间久坐', detail: '大部分时间在桌前或学习，日常活动较少。', symbol: '♙' },
  { value: 'LOW_ACTIVE', title: '日常有一些走动', detail: '日常生活中有一定的走动，例如上下班、遛狗等。', symbol: '♧' },
  { value: 'ACTIVE', title: '日常活动较多', detail: '经常走动，偶尔进行运动或较多的体力活动。', symbol: '♢' },
  { value: 'VERY_ACTIVE', title: '高活动量生活', detail: '几乎每天高度行走或大量的身体活动。', symbol: '✣' },
]

export const activityLabel = (value: ActivityLevel | null | undefined) =>
  activityOptions.find((item) => item.value === value)?.title ?? '尚未设置活动节奏'

export function profileDraft(profile: NutritionProfile | null, latestWeight: number | null): NutritionProfileDraft {
  return { birthDate: profile?.birth_date ?? '', sex: profile?.sex as NutritionSex | '' || '',
    heightCm: profile?.height_cm?.toString() ?? '', weightKg: latestWeight?.toString() ?? '',
    goal: profile?.goal_type === 'FAT_LOSS' ? 'FAT_LOSS' : 'MAINTENANCE',
    targetWeightKg: profile?.target_weight_kg?.toString() ?? '',
    activityLevel: profile?.activity_level ?? '' }
}

function positive(value: string, label: string, required: boolean): number | null {
  if (!value.trim()) {
    if (required) throw new Error(`请填写${label}。`)
    return null
  }
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}需要大于零。`)
  return number
}

export function nutritionSetupFromDraft(draft: NutritionProfileDraft): NutritionSetup {
  if (!draft.birthDate) throw new Error('请选择出生日期。')
  if (!draft.sex) throw new Error('请选择生理性别。')
  if (!draft.activityLevel) throw new Error('请选择日常活动节奏。')
  return { birthDate: draft.birthDate, sex: draft.sex, heightCm: positive(draft.heightCm, '身高', true),
    weightKg: positive(draft.weightKg, '当前体重', true), goal: draft.goal,
    targetWeightKg: draft.goal === 'FAT_LOSS' ? positive(draft.targetWeightKg, '目标体重', false) : null,
    activityLevel: draft.activityLevel }
}
