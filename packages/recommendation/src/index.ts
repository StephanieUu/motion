export type RecommendationMode = 'NORMAL' | 'LIGHT' | 'EXPLORATION' | 'SWAP' | 'RECOVERY' | 'RESCUE' | 'RESTART'
export type Mood = 'VERY_UNMOTIVATED' | 'TIRED' | 'NORMAL' | 'ENERGETIC' | 'WANT_FRESHNESS'
export type DesiredIntensity = 'LIGHT' | 'MODERATE' | 'HIGH' | 'AUTO'
export type Novelty = 'FAMILIAR' | 'MIXED' | 'FRESH'
export type ExplicitPreference = 'LOVE' | 'LIKE' | 'NEUTRAL' | 'DISLIKE' | 'AVOID'
export type ReasonCode = 'MATCH_DURATION' | 'MATCH_INTENSITY' | 'MATCH_PLAN' | 'FAVORITE' | 'FRESH' | 'FAMILIAR' | 'RECOVERY' | 'LIGHT' | 'VARIETY' | 'NEW_ACTIVITY'

export interface ActivityCandidate {
  id: string
  name: string
  systemKey: string | null
  isActive: boolean
  preference: ExplicitPreference
  inferredScore: number
  timesCompleted: number
  timesRecommended: number
  timesAccepted: number
  lastCompletedAt: string | null
  suppressedUntil: string | null
}

export interface WorkoutCandidate {
  id: string
  activityTypeId: string | null
  durationMinutes: number | null
  intensity: string | null
  requiresEquipment: boolean | null
  visibility: 'ACTIVE' | 'TEMPORARILY_HIDDEN' | 'ARCHIVED'
  preference: Exclude<ExplicitPreference, 'AVOID'> | null
  completionCount: number
  attemptCount: number
  lastCompletedAt: string | null
}

export interface RecentTraining {
  workoutContentId: string | null
  activityTypeId: string | null
  localDate: string
  durationMinutes: number | null
  completionStatus: 'COMPLETE' | 'MOSTLY_COMPLETE' | 'PARTIAL' | null
  exertion: 'EASY' | 'JUST_RIGHT' | 'HARD' | null
}

export interface RecommendationContext {
  today: string
  workouts: WorkoutCandidate[]
  activities: ActivityCandidate[]
  recent: RecentTraining[]
  currentWorkoutId?: string | null
  excludedWorkoutIds?: string[]
  planActive?: boolean
  mood?: Mood
  desiredIntensity?: DesiredIntensity
  durationMin?: number
  durationMax?: number
  novelty?: Novelty
  equipmentAvailable?: boolean
  recoveryConstrained?: boolean
  streak?: { current: number } | null
}

export interface RecommendationResult {
  mode: RecommendationMode
  workoutContentId: string | null
  activityTypeId: string | null
  score: number
  scoreBreakdown: Record<string, number>
  reasonCodes: ReasonCode[]
  durationMinutes: number | null
  intensity: string | null
  novelty: Novelty
}

// Central weights keep ranking explainable. Hard exclusions are applied before these scores.
export const weights = {
  activity: { LOVE: 16, LIKE: 9, NEUTRAL: 0, DISLIKE: -12, AVOID: -Infinity },
  workout: { LOVE: 20, LIKE: 11, NEUTRAL: 0, DISLIKE: -18 },
  durationMatch: 12, durationUnknown: -2, intensityMatch: 8, intensityUnknown: -2,
  recentSameWorkout: -19, recentSameActivity: -5, longAbsent: 7,
  familiar: 6, fresh: 9, completed: 3, difficultCompletion: -6, completionRate: 8,
  acceptanceRate: 6,
  planActivity: 5, planDuration: 4,
  recoveryLow: 11, recoveryModerate: -5, lightLow: 7, rescueShort: 12,
  restartManageable: 7, controlledRandomness: 4,
} as const

