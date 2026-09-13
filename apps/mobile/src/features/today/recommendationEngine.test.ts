import { describe, expect, it } from 'vitest'
import { eligibleWorkouts, modeForContext, recommendActivity, recommendWorkout,
  type ActivityCandidate, type RecommendationContext, type WorkoutCandidate } from '@motion/recommendation'

const activity: ActivityCandidate = { id: 'a', name: '健美操', systemKey: 'AEROBICS', isActive: true,
  preference: 'NEUTRAL', inferredScore: 0, timesCompleted: 0, timesRecommended: 0,
  timesAccepted: 0, lastCompletedAt: null, suppressedUntil: null }
const base: WorkoutCandidate = { id: 'one', activityTypeId: 'a', durationMinutes: 20,
  intensity: 'LOW', requiresEquipment: false, visibility: 'ACTIVE', preference: null,
  completionCount: 0, attemptCount: 0, lastCompletedAt: null }
const other: WorkoutCandidate = { ...base, id: 'two' }
function context(changes: Partial<RecommendationContext> = {}): RecommendationContext {
  return { today: '2026-09-13', workouts: [base, other], activities: [activity], recent: [], ...changes }
}
function pick(input: RecommendationContext) { return recommendWorkout(input, 'NORMAL', () => 0.5)?.workoutContentId }

