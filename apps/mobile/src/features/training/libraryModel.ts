import type { SourceType, WorkoutPreference, WorkoutVisibility } from '@motion/domain'
import type { LibraryWorkout } from '../../db/repositories/WorkoutRepository'
import { uiCopy } from '../../locales'

export type DurationFilter = 'ALL' | 'UNDER_15' | 'FROM_15_TO_30' | 'FROM_30_TO_45' | 'FROM_45' | 'UNKNOWN'
export type HistoryFilter = 'ALL' | 'NEVER' | 'NOT_RECENT'
export type PreferenceFilter = WorkoutPreference | 'ALL' | 'UNRATED'

export interface LibraryFilters {
  search: string
  activityTypeId: string
  sourceType: SourceType | 'ALL'
  duration: DurationFilter
  preference: PreferenceFilter
  history: HistoryFilter
  visibility: WorkoutVisibility
}

export const defaultLibraryFilters: LibraryFilters = {
  search: '', activityTypeId: 'ALL', sourceType: 'ALL', duration: 'ALL',
  preference: 'ALL', history: 'ALL', visibility: 'ACTIVE',
}

export function displayWorkoutTitle(workout: LibraryWorkout): string {
  const title = workout.title?.trim()
  if (title) return title
  if (workout.sourceType === 'WEB' || workout.sourceType === 'LOCAL') {
    try {
      const segment = new URL(workout.sourceUrl ?? '').pathname.split('/').filter(Boolean).at(-1)
      if (segment) return decodeURIComponent(segment)
    } catch { /* Use source fallback. */ }
  }
  return uiCopy.training.fallbackTitles[workout.sourceType]
}

export function formatDisplayMinutes(minutes: number): string {
  if (minutes > 0 && minutes < 0.5) return uiCopy.todayActivity.underOneMinute
  return `${Number.isInteger(minutes) ? '' : uiCopy.todayActivity.about}${Math.round(minutes)} ${uiCopy.training.minutes}`
}

export function workoutTags(workout: LibraryWorkout): string[] {
  const tags: string[] = workout.bodyAreas.map((area) =>
    uiCopy.training.bodyAreas[area as keyof typeof uiCopy.training.bodyAreas]
      ?? (/\p{Script=Han}/u.test(area) ? area : '')).filter(Boolean)
  if (workout.impactLevel === 'LOW') tags.push(uiCopy.training.tags.lowImpact)
  if (workout.requiresEquipment === false) tags.push(uiCopy.training.tags.noEquipment)
  if (workout.hasJumping === false) tags.push(uiCopy.training.tags.noJumping)
  return [...new Set(tags)]
}

function searchText(workout: LibraryWorkout): string {
  return [displayWorkoutTitle(workout), workout.sourceUrl ?? '',
    uiCopy.training.sources[workout.sourceType], workout.activityTypeName ?? '',
    ...workoutTags(workout)].join(' ').normalize('NFKC').toLocaleLowerCase('zh-CN')
}

export function filterLibrary(workouts: readonly LibraryWorkout[], filters: LibraryFilters, now = new Date()): LibraryWorkout[] {
  const query = filters.search.trim().normalize('NFKC').toLocaleLowerCase('zh-CN')
  const recentCutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000
  return workouts.filter((workout) => {
    if (workout.userVisibility !== filters.visibility) return false
    if (query && !searchText(workout).includes(query)) return false
    if (filters.activityTypeId === 'UNCLASSIFIED' && workout.primaryActivityTypeId !== null) return false
    if (filters.activityTypeId !== 'ALL' && filters.activityTypeId !== 'UNCLASSIFIED'
      && workout.primaryActivityTypeId !== filters.activityTypeId) return false
    if (filters.sourceType !== 'ALL' && workout.sourceType !== filters.sourceType) return false
    const duration = workout.durationMinutes
    if (filters.duration === 'UNKNOWN' && duration !== null) return false
    if (filters.duration === 'UNDER_15' && (duration === null || duration >= 15)) return false
    if (filters.duration === 'FROM_15_TO_30' && (duration === null || duration < 15 || duration >= 30)) return false
    if (filters.duration === 'FROM_30_TO_45' && (duration === null || duration < 30 || duration >= 45)) return false
    if (filters.duration === 'FROM_45' && (duration === null || duration < 45)) return false
    if (filters.preference === 'UNRATED' && workout.userPreference !== null) return false
    if (filters.preference !== 'ALL' && filters.preference !== 'UNRATED'
      && workout.userPreference !== filters.preference) return false
    if (filters.history === 'NEVER' && workout.completionCount !== 0) return false
    if (filters.history === 'NOT_RECENT' && (workout.completionCount === 0
      || workout.lastCompletedAt === null || Date.parse(workout.lastCompletedAt) >= recentCutoff)) return false
    return true
  })
}
