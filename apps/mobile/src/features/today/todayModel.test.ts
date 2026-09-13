import { describe, expect, it } from 'vitest'
import type { LibraryWorkout } from '../../db/repositories/WorkoutRepository'
import type { PlanRunDayView } from '../../db/repositories/TrainingPlanRepository'
import type { ExecutionSnapshot } from '../training/trainingExecution'
import { deriveCurrentPlanProgress, deriveTodayProvenance } from './todayModel'

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
