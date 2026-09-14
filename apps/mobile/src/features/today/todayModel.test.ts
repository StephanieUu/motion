import { describe, expect, it } from 'vitest'
import type { LibraryWorkout } from '../../db/repositories/WorkoutRepository'
import type { PlanRunDayView } from '../../db/repositories/TrainingPlanRepository'
import type { ExecutionSnapshot } from '../training/trainingExecution'
import { deriveCurrentPlanProgress, deriveTodayActivities, deriveTodayProvenance,
  formatActualMinutes } from './todayModel'

const planned: LibraryWorkout = { id: 'planned', contentKind: 'FOLLOW_ALONG', title: '计划训练',
  description: null, sourceType: 'BILIBILI', sourceUrl: null, durationMinutes: 20,
  primaryActivityTypeId: null, estimatedIntensity: null, impactLevel: null, requiresEquipment: null,
  hasJumping: null, bodyAreas: [], userVisibility: 'ACTIVE', createdAt: '2026-09-13',
  updatedAt: '2026-09-13', activityTypeName: null, userPreference: null, completionCount: 0,
  lastCompletedAt: null }
const actual: LibraryWorkout = { ...planned, id: 'actual', title: '替换训练' }
const day: PlanRunDayView = { id: 'run-day', trainingPlanRunId: 'run', trainingPlanDayId: 'plan-day',
  scheduledLocalDate: '2026-09-13', originalScheduledLocalDate: '2026-09-13', status: 'SCHEDULED',
  executionKind: 'NONE', planEquivalence: null, rescheduleCount: 0, dayIndex: 1, title: null,
  isRestDay: false, primaryWorkoutId: planned.id }
function snapshot(changes: Partial<ExecutionSnapshot> = {}): ExecutionSnapshot {
  return { plans: [], run: { id: 'run', trainingPlanId: 'plan', startedOn: '2026-09-13',
    status: 'ACTIVE', currentDayIndex: 1, pausedAt: null }, runDays: [day], currentDay: day,
  workouts: [planned, actual], pendingWorkoutId: null, mainWorkout: planned, session: null,
  selectionOrigin: null, ...changes }
}

