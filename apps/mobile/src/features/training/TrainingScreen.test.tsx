import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Capacitor } from '@capacitor/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryWorkout } from '../../db/repositories/WorkoutRepository'
import { uiCopy } from '../../locales'
import { TrainingScreen } from './TrainingScreen'
import type { TrainingLibrary } from './trainingLibrary'

const nativeBack = vi.hoisted(() => ({ listener: null as (() => void) | null }))
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_event: string, listener: () => void) => {
      nativeBack.listener = listener
      return { remove: async () => { if (nativeBack.listener === listener) nativeBack.listener = null } }
    },
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  nativeBack.listener = null
  document.documentElement.scrollTop = 0
})

function workout(id: string, changes: Partial<LibraryWorkout> = {}): LibraryWorkout {
  return {
    id, contentKind: 'FOLLOW_ALONG', title: null, description: null,
    sourceType: 'BILIBILI', sourceUrl: 'https://www.bilibili.com/video/BV123',
    durationMinutes: null, primaryActivityTypeId: null, estimatedIntensity: null,
    impactLevel: null, requiresEquipment: null, hasJumping: null, bodyAreas: [],
    userVisibility: 'ACTIVE', createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
    activityTypeName: null, userPreference: null, completionCount: 0, lastCompletedAt: null,
    ...changes,
  }
}

function fakeLibrary(initial: LibraryWorkout[] = []) {
  let entries = [...initial]
  let pendingTodayWorkoutId: string | null = null
  const library: TrainingLibrary = {
    load: async () => ({ workouts: [...entries], pendingTodayWorkoutId, activityTypes: [{
      id: 'yoga', system_key: 'YOGA', name: '瑜伽', is_active: 1, is_system: 1,
    }] }),
    addUrl: async (url) => {
      const added = workout('new', { sourceUrl: url })
      entries = [added, ...entries]
      return added
    },
    addFreeActivity: async (title) => {
      const added = workout('free', { title, contentKind: 'FREE_ACTIVITY', sourceType: 'MANUAL', sourceUrl: null })
      entries = [added, ...entries]
      return added
    },
    update: async (id, changes) => { entries = entries.map((entry) => entry.id === id ? {
      ...entry, title: changes.title, sourceUrl: changes.sourceUrl ?? entry.sourceUrl,
      durationMinutes: changes.durationMinutes, primaryActivityTypeId: changes.primaryActivityTypeId,
      activityTypeName: changes.primaryActivityTypeId === 'yoga' ? '瑜伽' : null,
      estimatedIntensity: changes.estimatedIntensity,
    } : entry) },
    setPreference: async (id, preference) => { entries = entries.map((entry) => entry.id === id
      ? { ...entry, userPreference: preference } : entry) },
    setVisibility: async (id, visibility) => { entries = entries.map((entry) => entry.id === id
      ? { ...entry, userVisibility: visibility } : entry) },
    remove: async (id) => { entries = entries.filter((entry) => entry.id !== id); return 'deleted' },
    importShare: async () => { throw new Error('Unexpected import') },
    selectToday: async (id) => { pendingTodayWorkoutId = id },
  }
  return library
}

