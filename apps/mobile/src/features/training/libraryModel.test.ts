import { describe, expect, it } from 'vitest'
import type { LibraryWorkout } from '../../db/repositories/WorkoutRepository'
import { defaultLibraryFilters, displayWorkoutTitle, filterLibrary, workoutTags,
  type LibraryFilters } from './libraryModel'

function item(id: string, changes: Partial<LibraryWorkout> = {}): LibraryWorkout {
  return {
    id, contentKind: 'FOLLOW_ALONG', title: null, description: null,
    sourceType: 'WEB', sourceUrl: null, durationMinutes: null,
    primaryActivityTypeId: null, estimatedIntensity: null, impactLevel: null,
    requiresEquipment: null, hasJumping: null, bodyAreas: [],
    userVisibility: 'ACTIVE', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    activityTypeName: null, userPreference: null, completionCount: 0, lastCompletedAt: null,
    ...changes,
  }
}

const workouts: LibraryWorkout[] = [
  item('bili', { title: '舒展练习', sourceType: 'BILIBILI', sourceUrl: 'https://www.bilibili.com/video/BV1',
    durationMinutes: 10, primaryActivityTypeId: 'yoga', activityTypeName: '瑜伽', userPreference: 'LOVE' }),
  item('xhs', { title: '核心训练', sourceType: 'XIAOHONGSHU', durationMinutes: 25,
    primaryActivityTypeId: 'core', activityTypeName: '核心训练', userPreference: 'LIKE',
    completionCount: 1, lastCompletedAt: '2026-08-01T12:00:00Z' }),
  item('quark', { sourceType: 'QUARK', durationMinutes: 35, userPreference: 'NEUTRAL',
    completionCount: 1, lastCompletedAt: '2026-09-10T12:00:00Z' }),
  item('free', { contentKind: 'FREE_ACTIVITY', title: '快走', sourceType: 'MANUAL', durationMinutes: 50,
    userPreference: 'DISLIKE', userVisibility: 'TEMPORARILY_HIDDEN' }),
  item('web', { title: '网页训练', sourceType: 'WEB' }),
  item('archived', { title: '旧训练', userVisibility: 'ARCHIVED' }),
]

function ids(changes: Partial<LibraryFilters> = {}): string[] {
  return filterLibrary(workouts, { ...defaultLibraryFilters, ...changes }, new Date('2026-09-12T12:00:00Z'))
    .map((workout) => workout.id)
}

describe('M2 library filters', () => {
  it('searches title, source name and activity type', () => {
    expect(ids({ search: '舒展' })).toEqual(['bili'])
    expect(ids({ search: '小红书' })).toEqual(['xhs'])
    expect(ids({ search: '瑜伽' })).toEqual(['bili'])
  })

  it('filters by activity type, including incomplete content', () => {
    expect(ids({ activityTypeId: 'core' })).toEqual(['xhs'])
    expect(ids({ activityTypeId: 'UNCLASSIFIED' })).toEqual(['quark', 'web'])
  })

  it('filters by source', () => {
    expect(ids({ sourceType: 'BILIBILI' })).toEqual(['bili'])
    expect(ids({ sourceType: 'QUARK' })).toEqual(['quark'])
  })

  it('filters duration ranges without dropping unknown durations from the default view', () => {
    expect(ids()).toEqual(['bili', 'xhs', 'quark', 'web'])
    expect(ids({ duration: 'UNDER_15' })).toEqual(['bili'])
    expect(ids({ duration: 'FROM_15_TO_30' })).toEqual(['xhs'])
    expect(ids({ duration: 'FROM_30_TO_45' })).toEqual(['quark'])
    expect(ids({ duration: 'FROM_45', visibility: 'TEMPORARILY_HIDDEN' })).toEqual(['free'])
    expect(ids({ duration: 'UNKNOWN' })).toEqual(['web'])
  })

  it('filters every reaction and unrated workouts', () => {
    expect(ids({ preference: 'LOVE' })).toEqual(['bili'])
    expect(ids({ preference: 'LIKE' })).toEqual(['xhs'])
    expect(ids({ preference: 'NEUTRAL' })).toEqual(['quark'])
    expect(ids({ preference: 'DISLIKE', visibility: 'TEMPORARILY_HIDDEN' })).toEqual(['free'])
    expect(ids({ preference: 'UNRATED' })).toEqual(['web'])
  })

  it('separates never-done from completed but not done in the last 30 days', () => {
    expect(ids({ history: 'NEVER' })).toEqual(['bili', 'web'])
    expect(ids({ history: 'NOT_RECENT' })).toEqual(['xhs'])
  })

  it('keeps hidden and archived workouts out of the active library', () => {
    expect(ids({ visibility: 'TEMPORARILY_HIDDEN' })).toEqual(['free'])
    expect(ids({ visibility: 'ARCHIVED' })).toEqual(['archived'])
    expect(ids({ search: '核心', sourceType: 'XIAOHONGSHU', duration: 'FROM_15_TO_30' })).toEqual(['xhs'])
  })

  it('uses source fallback titles and derives only known tags', () => {
    expect(displayWorkoutTitle(workouts[2]!)).toBe('夸克训练')
    expect(workoutTags(item('tagged', { bodyAreas: ['CORE', 'UNKNOWN'], impactLevel: 'LOW',
      requiresEquipment: false, hasJumping: false }))).toEqual(['核心', '低冲击', '无器械', '无跳跃'])
  })
})