describe('Today provenance and current plan progress', () => {
  it('presents every completed origin today with actual minutes and preserved plan/rest provenance', () => {
    const rest = { ...day, id: 'rest', isRestDay: true, primaryWorkoutId: null }
    const session = (id: string, durationMinutes: number, workoutContentId: string,
      trainingPlanRunDayId: string | null = null, miniRoutineVersionId: string | null = null) => ({
        id, localDate: '2026-09-13', startedAt: '2026-09-13T10:00:00Z', endedAt: '2026-09-13T10:10:00Z',
        durationMinutes, workoutContentId, activityTypeId: 'other', trainingPlanRunDayId,
        miniRoutineVersionId, lifecycleStatus: 'COMPLETED' as const, completionStatus: 'COMPLETE' as const,
        qualifiesForActiveDay: durationMinutes >= 6,
      })
    const current = snapshot({ runDays: [day], completedActivities: [
      { session: session('planned', 12, planned.id, day.id), origin: 'PLAN', recommendationSource: null },
      { session: session('replacement', 8, actual.id, day.id), origin: 'EXISTING_LIBRARY',
        recommendationSource: 'LIBRARY' },
      { session: session('manual', 2, actual.id), origin: 'EXISTING_LIBRARY', recommendationSource: null },
      { session: session('free', 3, actual.id), origin: 'FREE_ACTIVITY', recommendationSource: null },
      { session: session('mini', 3.9166666666666665, actual.id, null, 'mini-v1'),
        origin: 'EXISTING_LIBRARY', recommendationSource: null },
      { session: session('rescue', 4, actual.id), origin: 'RESCUE', recommendationSource: 'RESCUE' },
    ] })
    const result = deriveTodayActivities(current, '2026-09-13')
    expect(result.count).toBe(6)
    expect(result.entries.map((entry) => entry.provenance)).toEqual([
      '计划训练', '推荐替换', '自己选择', '新的运动', '小练习', '今天加练',
    ])
    expect(result.entries[4]).toMatchObject({ actualMinutes: 3.9166666666666665,
      durationLabel: '约 4 分钟' })
    const restResult = deriveTodayActivities(snapshot({ runDays: [rest], currentDay: rest,
      completedActivities: [{ session: session('rest-extra', 1, actual.id),
        origin: 'EXISTING_LIBRARY', recommendationSource: null }] }), '2026-09-13')
    expect(restResult.entries[0]).toMatchObject({ provenance: '休息日加练', actualMinutes: 1,
      durationLabel: '1 分钟' })
    const restMini = deriveTodayActivities(snapshot({ runDays: [rest], currentDay: rest,
      completedActivities: [{ session: session('voluntary-mini', 4, actual.id, null, 'mini-v2'),
        origin: 'EXISTING_LIBRARY', recommendationSource: null }] }), '2026-09-13')
    expect(restMini.entries[0]).toMatchObject({ provenance: '休息日加练 · 小练习', actualMinutes: 4 })
    expect(formatActualMinutes(3.9166666666666665)).not.toContain('3.9166666666666665')
  })
  it('has no activity entries when no completed session belongs to the device-local day', () => {
    expect(deriveTodayActivities(snapshot(), '2026-09-13')).toMatchObject({ count: 0, entries: [] })
  })
  it('labels the original plan workout with its plan day', () => {
    expect(deriveTodayProvenance(snapshot(), '2026-09-13')).toMatchObject({
      kind: 'PLAN_ORIGINAL', planDayIndex: 1 })
  })
  it('shows the original workout for a recommended replacement', () => {
    expect(deriveTodayProvenance(snapshot({ mainWorkout: actual, pendingWorkoutId: actual.id,
      selectionOrigin: 'RECOMMENDATION' }), '2026-09-13')).toMatchObject({
        kind: 'RECOMMENDED_REPLACEMENT', originalWorkout: { id: planned.id } })
  })
  it('distinguishes manual replacement and no-plan manual selection', () => {
    expect(deriveTodayProvenance(snapshot({ mainWorkout: actual, pendingWorkoutId: actual.id,
      selectionOrigin: 'MANUAL' }), '2026-09-13')).toMatchObject({
        kind: 'MANUAL', originalWorkout: { id: planned.id } })
    expect(deriveTodayProvenance(snapshot({ run: null, runDays: [], currentDay: null,
      mainWorkout: actual, pendingWorkoutId: actual.id, selectionOrigin: 'MANUAL' }), '2026-09-13'))
      .toMatchObject({ kind: 'MANUAL', originalWorkout: null })
  })
  it('labels a no-plan recommendation as a recommendation', () => {
    expect(deriveTodayProvenance(snapshot({ run: null, runDays: [], currentDay: null,
      mainWorkout: actual, pendingWorkoutId: actual.id, selectionOrigin: 'RECOMMENDATION' }), '2026-09-13'))
      .toMatchObject({ kind: 'TODAY_RECOMMENDED' })
  })
  it('treats a workout on a planned rest day as extra training', () => {
    const rest = { ...day, isRestDay: true, primaryWorkoutId: null }
    expect(deriveTodayProvenance(snapshot({ runDays: [rest], currentDay: rest,
      mainWorkout: actual, pendingWorkoutId: actual.id }), '2026-09-13'))
      .toMatchObject({ kind: 'REST_EXTRA', originalWorkout: null })
  })
  it('counts chronological position including rest and full planned completion only', () => {
    const completed = { ...day, status: 'COMPLETED' as const, planEquivalence: 'FULL' as const }
    const rest = { ...day, id: 'rest', dayIndex: 2, isRestDay: true, primaryWorkoutId: null,
      scheduledLocalDate: '2026-09-14', status: 'SCHEDULED' as const }
    const pending = { ...day, id: 'pending', dayIndex: 3,
      scheduledLocalDate: '2026-09-15' }
    expect(deriveCurrentPlanProgress(snapshot({ runDays: [pending, rest, completed],
      currentDay: rest }))).toMatchObject({ position: 2, totalDays: 3,
        completedTraining: 1, totalTraining: 2, segments: [
          { kind: 'COMPLETED' }, { kind: 'REST' }, { kind: 'PENDING' }] })
  })
  it('does not count a rest-day extra workout or partial and skipped plan days', () => {
    const rest = { ...day, isRestDay: true, primaryWorkoutId: null, status: 'PLANNED_REST' as const }
    const partial = { ...day, id: 'partial', dayIndex: 2, scheduledLocalDate: '2026-09-14',
      status: 'COMPLETED' as const, planEquivalence: 'PARTIAL' as const }
    const skipped = { ...day, id: 'skipped', dayIndex: 3, scheduledLocalDate: '2026-09-15',
      status: 'SKIPPED' as const }
    expect(deriveCurrentPlanProgress(snapshot({ runDays: [rest, partial, skipped], currentDay: null })))
      .toMatchObject({ position: 3, totalDays: 3, completedTraining: 0, totalTraining: 2,
        segments: [{ kind: 'REST_DONE' }, { kind: 'PARTIAL' }, { kind: 'SKIPPED' }] })
  })
  it.each([['FULL', 1], ['PARTIAL', 0], ['NONE', 0]] as const)(
    'counts replacement equivalence %s consistently', (equivalence, count) => {
      const completed = { ...day, status: 'COMPLETED' as const, planEquivalence: equivalence }
      expect(deriveCurrentPlanProgress(snapshot({ runDays: [completed], currentDay: null })))
        .toMatchObject({ completedTraining: count, totalTraining: 1 })
    })
  it('uses rescheduled chronological order for the current position', () => {
    const first = { ...day, scheduledLocalDate: '2026-09-15' }
    const rest = { ...day, id: 'rest', dayIndex: 2, isRestDay: true, primaryWorkoutId: null,
      scheduledLocalDate: '2026-09-13' }
    expect(deriveCurrentPlanProgress(snapshot({ runDays: [first, rest], currentDay: first })))
      .toMatchObject({ position: 2, totalDays: 2, segments: [{ kind: 'REST' }, { kind: 'PENDING' }] })
  })
})