function daysSince(today: string, timestamp: string | null): number | null {
  if (!timestamp) return null
  const distance = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${timestamp.slice(0, 10)}T00:00:00Z`)) / 86400000
  return Number.isFinite(distance) ? Math.max(0, distance) : null
}

function normalizedIntensity(value: string | null): 'LIGHT' | 'MODERATE' | 'HIGH' | null {
  if (value === 'LOW' || value === 'LIGHT') return 'LIGHT'
  if (value === 'MODERATE' || value === 'MEDIUM') return 'MODERATE'
  if (value === 'HIGH') return 'HIGH'
  return null
}

export function modeForContext(context: RecommendationContext): RecommendationMode {
  if (context.planActive && context.currentWorkoutId) return 'SWAP'
  if (context.recoveryConstrained || context.mood === 'TIRED') return 'RECOVERY'
  if (context.mood === 'VERY_UNMOTIVATED') return 'LIGHT'
  if (context.mood === 'WANT_FRESHNESS' || context.novelty === 'FRESH') return 'EXPLORATION'
  return 'NORMAL'
}

function isRecovery(mode: RecommendationMode, context: RecommendationContext): boolean {
  return mode === 'RECOVERY' || mode === 'RESCUE' || mode === 'RESTART' || !!context.recoveryConstrained
}

export function eligibleWorkouts(context: RecommendationContext, mode: RecommendationMode): WorkoutCandidate[] {
  const activityById = new Map(context.activities.map((activity) => [activity.id, activity]))
  return context.workouts.filter((workout) => {
    const activity = workout.activityTypeId ? activityById.get(workout.activityTypeId) : undefined
    if (workout.visibility !== 'ACTIVE' || workout.id === context.currentWorkoutId ||
      context.excludedWorkoutIds?.includes(workout.id)) return false
    if (activity && (!activity.isActive || activity.preference === 'AVOID' ||
      (activity.suppressedUntil && activity.suppressedUntil >= context.today))) return false
    // An unknown duration cannot be verified against an explicit hard band.
    if ((context.durationMin !== undefined || context.durationMax !== undefined) && workout.durationMinutes === null) return false
    if (workout.durationMinutes !== null && ((context.durationMin !== undefined && workout.durationMinutes < context.durationMin) ||
      (context.durationMax !== undefined && workout.durationMinutes > context.durationMax))) return false
    if (context.equipmentAvailable === false && workout.requiresEquipment === true) return false
    if (isRecovery(mode, context) && normalizedIntensity(workout.intensity) === 'HIGH') return false
    return true
  })
}

function scoreWorkout(workout: WorkoutCandidate, context: RecommendationContext, mode: RecommendationMode): RecommendationResult {
  const activity = context.activities.find((item) => item.id === workout.activityTypeId)
  const planned = mode === 'SWAP' ? context.workouts.find((item) => item.id === context.currentWorkoutId) : undefined
  const breakdown: Record<string, number> = {}
  const reasons: ReasonCode[] = []
  const add = (key: string, value: number) => { breakdown[key] = value }
  add('activityPreference', activity ? weights.activity[activity.preference] + Math.max(-5, Math.min(5, activity.inferredScore * 4)) : 0)
  if (activity && activity.timesRecommended > 0) add('activityAcceptance',
    (activity.timesAccepted / activity.timesRecommended - 0.5) * weights.acceptanceRate)
  add('workoutPreference', workout.preference ? weights.workout[workout.preference] : 0)
  if (breakdown.activityPreference! > 0 || breakdown.workoutPreference! > 0) reasons.push('FAVORITE')
  if (context.durationMin !== undefined || context.durationMax !== undefined) {
    add('duration', workout.durationMinutes === null ? weights.durationUnknown : weights.durationMatch)
    if (workout.durationMinutes !== null) reasons.push('MATCH_DURATION')
  }
  const desired = context.desiredIntensity === 'AUTO' ? null : context.desiredIntensity ?? null
  const actual = normalizedIntensity(workout.intensity)
  if (desired) {
    add('intensity', actual === null ? weights.intensityUnknown : actual === desired ? weights.intensityMatch : -5)
    if (actual === desired) reasons.push('MATCH_INTENSITY')
  }
  if (planned) {
    if (planned.activityTypeId && planned.activityTypeId === workout.activityTypeId) {
      add('planActivity', weights.planActivity); reasons.unshift('MATCH_PLAN')
    }
    if (planned.durationMinutes !== null && workout.durationMinutes !== null &&
      Math.abs(planned.durationMinutes - workout.durationMinutes) <= 10) {
      add('planDuration', weights.planDuration)
      if (!reasons.includes('MATCH_PLAN')) reasons.unshift('MATCH_PLAN')
    }
  }
  const recentSame = context.recent.filter((item) => item.workoutContentId === workout.id).length
  const recentType = context.recent.filter((item) => item.activityTypeId && item.activityTypeId === workout.activityTypeId).length
  add('repetition', recentSame * weights.recentSameWorkout + Math.min(2, recentType) * weights.recentSameActivity)
  const age = daysSince(context.today, workout.lastCompletedAt)
  const novelty = context.novelty ?? 'MIXED'
  if (novelty === 'FRESH') {
    add('novelty', age === null || age >= 14 ? weights.fresh : -8)
    if (age === null || age >= 14) reasons.push('FRESH')
  } else if (novelty === 'FAMILIAR') {
    add('novelty', workout.completionCount > 0 ? weights.familiar : -6)
    if (workout.completionCount > 0) reasons.push('FAMILIAR')
  } else if (age === null || age >= 14) {
    add('novelty', weights.longAbsent); reasons.push('VARIETY')
  }
  add('completion', workout.completionCount > 0 ? weights.completed : 0)
  if (workout.attemptCount > 0) add('completionRate',
    (workout.completionCount / workout.attemptCount - 0.5) * weights.completionRate)
  const typeHistory = context.recent.filter((item) => item.activityTypeId === workout.activityTypeId)
  if (typeHistory.some((item) => item.completionStatus === 'PARTIAL' || item.exertion === 'HARD')) add('recentDifficulty', weights.difficultCompletion)
  if (isRecovery(mode, context)) {
    add('recovery', actual === 'LIGHT' ? weights.recoveryLow : actual === 'MODERATE' ? weights.recoveryModerate : 0)
    if (actual === 'LIGHT') reasons.push('RECOVERY')
  } else if (mode === 'LIGHT' || context.mood === 'VERY_UNMOTIVATED') {
    add('light', actual === 'LIGHT' ? weights.lightLow : 0)
    if (actual === 'LIGHT') reasons.push('LIGHT')
  } else if (context.mood === 'ENERGETIC' && actual === 'HIGH') add('energy', 5)
  if (mode === 'RESCUE' && workout.durationMinutes !== null) {
    add('rescueDuration', workout.durationMinutes <= 15
      ? weights.rescueShort + (context.streak?.current ? 2 : 0) : -8)
    if (workout.durationMinutes <= 15) reasons.push('LIGHT')
  }
  if (mode === 'RESTART' && workout.durationMinutes !== null) {
    add('restartDuration', workout.durationMinutes <= 30 ? weights.restartManageable : -5)
  }
  return { mode, workoutContentId: workout.id, activityTypeId: workout.activityTypeId,
    score: Object.values(breakdown).reduce((sum, value) => sum + value, 0), scoreBreakdown: breakdown,
    reasonCodes: reasons.slice(0, 3), durationMinutes: workout.durationMinutes, intensity: workout.intensity, novelty }
}

function boundedRandom(rng: () => number): number {
  const value = rng()
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5
}

export function recommendWorkout(context: RecommendationContext, mode = modeForContext(context), rng: () => number = Math.random): RecommendationResult | null {
  const scored = eligibleWorkouts(context, mode).map((workout) => scoreWorkout(workout, context, mode))
  if (!scored.length) return null
  const best = scored.reduce((max, item) => Math.max(max, item.score), -Infinity)
  const nearBest = scored.filter((item) => item.score >= best - 7)
  nearBest.sort((a, b) => b.score - a.score || a.workoutContentId!.localeCompare(b.workoutContentId!))
  // Only near-best candidates participate; each receives a bounded, injected jitter.
  return nearBest.map((item) => {
    const jitter = boundedRandom(rng) * weights.controlledRandomness
    return { ...item, score: item.score + jitter,
      scoreBreakdown: { ...item.scoreBreakdown, controlledRandomness: jitter } }
  })
    .sort((a, b) => b.score - a.score || a.workoutContentId!.localeCompare(b.workoutContentId!))[0]!
}

export function recommendActivity(context: RecommendationContext, rng: () => number = Math.random): RecommendationResult | null {
  const eligible = context.activities.filter((activity) => activity.isActive && activity.systemKey !== 'OTHER' && activity.preference !== 'AVOID' &&
    (!activity.suppressedUntil || activity.suppressedUntil < context.today))
  if (!eligible.length) return null
  const scored = eligible.map((activity) => {
    const recent = context.recent.filter((item) => item.activityTypeId === activity.id).length
    const age = daysSince(context.today, activity.lastCompletedAt)
    const novelty = context.novelty ?? 'FRESH'
    const breakdown = { activityPreference: weights.activity[activity.preference] + Math.max(-5, Math.min(5, activity.inferredScore * 4)),
      activityAcceptance: activity.timesRecommended > 0
        ? (activity.timesAccepted / activity.timesRecommended - 0.5) * weights.acceptanceRate : 0,
      novelty: novelty === 'FAMILIAR' ? activity.timesCompleted > 0 ? 8 : -4 : age === null || age >= 14 ? 12 : -4,
      repetition: -recent * 5 }
    return { activity, breakdown, score: Object.values(breakdown).reduce((sum, value) => sum + value, 0) }
  })
  const best = Math.max(...scored.map((item) => item.score))
  const picked = scored.filter((item) => item.score >= best - 7)
    .map((item) => {
      const jitter = boundedRandom(rng) * weights.controlledRandomness
      return { ...item, score: item.score + jitter,
        breakdown: { ...item.breakdown, controlledRandomness: jitter } }
    })
    .sort((a, b) => b.score - a.score || a.activity.id.localeCompare(b.activity.id))[0]!
  return { mode: 'EXPLORATION', workoutContentId: null, activityTypeId: picked.activity.id,
    score: picked.score, scoreBreakdown: picked.breakdown,
    reasonCodes: [picked.activity.timesCompleted === 0 ? 'NEW_ACTIVITY'
      : context.novelty === 'FAMILIAR' ? 'FAMILIAR' : 'VARIETY'],
    durationMinutes: null, intensity: null, novelty: context.novelty ?? 'FRESH' }
}
