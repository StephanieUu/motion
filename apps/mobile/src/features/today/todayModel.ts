import type { PlanRunDayView } from '../../db/repositories/TrainingPlanRepository'
import type { LibraryWorkout } from '../../db/repositories/WorkoutRepository'
import type { ExecutionSnapshot } from '../training/trainingExecution'
import { uiCopy } from '../../locales'
import { displayWorkoutTitle, formatDisplayMinutes } from '../training/libraryModel'

export type TodayProvenanceKind = 'PLAN_ORIGINAL' | 'RECOMMENDED_REPLACEMENT' |
  'REST_EXTRA' | 'TODAY_RECOMMENDED' | 'MANUAL'

export interface TodayProvenance {
  kind: TodayProvenanceKind
  planDayIndex: number | null
  originalWorkout: LibraryWorkout | null
}

export interface TodayActivity {
  id: string
  title: string
  provenance: string
  actualMinutes: number | null
  durationLabel: string | null
}

export function formatActualMinutes(minutes: number): string {
  return formatDisplayMinutes(minutes)
}

export function deriveTodayActivities(snapshot: ExecutionSnapshot, today: string): {
  count: number; totalMinutes: number; totalLabel: string; entries: TodayActivity[]
} {
  const entries = (snapshot.completedActivities ?? []).filter(({ session }) => session.localDate === today)
    .map(({ session, origin, recommendationSource }) => {
      const workout = snapshot.workouts.find((item) => item.id === session.workoutContentId)
      const restExtra = !session.trainingPlanRunDayId && snapshot.runDays.some((day) => day.isRestDay
        && day.scheduledLocalDate === today)
      const planDay = snapshot.runDays.find((day) => day.id === session.trainingPlanRunDayId)
      const mini = !!session.miniRoutineVersionId
      const provenance = mini && restExtra
        ? `${uiCopy.todayProvenance.restExtra} · ${uiCopy.todayActivity.miniRoutine}`
        : mini ? uiCopy.todayActivity.miniRoutine
          : restExtra ? uiCopy.todayProvenance.restExtra
          : origin === 'FREE_ACTIVITY' ? uiCopy.recommendation.activityEntry
            : recommendationSource === 'RESCUE' || origin === 'RESCUE' ? uiCopy.todayActivity.rescue
              : planDay && session.workoutContentId !== planDay.primaryWorkoutId && recommendationSource
                ? uiCopy.todayProvenance.recommendedReplacement
                : planDay && session.workoutContentId !== planDay.primaryWorkoutId
                  ? uiCopy.todayProvenance.manual
                  : planDay ? uiCopy.todayProvenance.planned
                  : recommendationSource ? uiCopy.todayProvenance.todayRecommended
                    : uiCopy.todayActivity.manual
      return { id: session.id, title: workout ? displayWorkoutTitle(workout)
        : mini ? uiCopy.todayActivity.miniRoutine : uiCopy.recommendation.activityEntry,
      provenance, actualMinutes: session.durationMinutes,
      durationLabel: session.durationMinutes === null ? null : formatActualMinutes(session.durationMinutes) }
    })
  const totalMinutes = entries.reduce((sum, entry) => sum + (entry.actualMinutes ?? 0), 0)
  return { count: entries.length, totalMinutes, totalLabel: `${Math.round(totalMinutes)} ${uiCopy.execution.minutes}`, entries }
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
