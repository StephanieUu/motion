import { act, render, screen, waitFor } from '@testing-library/react'
import { Capacitor } from '@capacitor/core'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SharedWorkoutPayload } from '@motion/integrations'
import type { LibraryWorkout } from '../db/repositories/WorkoutRepository'
import type { TrainingLibrary } from '../features/training/trainingLibrary'
import type { NutritionService } from '../features/food/nutritionService'
import { OnboardingService } from '../features/onboarding/onboardingService'
import { App } from './App'

const shareBridge = vi.hoisted(() => ({
  listener: null as ((share: SharedWorkoutPayload) => void) | null,
  pending: [] as SharedWorkoutPayload[],
  acknowledged: [] as string[],
}))
vi.mock('../platform/share/motionShare', () => ({
  MotionShare: {
    addListener: async (_name: string, callback: (share: SharedWorkoutPayload) => void) => {
      shareBridge.listener = callback
      return { remove: async () => { if (shareBridge.listener === callback) shareBridge.listener = null } }
    },
    getPendingShares: async () => ({ shares: shareBridge.pending }),
    acknowledgeShare: async ({ eventId }: { eventId: string }) => { shareBridge.acknowledged.push(eventId) },
  },
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: async () => undefined }) } }))

afterEach(() => {
  vi.restoreAllMocks()
  shareBridge.listener = null
  shareBridge.pending = []
  shareBridge.acknowledged = []
})

function library() {
  const imports: string[] = []
  const workouts: LibraryWorkout[] = []
  const service: TrainingLibrary = {
    load: async () => ({ workouts: [...workouts], activityTypes: [], pendingTodayWorkoutId: null }),
    importShare: async (share) => {
      imports.push(share.eventId)
      const id = share.eventId
      if (!workouts.some((item) => item.id === id)) workouts.push({
        id, contentKind: 'FOLLOW_ALONG', title: null, description: null, sourceType: 'BILIBILI',
        sourceUrl: share.text, durationMinutes: null, primaryActivityTypeId: null,
        estimatedIntensity: null, impactLevel: null, requiresEquipment: null, hasJumping: null,
        bodyAreas: [], userVisibility: 'ACTIVE', createdAt: '', updatedAt: '',
        activityTypeName: null, userPreference: null, completionCount: 0, lastCompletedAt: null,
      })
      return { eventId: share.eventId, workoutContentId: id, status: 'NEEDS_MORE_INFO' }
    },
    addUrl: async () => { throw new Error('Unexpected add') },
    addFreeActivity: async () => { throw new Error('Unexpected add') },
    update: async () => { throw new Error('Unexpected update') },
    setPreference: async () => { throw new Error('Unexpected preference') },
    setVisibility: async () => { throw new Error('Unexpected visibility') },
    remove: async () => { throw new Error('Unexpected remove') },
    selectToday: async () => undefined,
  }
  return { service, imports, workouts }
}
const skippedOnboarding = () => new OnboardingService({} as NutritionService,
  { get: async () => 'SKIPPED', set: async () => undefined }, 6)

describe('M3 Android share routing', () => {
  it('drains a cold-start share and a repeated delivery resolves to one workout', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    const item = { eventId: 'cold', text: 'https://b23.tv/abc', subject: null }
    shareBridge.pending = [item]
    const { service, imports, workouts } = library()
    render(<MemoryRouter><App trainingLibrary={service} onboardingService={skippedOnboarding()} /></MemoryRouter>)
    expect(await screen.findByText('信息待补充，已存入训练库')).toBeVisible()
    expect(imports).toEqual(['cold'])
    expect(shareBridge.acknowledged).toEqual(['cold'])
    act(() => shareBridge.listener?.(item))
    await waitFor(() => expect(imports).toEqual(['cold', 'cold']))
    expect(workouts).toHaveLength(1)
  })

  it('routes a warm share from another tab into Training', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    const { service, imports } = library()
    render(<MemoryRouter initialEntries={['/food']}><App trainingLibrary={service}
      onboardingService={skippedOnboarding()} /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '饮食' })).toBeVisible()
    await waitFor(() => expect(shareBridge.listener).not.toBeNull())
    act(() => shareBridge.listener?.({ eventId: 'warm', text: 'https://b23.tv/warm', subject: '晨间训练' }))
    expect(await screen.findByText('信息待补充，已存入训练库')).toBeVisible()
    expect(imports).toEqual(['warm'])
    expect(shareBridge.acknowledged).toEqual(['warm'])
  })
})
