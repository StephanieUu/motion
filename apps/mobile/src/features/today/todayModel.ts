import type { PlanRunDayView } from '../../db/repositories/TrainingPlanRepository'
import type { LibraryWorkout } from '../../db/repositories/WorkoutRepository'
import type { ExecutionSnapshot } from '../training/trainingExecution'

export type TodayProvenanceKind = 'PLAN_ORIGINAL' | 'RECOMMENDED_REPLACEMENT' |
  'REST_EXTRA' | 'TODAY_RECOMMENDED' | 'MANUAL'

export interface TodayProvenance {
  kind: TodayProvenanceKind
  planDayIndex: number | null
  originalWorkout: LibraryWorkout | null
}

export function deriveTodayProvenance(snapshot: ExecutionSnapshot, today: string): TodayProvenance | null {
  const workout = snapshot.mainWorkout
  if (!workout) return null
  const day = snapshot.currentDay
  const selected = snapshot.pendingWorkoutId === workout.id || snapshot.session?.workoutContentId === workout.id
  const due = !!snapshot.run && snapshot.run.status === 'ACTIVE' && !!day && day.scheduledLocalDate <= today
  const tiedToPlan = !snapshot.session || snapshot.session.trainingPlanRunDayId === day?.id
  const originalWorkout = day?.primaryWorkoutId
    ? snapshot.workouts.find((item) => item.id === day.primaryWorkoutId) ?? null : null
  if (due && day?.isRestDay && selected) return { kind: 'REST_EXTRA', planDayIndex: day.dayIndex,
    originalWorkout: null }
  if (day && !day.isRestDay && workout.id === day.primaryWorkoutId && tiedToPlan) {
    return { kind: 'PLAN_ORIGINAL', planDayIndex: day.dayIndex, originalWorkout: null }
  }
  if (due && day && !day.isRestDay && selected && tiedToPlan) return {
    kind: snapshot.selectionOrigin === 'RECOMMENDATION' ? 'RECOMMENDED_REPLACEMENT' : 'MANUAL',
    planDayIndex: day.dayIndex, originalWorkout,
  }
  if (selected) return { kind: snapshot.selectionOrigin === 'RECOMMENDATION' ? 'TODAY_RECOMMENDED' : 'MANUAL',
    planDayIndex: null, originalWorkout: null }
  return null
}

export type ProgressSegmentKind = 'REST' | 'REST_DONE' | 'COMPLETED' | 'PARTIAL' |
  'SKIPPED' | 'IN_PROGRESS' | 'PENDING'

export interface CurrentPlanProgress {
  planId: string
  position: number
  totalDays: number
  completedTraining: number
  totalTraining: number
  segments: Array<{ id: string; kind: ProgressSegmentKind; current: boolean }>
}

function segmentKind(day: PlanRunDayView): ProgressSegmentKind {
  if (day.isRestDay) return day.status === 'PLANNED_REST' ? 'REST_DONE' : 'REST'
  if (day.status === 'COMPLETED' && day.planEquivalence === 'FULL') return 'COMPLETED'
  if (day.status === 'COMPLETED' || day.status === 'PARTIALLY_COMPLETED') return 'PARTIAL'
  if (day.status === 'SKIPPED') return 'SKIPPED'
  if (day.status === 'IN_PROGRESS') return 'IN_PROGRESS'
  return 'PENDING'
}

export function deriveCurrentPlanProgress(snapshot: ExecutionSnapshot): CurrentPlanProgress | null {
  if (!snapshot.run || !snapshot.runDays.length) return null
  const ordered = [...snapshot.runDays].sort((a, b) =>
    a.scheduledLocalDate.localeCompare(b.scheduledLocalDate) || a.dayIndex - b.dayIndex)
  const currentIndex = snapshot.currentDay ? ordered.findIndex((day) => day.id === snapshot.currentDay?.id) : -1
  const position = currentIndex >= 0 ? currentIndex + 1 : ordered.length
  return { planId: snapshot.run.trainingPlanId, position, totalDays: ordered.length,
    completedTraining: ordered.filter((day) => !day.isRestDay && segmentKind(day) === 'COMPLETED').length,
    totalTraining: ordered.filter((day) => !day.isRestDay).length,
    segments: ordered.map((day) => ({ id: day.id, kind: segmentKind(day),
      current: day.id === snapshot.currentDay?.id })),
  }
}
