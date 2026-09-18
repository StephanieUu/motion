export type ContentKind = 'FOLLOW_ALONG' | 'FREE_ACTIVITY' | 'MINI_ROUTINE'
export type SourceType = 'BILIBILI' | 'XIAOHONGSHU' | 'QUARK' | 'YOUTUBE' | 'LOCAL' | 'WEB' | 'APP_BUILTIN' | 'MANUAL'
export type WorkoutVisibility = 'ACTIVE' | 'TEMPORARILY_HIDDEN' | 'ARCHIVED'
export type WorkoutPreference = 'LOVE' | 'LIKE' | 'NEUTRAL' | 'DISLIKE'
export type CompletionStatus = 'COMPLETE' | 'MOSTLY_COMPLETE' | 'PARTIAL'
export type PlanEquivalence = 'FULL' | 'PARTIAL' | 'NONE'
export * from './nutrition'
export * from './body'

export interface WorkoutContent {
  id: string
  contentKind: ContentKind
  title: string | null
  description: string | null
  sourceType: SourceType
  sourceUrl: string | null
  durationMinutes: number | null
  primaryActivityTypeId: string | null
  estimatedIntensity: string | null
  impactLevel: string | null
  requiresEquipment: boolean | null
  hasJumping: boolean | null
  bodyAreas: string[]
  userVisibility: WorkoutVisibility
  createdAt: string
  updatedAt: string
}

export interface PlanDayInput {
  dayIndex: number
  title?: string
  isRestDay?: boolean
  items?: Array<{ workoutContentId: string; role: 'PRIMARY' | 'SUPPLEMENTAL' }>
}

export interface TrainingPlan {
  id: string
  title: string
  sourceType: SourceType
  plannedDays: number
  createdAt: string
}

export interface TrainingPlanRunDay {
  id: string
  trainingPlanRunId: string
  trainingPlanDayId: string
  scheduledLocalDate: string
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'SKIPPED' | 'PLANNED_REST'
  executionKind: 'NONE' | 'PLANNED' | 'REPLACEMENT'
  planEquivalence: PlanEquivalence | null
  rescheduleCount: number
}

export interface TrainingSession {
  id: string
  localDate: string
  startedAt: string
  endedAt: string | null
  durationMinutes: number | null
  workoutContentId: string | null
  activityTypeId: string | null
  trainingPlanRunDayId: string | null
  miniRoutineVersionId?: string | null
  lifecycleStatus: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED'
  completionStatus: CompletionStatus | null
  qualifiesForActiveDay: boolean
}

export function addLocalDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== localDate) {
    throw new Error(`Invalid local date: ${localDate}`)
  }
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function localDateAtStart(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