describe('M2 Training screen', () => {
  it('offers today selection for manual URL and Free Activity workouts', async () => {
    const user = userEvent.setup()
    render(<TrainingScreen library={fakeLibrary()} />)
    await screen.findByRole('heading', { name: uiCopy.training.title })

    await user.click(screen.getByRole('button', { name: uiCopy.training.add }))
    await user.type(screen.getByLabelText(uiCopy.training.urlField), 'https://www.bilibili.com/video/BV123')
    await user.click(screen.getByRole('button', { name: uiCopy.training.save }))
    expect(await screen.findByRole('button', { name: uiCopy.training.import.selectToday })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.training.import.selectToday }))
    expect(await screen.findByText(uiCopy.training.import.todaySelected)).toBeVisible()
    expect(screen.queryByRole('button', { name: uiCopy.training.import.selectToday })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: uiCopy.training.back }))
    await user.click(screen.getByRole('button', { name: uiCopy.training.add }))
    await user.click(screen.getByRole('button', { name: uiCopy.training.addFree }))
    await user.type(screen.getByLabelText(uiCopy.training.freeActivityName), '快走')
    await user.click(screen.getByRole('button', { name: uiCopy.training.save }))
    expect(await screen.findByRole('button', { name: uiCopy.training.import.selectToday })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.training.import.selectToday }))
    expect(await screen.findByText(uiCopy.training.import.todaySelected)).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.training.back }))
    await user.click(screen.getByRole('button', { name: /B站训练/ }))
    expect(screen.getByRole('button', { name: uiCopy.training.import.selectToday })).toBeVisible()
  })

  it('allows existing and temporarily hidden workouts, but not archived workouts', async () => {
    const user = userEvent.setup()
    render(<TrainingScreen library={fakeLibrary([
      workout('existing', { title: '原有训练' }),
      workout('hidden', { title: '隐藏训练', userVisibility: 'TEMPORARILY_HIDDEN' }),
      workout('archived', { title: '归档训练', userVisibility: 'ARCHIVED' }),
    ])} />)
    await screen.findByRole('heading', { name: uiCopy.training.title })
    await user.click(screen.getByRole('button', { name: /原有训练/ }))
    expect(screen.getByRole('button', { name: uiCopy.training.import.selectToday })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.training.import.selectToday }))
    expect(await screen.findByText(uiCopy.training.import.todaySelected)).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.training.back }))

    await user.click(screen.getByRole('button', { name: uiCopy.training.hiddenWorkouts }))
    await user.click(screen.getByRole('button', { name: /隐藏训练/ }))
    expect(screen.getByRole('button', { name: uiCopy.training.unhide })).toBeVisible()
    expect(screen.getByRole('button', { name: uiCopy.training.import.selectToday })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.training.import.selectToday }))
    expect(await screen.findByText(uiCopy.training.import.todaySelected)).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.training.back }))

    await user.click(screen.getByRole('button', { name: uiCopy.training.archivedWorkouts }))
    await user.click(screen.getByRole('button', { name: /归档训练/ }))
    expect(screen.queryByRole('button', { name: uiCopy.training.import.selectToday })).not.toBeInTheDocument()
    expect(screen.queryByText(uiCopy.training.import.todaySelected)).not.toBeInTheDocument()
  })

  it('shows an incomplete import and saves today selection without entering a session flow', async () => {
    const user = userEvent.setup()
    const imported = workout('shared', { sourceType: 'QUARK', sourceUrl: 'https://pan.quark.cn/s/abc' })
    render(<TrainingScreen library={fakeLibrary([imported])} importResult={{
      eventId: 'share-event', workoutContentId: 'shared', status: 'NEEDS_MORE_INFO',
    }} />)
    expect(await screen.findByText(uiCopy.training.import.savedIncomplete)).toBeVisible()
    expect(screen.getByRole('button', { name: uiCopy.training.import.selectToday })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.training.import.selectToday }))
    expect(await screen.findAllByText(uiCopy.training.import.todaySelected)).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: uiCopy.today.startWorkout })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: uiCopy.training.back }))
    expect(screen.getByRole('button', { name: /夸克训练/ })).toHaveTextContent(uiCopy.training.import.todaySelected)
  })

  it('keeps incomplete messaging when core metadata is ready but optional details are missing', async () => {
    render(<TrainingScreen library={fakeLibrary([workout('ready', { title: '20分钟瑜伽',
      durationMinutes: 20, primaryActivityTypeId: 'yoga', activityTypeName: '瑜伽' })])}
      importResult={{ eventId: 'ready-event', workoutContentId: 'ready', status: 'READY' }} />)
    expect(await screen.findByText(uiCopy.training.import.savedIncomplete)).toBeVisible()
  })

  it('returns from add and detail to the filtered library, and from edit to detail', async () => {
    const user = userEvent.setup()
    render(<TrainingScreen library={fakeLibrary([
      workout('bili', { title: '拉伸训练' }),
      workout('quark', { title: '核心训练', sourceType: 'QUARK', sourceUrl: 'https://pan.quark.cn/s/123' }),
    ])} />)
    await screen.findByRole('heading', { name: uiCopy.training.title })
    await user.click(screen.getByRole('button', { name: uiCopy.training.filters }))
    await user.type(screen.getByRole('searchbox'), '核心')
    await user.selectOptions(screen.getByLabelText(uiCopy.training.source), 'QUARK')
    document.documentElement.scrollTop = 320

    await user.click(screen.getByRole('button', { name: /核心训练/ }))
    const libraryBack = screen.getByRole('button', { name: uiCopy.training.back })
    expect(libraryBack.querySelector('svg')).not.toBeNull()
    expect(document.documentElement.scrollTop).toBe(0)
    await user.click(screen.getByRole('button', { name: uiCopy.training.edit }))
    await user.click(screen.getByRole('button', { name: uiCopy.training.backToDetail }))
    expect(screen.getByRole('heading', { name: '核心训练' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.training.back }))
    expect(screen.getByRole('searchbox')).toHaveValue('核心')
    expect(screen.getByLabelText(uiCopy.training.source)).toHaveValue('QUARK')
    expect(document.documentElement.scrollTop).toBe(320)

    await user.click(screen.getByRole('button', { name: uiCopy.training.add }))
    await user.click(screen.getByRole('button', { name: uiCopy.training.addFree }))
    expect(screen.getByRole('heading', { name: uiCopy.training.addFree })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.training.back }))
    expect(screen.getByRole('searchbox')).toHaveValue('核心')
    expect(screen.getByLabelText(uiCopy.training.source)).toHaveValue('QUARK')
  })

  it('uses Android back for the same Training subview transitions', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    const user = userEvent.setup()
    render(<TrainingScreen library={fakeLibrary([workout('one', { title: '拉伸训练' })])} />)
    await screen.findByRole('heading', { name: uiCopy.training.title })
    expect(nativeBack.listener).toBeNull()

    await user.click(screen.getByRole('button', { name: /拉伸训练/ }))
    await waitFor(() => expect(nativeBack.listener).not.toBeNull())
    await user.click(screen.getByRole('button', { name: uiCopy.training.edit }))
    await waitFor(() => expect(nativeBack.listener).not.toBeNull())
    act(() => nativeBack.listener?.())
    expect(screen.getByRole('heading', { name: '拉伸训练' })).toBeVisible()
    act(() => nativeBack.listener?.())
    expect(screen.getByRole('heading', { name: uiCopy.training.title })).toBeVisible()
    await waitFor(() => expect(nativeBack.listener).toBeNull())

    await user.click(screen.getByRole('button', { name: uiCopy.training.add }))
    await waitFor(() => expect(nativeBack.listener).not.toBeNull())
    await user.click(screen.getByRole('button', { name: uiCopy.training.addFree }))
    await waitFor(() => expect(nativeBack.listener).not.toBeNull())
    act(() => nativeBack.listener?.())
    expect(screen.getByRole('heading', { name: uiCopy.training.title })).toBeVisible()
  })

  it('adds an URL-only workout, defers its reaction, edits metadata and temporarily hides it', async () => {
    const user = userEvent.setup()
    render(<TrainingScreen library={fakeLibrary()} />)
    await screen.findByRole('heading', { name: uiCopy.training.title })
    await user.click(screen.getByRole('button', { name: uiCopy.training.add }))
    await user.type(screen.getByLabelText(uiCopy.training.urlField), 'https://www.bilibili.com/video/BV123')
    await user.click(screen.getByRole('button', { name: uiCopy.training.save }))
    expect(await screen.findByRole('heading', { name: uiCopy.training.fallbackTitles.BILIBILI })).toBeVisible()
    expect(screen.getByText(uiCopy.training.neverDone)).toBeVisible()
    expect(screen.getByRole('heading', { name: '训练感受' })).toBeVisible()
    expect(screen.getByText('练过后再评价')).toBeVisible()
    expect(screen.queryByRole('group', { name: '训练感受' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: uiCopy.training.hide })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.training.edit }))
    await user.type(screen.getByLabelText(uiCopy.training.titleField), '拉伸训练')
    await user.type(screen.getByLabelText(uiCopy.training.duration), '20')
    await user.selectOptions(screen.getByLabelText(uiCopy.training.activityType), 'yoga')
    await user.selectOptions(screen.getByLabelText(uiCopy.training.intensity), 'LOW')
    await user.click(screen.getByRole('button', { name: uiCopy.training.save }))
    expect(await screen.findByRole('heading', { name: '拉伸训练' })).toBeVisible()
    expect(screen.getByText('20 分钟')).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.training.hide }))
    await user.click(screen.getByRole('button', { name: uiCopy.training.back }))
    expect(screen.queryByRole('button', { name: /拉伸训练/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: uiCopy.training.hiddenWorkouts }))
    expect(screen.getByRole('button', { name: /拉伸训练/ })).toBeVisible()
  })

  it('offers optional workout-level reactions after completion and can clear one', async () => {
    const user = userEvent.setup()
    render(<TrainingScreen library={fakeLibrary([workout('done', { title: '拉伸训练',
      completionCount: 1, lastCompletedAt: '2026-09-10T12:00:00Z' })])} />)
    await screen.findByRole('heading', { name: uiCopy.training.title })
    await user.click(screen.getByRole('button', { name: /拉伸训练/ }))
    expect(screen.getByRole('heading', { name: '训练感受' })).toBeVisible()
    expect(screen.queryByText('练过后再评价')).not.toBeInTheDocument()
    const reactions = screen.getByRole('group', { name: '训练感受' })
    expect(within(reactions).getAllByRole('button')).toHaveLength(4)
    expect(screen.getByRole('button', { name: uiCopy.training.hide })).toBeVisible()
    await user.click(within(reactions).getByRole('button', { name: uiCopy.training.reactionLabels.LOVE }))
    expect(within(reactions).getByRole('button', { name: uiCopy.training.reactionLabels.LOVE }))
      .toHaveAttribute('aria-pressed', 'true')
    await user.click(within(reactions).getByRole('button', { name: uiCopy.training.reactionLabels.LOVE }))
    expect(within(reactions).getByRole('button', { name: uiCopy.training.reactionLabels.LOVE }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('searches and filters the list, then removes an unreferenced workout', async () => {
    const user = userEvent.setup()
    render(<TrainingScreen library={fakeLibrary([
      workout('bili', { title: '拉伸训练', durationMinutes: 20 }),
      workout('quark', { title: '核心训练', sourceType: 'QUARK', sourceUrl: 'https://pan.quark.cn/s/123',
        durationMinutes: 45, userPreference: 'LIKE' }),
    ])} />)
    await screen.findByRole('heading', { name: uiCopy.training.title })
    await user.type(screen.getByRole('searchbox'), '核心')
    expect(screen.getByRole('button', { name: /核心训练/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /拉伸训练/ })).not.toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox'))
    await user.click(screen.getByRole('button', { name: uiCopy.training.filters }))
    await user.selectOptions(screen.getByLabelText(uiCopy.training.source), 'QUARK')
    await user.selectOptions(screen.getByLabelText('训练感受'), 'LIKE')
    expect(screen.getByRole('button', { name: /核心训练/ })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /核心训练/ }))
    await user.click(screen.getByRole('button', { name: uiCopy.training.remove }))
    const confirmation = screen.getByRole('group', { name: uiCopy.training.remove })
    await user.click(within(confirmation).getByRole('button', { name: uiCopy.training.confirmRemove }))
    expect(await screen.findByText(uiCopy.training.deleted)).toBeVisible()
    expect(screen.queryByRole('button', { name: /核心训练/ })).not.toBeInTheDocument()
  })
})