describe('M5 local recommendation engine', () => {
  it('excludes explicit AVOID even when its workout is liked', () => {
    expect(recommendWorkout(context({ activities: [{ ...activity, preference: 'AVOID' }],
      workouts: [{ ...base, preference: 'LOVE' }] }), 'NORMAL')).toBeNull()
  })
  it.each(['TEMPORARILY_HIDDEN', 'ARCHIVED'] as const)('excludes %s content', (visibility) => {
    expect(pick(context({ workouts: [{ ...base, visibility }] }))).toBeUndefined()
  })
  it('applies both hard duration bounds before scoring', () => {
    expect(eligibleWorkouts(context({ workouts: [{ ...base, durationMinutes: 10 }, other],
      durationMin: 15, durationMax: 25 }), 'NORMAL').map((item) => item.id)).toEqual(['two'])
    expect(pick(context({ workouts: [{ ...base, durationMinutes: 40 }], durationMax: 30 }))).toBeUndefined()
  })
  it('excludes known equipment requirements when equipment is unavailable', () => {
    expect(pick(context({ equipmentAvailable: false, workouts: [{ ...base, requiresEquipment: true }] }))).toBeUndefined()
  })
  it('excludes high intensity in recovery, rescue and restart', () => {
    for (const mode of ['RECOVERY', 'RESCUE', 'RESTART'] as const) {
      expect(recommendWorkout(context({ workouts: [{ ...base, intensity: 'HIGH' }] }), mode)).toBeNull()
    }
  })
  it('randomness never revives excluded content', () => {
    expect(recommendWorkout(context({ workouts: [{ ...base, visibility: 'TEMPORARILY_HIDDEN' }] }), 'NORMAL', () => 1)).toBeNull()
  })
  it('ranks LOVE over DISLIKE activity preferences', () => {
    const b = { ...activity, id: 'b', preference: 'DISLIKE' as const }
    const a = { ...activity, preference: 'LOVE' as const }
    expect(pick(context({ activities: [a, b], workouts: [base, { ...other, activityTypeId: 'b' }] }))).toBe('one')
  })
  it('ranks liked workout over disliked workout', () => {
    expect(pick(context({ workouts: [{ ...base, preference: 'LOVE' }, { ...other, preference: 'DISLIKE' }] }))).toBe('one')
    expect(pick(context({ workouts: [{ ...base, preference: 'LIKE' }, { ...other, preference: 'DISLIKE' }] }))).toBe('one')
  })
  it('uses recorded acceptance rate as a small soft signal', () => {
    const likedType = { ...activity, timesRecommended: 4, timesAccepted: 4 }
    const skippedType = { ...activity, id: 'b', timesRecommended: 4, timesAccepted: 0 }
    expect(pick(context({ activities: [likedType, skippedType],
      workouts: [base, { ...other, activityTypeId: 'b' }] }))).toBe('one')
  })
  it('penalizes repeated workouts and repeated activity types', () => {
    const c = { ...activity, id: 'c' }
    expect(pick(context({ activities: [activity, c], workouts: [base, { ...other, activityTypeId: 'c' }],
      recent: [{ workoutContentId: 'one', activityTypeId: 'a', localDate: '2026-09-12',
        durationMinutes: 20, completionStatus: 'COMPLETE', exertion: null }] }))).toBe('two')
  })
  it('novelty shifts between familiar and fresh choices', () => {
    const familiar = { ...base, completionCount: 3, attemptCount: 3, lastCompletedAt: '2026-09-12' }
    expect(pick(context({ workouts: [familiar, other], novelty: 'FAMILIAR' }))).toBe('one')
    expect(pick(context({ workouts: [familiar, other], novelty: 'FRESH' }))).toBe('two')
  })
  it('scores known duration fit above unknown metadata', () => {
    expect(pick(context({ workouts: [base, { ...other, durationMinutes: 40 }],
      durationMin: 15, durationMax: 30 }))).toBe('one')
    expect(pick(context({ workouts: [base, { ...other, durationMinutes: 40 }],
      durationMin: 35, durationMax: 50 }))).toBe('two')
  })
  it('scores requested intensity fit', () => {
    expect(pick(context({ workouts: [base, { ...other, intensity: 'HIGH' }],
      desiredIntensity: 'LIGHT' }))).toBe('one')
  })
  it('uses completion rate and recent difficulty', () => {
    const reliable = { ...base, completionCount: 3, attemptCount: 3 }
    const oftenAbandoned = { ...other, completionCount: 1, attemptCount: 4 }
    expect(pick(context({ workouts: [reliable, oftenAbandoned] }))).toBe('one')
    expect(pick(context({ workouts: [base, { ...other, activityTypeId: 'b' }],
      activities: [activity, { ...activity, id: 'b' }],
      recent: [{ workoutContentId: null, activityTypeId: 'b', localDate: '2026-09-12',
        durationMinutes: 12, completionStatus: 'PARTIAL', exertion: 'HARD' }] }))).toBe('one')
  })
  it('changes mode for mood and active plan without a Streak input', () => {
    expect(modeForContext(context({ mood: 'TIRED' }))).toBe('RECOVERY')
    expect(modeForContext(context({ mood: 'VERY_UNMOTIVATED' }))).toBe('LIGHT')
    expect(modeForContext(context({ mood: 'WANT_FRESHNESS' }))).toBe('EXPLORATION')
    expect(modeForContext(context({ planActive: true, currentWorkoutId: 'one', mood: 'TIRED' }))).toBe('SWAP')
  })
  it('keeps replacements close to a plan when otherwise equivalent', () => {
    const planned = { ...base, id: 'planned', durationMinutes: 25 }
    const unrelated = { ...other, activityTypeId: 'b', durationMinutes: 45 }
    expect(recommendWorkout(context({ workouts: [planned, base, unrelated],
      activities: [activity, { ...activity, id: 'b' }], currentWorkoutId: planned.id,
      planActive: true }), 'SWAP', () => 0.5)).toMatchObject({
        workoutContentId: base.id, reasonCodes: expect.arrayContaining(['MATCH_PLAN']) })
  })
  it('favors light content for tired and recovery contexts', () => {
    expect(recommendWorkout(context({ workouts: [base, { ...other, intensity: 'MODERATE' }] }),
      'RECOVERY', () => 0.5)?.workoutContentId).toBe('one')
    expect(recommendWorkout(context({ workouts: [base, { ...other, intensity: 'MODERATE' }] }),
      'LIGHT', () => 0.5)?.workoutContentId).toBe('one')
  })
  it('supports all seven selection modes without triggering rescue or restart', () => {
    expect(modeForContext(context())).toBe('NORMAL')
    for (const mode of ['NORMAL', 'LIGHT', 'EXPLORATION', 'SWAP', 'RECOVERY', 'RESCUE', 'RESTART'] as const) {
      expect(recommendWorkout(context(), mode, () => 0.5)?.mode).toBe(mode)
    }
  })
  it('varies near-equal choices with injected RNG but favors clearly better ones', () => {
    let sequence = [1, 0]
    const first = recommendWorkout(context(), 'NORMAL', () => sequence.shift() ?? 0)
    sequence = [0, 1]
    const second = recommendWorkout(context(), 'NORMAL', () => sequence.shift() ?? 0)
    expect(first?.workoutContentId).not.toBe(second?.workoutContentId)
    expect(recommendWorkout(context({ workouts: [{ ...base, preference: 'LOVE' }, other] }),
      'NORMAL', () => 0)?.workoutContentId).toBe('one')
  })
  it('returns no workout for an empty library', () => {
    expect(recommendWorkout(context({ workouts: [] }))).toBeNull()
  })
  it('suggests an ActivityType even without matching WorkoutContent', () => {
    expect(recommendActivity(context({ workouts: [] }), () => 0.5)).toMatchObject({
      mode: 'EXPLORATION', workoutContentId: null, activityTypeId: 'a', reasonCodes: ['NEW_ACTIVITY'] })
  })
  it('keeps AVOID and inactive types out of inspiration', () => {
    expect(recommendActivity(context({ activities: [{ ...activity, preference: 'AVOID' }] }))).toBeNull()
    expect(recommendActivity(context({ activities: [{ ...activity, isActive: false }] }))).toBeNull()
  })
  it('keeps incomplete content saved but out of hard duration bands', () => {
    const incomplete = { ...base, durationMinutes: null, intensity: null, activityTypeId: null }
    expect(recommendWorkout(context({ workouts: [incomplete], durationMin: 15, durationMax: 30 }), 'NORMAL')).toBeNull()
    expect(recommendWorkout(context({ workouts: [incomplete] }), 'NORMAL')).toMatchObject({ workoutContentId: 'one' })
  })
})
