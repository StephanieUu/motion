import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { TrainingSession } from '@motion/domain'
import type { LibraryWorkout } from '../../db/repositories/WorkoutRepository'
import { uiCopy } from '../../locales'
import { TodayScreen } from '../today/TodayScreen'
import { TrainingPlanScreen } from './TrainingPlanScreen'
import type { ExecutionSnapshot, TrainingExecution } from './trainingExecution'
import type { TodayRecommendations, RecommendationView } from '../today/todayRecommendations'
import type { MotivationRepository, MotivationState } from '../../db/repositories/MotivationRepository'

const { openAiService } = vi.hoisted(() => ({ openAiService: vi.fn() }))
vi.mock('../ai/aiRuntime', () => ({ openAiService }))

const workout: LibraryWorkout = {
  id: 'workout', contentKind: 'FOLLOW_ALONG', title: '拉伸训练', description: null,
  sourceType: 'BILIBILI', sourceUrl: 'https://example.com', durationMinutes: 15,
  primaryActivityTypeId: null, estimatedIntensity: 'LOW', impactLevel: null,
  requiresEquipment: null, hasJumping: null, bodyAreas: [], userVisibility: 'ACTIVE',
  createdAt: '2026-09-13', updatedAt: '2026-09-13', activityTypeName: null,
  userPreference: null, completionCount: 0, lastCompletedAt: null,
}

function snapshot(changes: Partial<ExecutionSnapshot> = {}): ExecutionSnapshot {
  return { plans: [], run: null, runDays: [], currentDay: null, workouts: [workout],
    pendingWorkoutId: workout.id, mainWorkout: workout, session: null, ...changes }
}

function inProgress(workoutId = workout.id): TrainingSession {
  return { id: 'session', localDate: '2026-09-13', startedAt: new Date().toISOString(),
    endedAt: null, durationMinutes: null, workoutContentId: workoutId, activityTypeId: null,
    trainingPlanRunDayId: null, lifecycleStatus: 'IN_PROGRESS', completionStatus: null,
    qualifiesForActiveDay: false }
}

describe('M5 Today recommendations', () => {
  const result: RecommendationView = { id: 'recommendation', localDate: '2026-09-13', status: 'SUGGESTED',
    recommendationSource: 'LIBRARY',
    workout, activityName: null, result: { mode: 'NORMAL', workoutContentId: workout.id,
      activityTypeId: null, score: 20, scoreBreakdown: { duration: 12 },
      reasonCodes: ['MATCH_DURATION'], durationMinutes: 15, intensity: 'LOW', novelty: 'MIXED' } }

  it('shows the four inputs, exactly one result, and accepts without starting a session', async () => {
    const user = userEvent.setup()
    const start = vi.fn()
    const accept = vi.fn(async () => undefined)
    const suggest = vi.fn(async () => result)
    const execution = { load: async () => snapshot({ pendingWorkoutId: null, mainWorkout: null }),
      today: () => '2026-09-13', startWorkout: start } as unknown as TrainingExecution
    const recommendations = { latest: async () => null, suggest, accept } as unknown as TodayRecommendations
    render(<MemoryRouter><TodayScreen execution={execution} recommendations={recommendations} /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: uiCopy.recommendation.libraryEntry }))
    for (const label of [uiCopy.recommendation.mood, uiCopy.recommendation.intensity,
      uiCopy.recommendation.duration, uiCopy.recommendation.novelty]) {
      expect(screen.getByRole('group', { name: label })).toBeVisible()
    }
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    const intensity = within(screen.getByRole('group', { name: uiCopy.recommendation.intensity }))
    expect(intensity.getByRole('button', { name: uiCopy.recommendation.intensities.AUTO })).toHaveAttribute('aria-pressed', 'true')
    const mood = within(screen.getByRole('group', { name: uiCopy.recommendation.mood }))
    await user.click(mood.getByRole('button', { name: uiCopy.recommendation.moods.ENERGETIC }))
    expect(mood.getByRole('button', { name: uiCopy.recommendation.moods.ENERGETIC })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: uiCopy.recommendation.suggest }))
    expect(await screen.findByRole('heading', { name: workout.title! })).toBeVisible()
    expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ mood: 'ENERGETIC', intensity: 'AUTO' }), false,
      undefined)
    expect(screen.getByText(uiCopy.recommendation.reasons.MATCH_DURATION)).toBeVisible()
    expect(screen.queryByText('20')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: uiCopy.recommendation.accept }))
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1))
    expect(start).not.toHaveBeenCalled()
    expect(openAiService).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: uiCopy.recommendation.selected })).toBeDisabled()
  })

  it('shows an ActivityType idea without a library workout and routes to the share loop', async () => {
    const user = userEvent.setup()
    const idea: RecommendationView = { ...result, recommendationSource: 'EXPLORATION',
      workout: null, activityName: '健美操',
      result: { ...result.result, mode: 'EXPLORATION', workoutContentId: null,
        activityTypeId: 'a', reasonCodes: ['NEW_ACTIVITY'] } }
    const findNew = vi.fn(async () => undefined)
    const execution = { load: async () => snapshot({ workouts: [], pendingWorkoutId: null, mainWorkout: null }),
      today: () => '2026-09-13' } as unknown as TrainingExecution
    const suggest = vi.fn(async () => idea)
    const recommendations = { latest: async () => null, suggest,
      findNew } as unknown as TodayRecommendations
    render(<MemoryRouter><TodayScreen execution={execution} recommendations={recommendations} /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: uiCopy.recommendation.activityEntry }))
    expect(await screen.findByRole('heading', { name: '健美操' })).toBeVisible()
    expect(suggest).toHaveBeenCalledWith(expect.anything(), true, undefined)
    const actions = within(screen.getByRole('status'))
    expect(actions.getAllByRole('button').map((button) => button.textContent)).toEqual([
      uiCopy.recommendation.doActivity, uiCopy.recommendation.findNew, uiCopy.recommendation.again])
    expect(screen.queryByRole('button', { name: uiCopy.recommendation.libraryEntry })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: uiCopy.recommendation.findNew }))
    await waitFor(() => expect(findNew).toHaveBeenCalledTimes(1))
    expect(screen.getByText(uiCopy.recommendation.findHint)).toBeVisible()
    expect(screen.queryByText('分享到 Motion')).not.toBeInTheDocument()
  })
  it('selects an ActivityType Free Activity immediately without starting a session', async () => {
    const user = userEvent.setup()
    const freeWorkout: LibraryWorkout = { ...workout, id: 'free', contentKind: 'FREE_ACTIVITY',
      title: '健美操', sourceType: 'MANUAL', sourceUrl: null, durationMinutes: null,
      primaryActivityTypeId: 'a', estimatedIntensity: null }
    const idea: RecommendationView = { ...result, recommendationSource: 'EXPLORATION',
      workout: null, activityName: '健美操', result: { ...result.result, mode: 'EXPLORATION',
        workoutContentId: null, activityTypeId: 'a' } }
    const chosen: RecommendationView = { ...idea, status: 'ACCEPTED', workout: freeWorkout,
      result: { ...idea.result, workoutContentId: freeWorkout.id } }
    let current = snapshot({ run: null, runDays: [], currentDay: null, workouts: [],
      pendingWorkoutId: null, mainWorkout: null })
    const start = vi.fn()
    const execution = { load: async () => current, today: () => '2026-09-13',
      startWorkout: start } as unknown as TrainingExecution
    const chooseActivity = vi.fn(async () => {
      current = snapshot({ run: null, runDays: [], currentDay: null, workouts: [freeWorkout],
        pendingWorkoutId: freeWorkout.id, mainWorkout: freeWorkout, selectionOrigin: 'RECOMMENDATION' })
      return chosen
    })
    const recommendations = { latest: async () => null, suggest: async () => idea,
      chooseActivity } as unknown as TodayRecommendations
    render(<MemoryRouter><TodayScreen execution={execution} recommendations={recommendations} /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: uiCopy.recommendation.activityEntry }))
    await user.click(screen.getByRole('button', { name: uiCopy.recommendation.doActivity }))
    await waitFor(() => expect(chooseActivity).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(document.getElementById('today-workout-title')).toHaveTextContent(freeWorkout.title!))
    expect(screen.getByText(uiCopy.todayProvenance.todayRecommended)).toBeVisible()
    expect(screen.getByRole('button', { name: uiCopy.recommendation.selected })).toBeDisabled()
    expect(start).not.toHaveBeenCalled()
  })

  it('changes ActivityType inspiration without saving the previous suggestion', async () => {
    const user = userEvent.setup()
    const idea: RecommendationView = { ...result, recommendationSource: 'EXPLORATION',
      workout: null, activityName: '健美操', result: { ...result.result, mode: 'EXPLORATION',
        workoutContentId: null, activityTypeId: 'a' } }
    const next = { ...idea, id: 'next', activityName: '户外运动',
      result: { ...idea.result, activityTypeId: 'b' } }
    const suggest = vi.fn().mockResolvedValueOnce(idea).mockResolvedValueOnce(next)
    const chooseActivity = vi.fn()
    const findNew = vi.fn()
    const execution = { load: async () => snapshot({ workouts: [], pendingWorkoutId: null,
      mainWorkout: null }), today: () => '2026-09-13' } as unknown as TrainingExecution
    const recommendations = { latest: async () => null, suggest, chooseActivity,
      findNew } as unknown as TodayRecommendations
    render(<MemoryRouter><TodayScreen execution={execution} recommendations={recommendations} /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: uiCopy.recommendation.activityEntry }))
    await user.click(await screen.findByRole('button', { name: uiCopy.recommendation.again }))
    expect(await screen.findByRole('heading', { name: next.activityName })).toBeVisible()
    expect(suggest).toHaveBeenLastCalledWith(expect.anything(), true, 'a')
    expect(chooseActivity).not.toHaveBeenCalled()
    expect(findNew).not.toHaveBeenCalled()
  })
})

describe('Today provenance and current plan display', () => {
  const plannedDay = { id: 'day', trainingPlanRunId: 'run', trainingPlanDayId: 'plan-day',
    scheduledLocalDate: '2026-09-13', originalScheduledLocalDate: '2026-09-13',
    status: 'SCHEDULED' as const, executionKind: 'NONE' as const, planEquivalence: null,
    rescheduleCount: 0, dayIndex: 1, title: null, isRestDay: false, primaryWorkoutId: workout.id }
  const run = { id: 'run', trainingPlanId: 'plan', startedOn: '2026-09-13',
    status: 'ACTIVE' as const, currentDayIndex: 1, pausedAt: null }
  const plan = { id: 'plan', title: '三天计划', sourceType: 'MANUAL' as const,
    plannedDays: 3, createdAt: '2026-09-13' }
  const replacement = { ...workout, id: 'replacement', title: '替换训练' }

  it('shows original planned workout and clear current-plan counts', async () => {
    const rest = { ...plannedDay, id: 'rest', dayIndex: 2, scheduledLocalDate: '2026-09-14',
      isRestDay: true, primaryWorkoutId: null }
    const last = { ...plannedDay, id: 'last', dayIndex: 3, scheduledLocalDate: '2026-09-15' }
    const current = snapshot({ run, plans: [plan], runDays: [plannedDay, rest, last],
      currentDay: plannedDay, pendingWorkoutId: null, selectionOrigin: null })
    const service = { load: async () => current, today: () => '2026-09-13' } as unknown as TrainingExecution
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    expect(await screen.findByText('计划训练 · 第1天')).toBeVisible()
    expect(screen.getByText('计划 · 第 1 / 3 天')).toBeVisible()
    expect(screen.getByText('已完成 0 / 2 次训练')).toBeVisible()
    expect(screen.getByText(plan.title)).toBeVisible()
    const segments = within(screen.getByRole('list', { name: uiCopy.execution.progress })).getAllByRole('listitem')
    expect(segments).toHaveLength(3)
    expect(segments.map((segment) => segment.dataset.kind)).toEqual(['PENDING', 'REST', 'PENDING'])
    expect(segments.map((segment) => segment.dataset.current)).toEqual(['true', 'false', 'false'])
    expect(segments.every((segment) => segment.querySelector('.today-plan__node-mark'))).toBe(true)
    expect(screen.getByRole('list', { name: uiCopy.execution.progress }).querySelector('.today-plan__growth'))
      .toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: '第2天 · 休息日' })).toHaveAttribute('data-kind', 'REST')
  })

  it('places current plan progress before compact weekly and streak status', async () => {
    const current = snapshot({ run, plans: [plan], runDays: [plannedDay], currentDay: plannedDay,
      completedActivities: [{ session: { ...inProgress(), lifecycleStatus: 'COMPLETED',
        completionStatus: 'COMPLETE', endedAt: new Date().toISOString(), durationMinutes: 6,
        trainingPlanRunDayId: plannedDay.id }, origin: 'PLAN', recommendationSource: null }] })
    const service = { load: async () => current, today: () => '2026-09-13' } as unknown as TrainingExecution
    const state: MotivationState = { localDate: '2026-09-13', currentStreak: 2, longestStreak: 8,
      protectionBalance: 0, weeklyGoal: { achieved: 1, target: 5, weekStart: '2026-09-11' },
      activeToday: false, plannedRestToday: false, rescueTime: null, notificationsEnabled: false,
      rescueActive: false, neverMissTwice: false, protectionEligibleDate: null }
    const motivation = { state: async () => state } as unknown as MotivationRepository
    render(<MemoryRouter><TodayScreen execution={service} motivation={motivation} /></MemoryRouter>)
    const planRegion = await screen.findByRole('region', { name: uiCopy.currentPlanProgress.title })
    const activity = screen.getByRole('region', { name: uiCopy.todayActivity.title })
    const consistency = await screen.findByRole('region', { name: uiCopy.motivation.title })
    expect(document.querySelector('.workout-card')!.compareDocumentPosition(activity)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(activity.compareDocumentPosition(planRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(planRegion.compareDocumentPosition(consistency) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(consistency).getByText('1 / 5')).toBeVisible()
    expect(consistency.querySelector('.motivation__streak strong')).toHaveTextContent('2 天')
  })

  it('marks the current rest day separately from completed and pending training days', async () => {
    const completed = { ...plannedDay, id: 'completed', status: 'COMPLETED' as const,
      planEquivalence: 'FULL' as const }
    const rest = { ...plannedDay, id: 'rest', dayIndex: 2, isRestDay: true,
      primaryWorkoutId: null, scheduledLocalDate: '2026-09-13' }
    const pending = { ...plannedDay, id: 'pending', dayIndex: 3,
      scheduledLocalDate: '2026-09-14' }
    const current = snapshot({ run, plans: [plan], runDays: [completed, rest, pending],
      currentDay: rest, pendingWorkoutId: null, mainWorkout: null })
    const service = { load: async () => current, today: () => '2026-09-13' } as unknown as TrainingExecution
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    const segments = within(await screen.findByRole('list', { name: uiCopy.execution.progress }))
      .getAllByRole('listitem')
    expect(segments.map((segment) => [segment.dataset.kind, segment.dataset.current])).toEqual([
      ['COMPLETED', 'false'], ['REST', 'true'], ['PENDING', 'false']])
    expect(segments[1]?.getAttribute('aria-label')).toContain(uiCopy.navigation.today)
    expect(segments[1]?.querySelector('.today-plan__node-mark')).toBeInTheDocument()
  })

  it('shows recommended replacement and original plan workout separately', async () => {
    const current = snapshot({ run, plans: [plan], runDays: [plannedDay], currentDay: plannedDay,
      workouts: [workout, replacement], mainWorkout: replacement, pendingWorkoutId: replacement.id,
      selectionOrigin: 'RECOMMENDATION' })
    const service = { load: async () => current, today: () => '2026-09-13' } as unknown as TrainingExecution
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    expect(await screen.findByText(uiCopy.todayProvenance.recommendedReplacement)).toBeVisible()
    expect(screen.getByText(`原计划：${workout.title}`)).toBeVisible()
    expect(screen.getByRole('heading', { name: replacement.title! })).toBeVisible()
    expect(screen.getByRole('list', { name: uiCopy.execution.progress })
      .querySelector('.today-plan__branch[data-branch="REPLACEMENT"]')).toBeInTheDocument()
  })

  it('shows a no-plan recommendation and manual selection with distinct labels', async () => {
    let current = snapshot({ run: null, runDays: [], currentDay: null,
      mainWorkout: workout, pendingWorkoutId: workout.id, selectionOrigin: 'RECOMMENDATION' })
    const service = { load: async () => current, today: () => '2026-09-13' } as unknown as TrainingExecution
    const view = render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    expect(await screen.findByText(uiCopy.todayProvenance.todayRecommended)).toBeVisible()
    view.unmount()
    current = { ...current, selectionOrigin: 'MANUAL' }
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    expect(await screen.findByText(uiCopy.todayProvenance.manual)).toBeVisible()
  })

  it('labels a rest-day extra workout and omits the plan-equivalence prompt', async () => {
    const user = userEvent.setup()
    const rest = { ...plannedDay, isRestDay: true, primaryWorkoutId: null }
    const active = { ...inProgress(), trainingPlanRunDayId: null }
    const current = snapshot({ run, plans: [plan], runDays: [rest], currentDay: rest,
      session: active, selectionOrigin: 'MANUAL' })
    const service = { load: async () => current, today: () => '2026-09-13',
      completeWorkout: vi.fn(async () => active) } as unknown as TrainingExecution
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    expect(await screen.findByText(uiCopy.todayProvenance.restExtra)).toBeVisible()
    expect(screen.getByText('原计划：休息')).toBeVisible()
    const planPath = screen.getByRole('list', { name: uiCopy.execution.progress })
    expect(within(planPath).getByRole('listitem')).toHaveAttribute('data-kind', 'REST')
    expect(planPath.querySelector('.today-plan__branch[data-branch="REST_EXTRA"]')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: uiCopy.execution.complete }))
    await user.click(screen.getByRole('button', { name: uiCopy.execution.finishedYes }))
    expect(screen.queryByLabelText(uiCopy.execution.equivalence)).not.toBeInTheDocument()
  })
})

describe('M4 screens', () => {
  it('shows no empty Today activity section and keeps the manual library route in discovery', async () => {
    const service = { load: async () => snapshot({ pendingWorkoutId: null, mainWorkout: null }),
      today: () => '2026-09-13' } as unknown as TrainingExecution
    const recommendations = { latest: async () => null } as unknown as TodayRecommendations
    render(<MemoryRouter><TodayScreen execution={service} recommendations={recommendations} /></MemoryRouter>)
    await screen.findByRole('button', { name: uiCopy.recommendation.libraryEntry })
    expect(screen.queryByRole('region', { name: uiCopy.todayActivity.title })).not.toBeInTheDocument()
    const discovery = screen.getByRole('region', { name: uiCopy.recommendation.sectionTitle })
    const routes = discovery.querySelector('.today-recommendation__routes')
    expect(routes).not.toBeNull()
    expect(within(routes as HTMLElement).getByText(uiCopy.recommendation.discoveryLabel)).toBeVisible()
    expect(within(routes as HTMLElement).getByRole('button', { name: uiCopy.recommendation.libraryEntry })).toBeVisible()
    const secondary = routes!.querySelector('.today-recommendation__secondary') as HTMLElement
    expect(within(secondary).getByRole('button', { name: uiCopy.recommendation.activityEntry })).toBeVisible()
    expect(within(secondary).getByRole('link', { name: uiCopy.execution.selectInLibrary }))
      .toHaveAttribute('href', '/training')
    expect(discovery.querySelector('.today-recommendation__art')).toBeInTheDocument()
  })

  it('starts Rescue Mini Routine through the same execution method used by Training quick start', async () => {
    const active = { ...inProgress('mini'), miniRoutineVersionId: 'mini-version' }
    const miniWorkout = { ...workout, id: 'mini', contentKind: 'MINI_ROUTINE' as const }
    let current = snapshot({ mainWorkout: null, pendingWorkoutId: null })
    const startMiniRoutine = vi.fn(async () => {
      current = snapshot({ workouts: [miniWorkout], mainWorkout: miniWorkout, session: active,
        miniRoutine: { id: 'mini-version', workoutContentId: 'mini', durationMinutes: 4,
          items: [{ id: 'item', name: '动作 1', instructions: '说明', seconds: 60,
            phase: 'MAIN' as const }] } })
      return active
    })
    const service = { load: async () => current, today: () => '2026-09-13',
      startMiniRoutine } as unknown as TrainingExecution
    const state: MotivationState = { localDate: '2026-09-13', currentStreak: 0, longestStreak: 0,
      protectionBalance: 0, weeklyGoal: { achieved: 0, target: 5, weekStart: '2026-09-11' },
      activeToday: false, plannedRestToday: false, rescueTime: 1080, notificationsEnabled: true,
      rescueActive: true, neverMissTwice: false, protectionEligibleDate: null }
    const motivation = { state: async () => state } as unknown as MotivationRepository
    render(<MemoryRouter><TodayScreen execution={service} motivation={motivation} /></MemoryRouter>)
    await userEvent.setup().click(await screen.findByRole('button', { name: uiCopy.motivation.miniRoutine }))
    expect(startMiniRoutine).toHaveBeenCalledOnce()
    expect(await screen.findByRole('heading', { name: '动作 1' })).toBeVisible()
  })

  it('keeps multiple completed activities visible on Today after feedback is saved and reloaded', async () => {
    const user = userEvent.setup()
    const completed = { ...inProgress(), lifecycleStatus: 'COMPLETED' as const,
      completionStatus: 'COMPLETE' as const, endedAt: new Date().toISOString(), durationMinutes: 8 }
    const freeWorkout = { ...workout, id: 'free', title: '快走', contentKind: 'FREE_ACTIVITY' as const,
      sourceType: 'MANUAL' as const, durationMinutes: 25 }
    let current = snapshot({ session: inProgress() })
    const completeWorkout = vi.fn(async () => { current = snapshot({ session: null, workouts: [workout, freeWorkout],
      completedActivities: [
        { session: { ...completed, workoutContentId: workout.id }, origin: 'EXISTING_LIBRARY',
          recommendationSource: null },
        { session: { ...completed, id: 'free-session', workoutContentId: freeWorkout.id,
          durationMinutes: 3.9166666666666665 }, origin: 'FREE_ACTIVITY', recommendationSource: null },
      ] }); return completed })
    const saveFeedback = vi.fn(async () => undefined)
    const service = { load: async () => current, today: () => '2026-09-13',
      completeWorkout, saveFeedback } as unknown as TrainingExecution
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    await screen.findByRole('heading', { name: uiCopy.execution.inProgress })
    await user.click(screen.getByRole('button', { name: uiCopy.execution.complete }))
    await user.click(screen.getByRole('button', { name: uiCopy.execution.finishedYes }))
    await user.click(screen.getByRole('button', { name: uiCopy.execution.saveWorkout }))
    await user.click(screen.getByRole('button', { name: uiCopy.execution.easy }))
    await user.click(screen.getByRole('button', { name: uiCopy.execution.saveFeedback }))
    await waitFor(() => expect(saveFeedback).toHaveBeenCalledTimes(1))
    const activity = screen.getByRole('region', { name: uiCopy.todayActivity.title })
    expect(within(activity).getByText('拉伸训练')).toBeVisible()
    expect(within(activity).getByText('快走')).toBeVisible()
    expect(within(activity).getByText('约 4 分钟')).toBeVisible()
    expect(activity).toHaveTextContent('今天已运动 2 次')
    expect(screen.queryByText(uiCopy.execution.feedbackSaved)).not.toBeInTheDocument()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(within(activity).getByText('快走')).toBeVisible())
    expect(screen.queryByText(uiCopy.execution.feedbackSaved)).not.toBeInTheDocument()
    visibility.mockRestore()
  })

  it('confirms a Mini Routine exit and shows a local completion state before returning to Today', async () => {
    const user = userEvent.setup()
    const miniWorkout = { ...workout, id: 'mini', title: '轻量动作', contentKind: 'MINI_ROUTINE' as const,
      sourceType: 'APP_BUILTIN' as const, durationMinutes: 3.9166666666666665 }
    const active = { ...inProgress('mini'), miniRoutineVersionId: 'mini-version' }
    const items = Array.from({ length: 5 }, (_, index) => ({ id: `item-${index}`, name: `动作 ${index + 1}`,
      instructions: `说明 ${index + 1}`, seconds: 45,
      phase: (index === 0 ? 'WARM_UP' : index === 4 ? 'COOL_DOWN' : 'MAIN') as 'WARM_UP' | 'COOL_DOWN' | 'MAIN' }))
    const version = { id: 'mini-version', workoutContentId: 'mini', items,
      durationMinutes: 3.9166666666666665 }
    let current = snapshot({ workouts: [miniWorkout], mainWorkout: miniWorkout, session: active,
      miniRoutine: version })
    const abandonWorkout = vi.fn(async () => active)
    const completed = { ...active, lifecycleStatus: 'COMPLETED' as const,
      completionStatus: 'COMPLETE' as const, endedAt: new Date().toISOString(), durationMinutes: 3.9166666666666665 }
    const completeMiniRoutine = vi.fn(async () => { current = snapshot({ workouts: [miniWorkout],
      mainWorkout: null, pendingWorkoutId: null, session: null, miniRoutine: null,
      completedActivities: [{ session: completed, origin: 'RESCUE', recommendationSource: null }] });
      return completed })
    const service = { load: async () => current, today: () => '2026-09-13',
      abandonWorkout, completeMiniRoutine } as unknown as TrainingExecution
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '动作 1' })).toBeVisible()
    expect(screen.getByText('低强度 · 小练习')).toBeVisible()
    expect(screen.queryByText('Motion 内置')).not.toBeInTheDocument()
    expect(screen.queryByText('3.9166666666666665')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: uiCopy.motivation.routineAbandon }))
    expect(screen.getByText(uiCopy.motivation.routineExitQuestion)).toBeVisible()
    expect(abandonWorkout).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: uiCopy.motivation.routineKeepGoing }))
    expect(screen.getByRole('heading', { name: '动作 1' })).toBeVisible()
    for (let index = 0; index < 4; index++)
      await user.click(screen.getByRole('button', { name: uiCopy.motivation.routineDone }))
    expect(screen.getByRole('heading', { name: '动作 5' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.motivation.routineFinish }))
    expect(completeMiniRoutine).toHaveBeenCalledWith(active.id, true)
    expect(await screen.findByRole('heading', { name: uiCopy.motivation.routineComplete })).toBeVisible()
    expect(screen.getByText('5 / 5 · 约 4 分钟')).toBeVisible()
    expect(screen.queryByRole('region', { name: uiCopy.todayActivity.title })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: uiCopy.motivation.routineReturn }))
    expect(await screen.findByRole('region', { name: uiCopy.todayActivity.title })).toHaveTextContent('轻量动作')
  })

  it('does not abandon a Mini Routine until exit is confirmed', async () => {
    const user = userEvent.setup()
    const active = { ...inProgress(), miniRoutineVersionId: 'mini-version' }
    let current = snapshot({ session: active, miniRoutine: { id: 'mini-version',
      workoutContentId: workout.id, durationMinutes: 1,
      items: [{ id: 'step', name: '动作', instructions: '说明', seconds: 60, phase: 'WARM_UP' }] } })
    const abandonWorkout = vi.fn(async () => { current = snapshot({ session: null }); return active })
    const service = { load: async () => current, today: () => '2026-09-13', abandonWorkout } as unknown as TrainingExecution
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    await screen.findByRole('button', { name: uiCopy.motivation.routineAbandon })
    await user.click(screen.getByRole('button', { name: uiCopy.motivation.routineAbandon }))
    expect(abandonWorkout).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: uiCopy.motivation.routineConfirmExit }))
    await waitFor(() => expect(abandonWorkout).toHaveBeenCalledWith(active.id))
    expect(screen.queryByText(uiCopy.motivation.routineExitQuestion)).not.toBeInTheDocument()
  })

  it('starts only on tap, then records completion and permits skipping feedback', async () => {
    const user = userEvent.setup()
    let current = snapshot()
    const start = vi.fn(async () => {
      const session = inProgress()
      current = snapshot({ session })
      return session
    })
    const complete = vi.fn(async () => { current = snapshot({ pendingWorkoutId: null, mainWorkout: null });
      return {} as TrainingSession })
    const service = { load: async () => current, today: () => '2026-09-13',
      startWorkout: start, completeWorkout: complete } as unknown as TrainingExecution
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: workout.title! })).toBeVisible()
    expect(start).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: uiCopy.execution.start }))
    expect(await screen.findByRole('heading', { name: uiCopy.execution.inProgress })).toBeVisible()
    expect(start).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText(`${uiCopy.execution.duration} · ${uiCopy.execution.minutes}`)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: uiCopy.execution.openWorkout }))
      .toHaveAttribute('href', new URL(workout.sourceUrl!).toString())
    await user.click(screen.getByRole('button', { name: uiCopy.execution.complete }))
    const card = screen.getByRole('heading', { name: uiCopy.execution.inProgress }).closest('.workout-card')!
    expect(within(card as HTMLElement).getByRole('heading', { name: uiCopy.execution.finishQuestion })).toBeVisible()
    expect(complete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: uiCopy.execution.notYet }))
    expect(screen.getByRole('heading', { name: uiCopy.execution.inProgress })).toBeVisible()
    expect(within(card as HTMLElement).queryByRole('heading', { name: uiCopy.execution.finishQuestion }))
      .not.toBeInTheDocument()
    expect(within(card as HTMLElement).getByRole('button', { name: uiCopy.execution.complete })).toBeVisible()
    expect(complete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: uiCopy.execution.complete }))
    await user.click(screen.getByRole('button', { name: uiCopy.execution.finishedYes }))
    expect(within(card as HTMLElement).getByRole('heading', { name: uiCopy.execution.confirmWorkout })).toBeVisible()
    for (const label of [uiCopy.execution.easy, uiCopy.execution.justRight, uiCopy.execution.hard])
      expect(within(card as HTMLElement).getByRole('button', { name: label })).toBeVisible()
    await user.click(within(card as HTMLElement).getByRole('button', { name: uiCopy.execution.notYet }))
    expect(within(card as HTMLElement).getByRole('button', { name: uiCopy.execution.complete })).toBeVisible()
    expect(complete).not.toHaveBeenCalled()
    await user.click(within(card as HTMLElement).getByRole('button', { name: uiCopy.execution.complete }))
    await user.click(within(card as HTMLElement).getByRole('button', { name: uiCopy.execution.finishedYes }))
    await user.clear(screen.getByLabelText(`${uiCopy.execution.duration} · ${uiCopy.execution.minutes}`))
    await user.type(screen.getByLabelText(`${uiCopy.execution.duration} · ${uiCopy.execution.minutes}`), '12')
    await user.click(screen.getByRole('button', { name: uiCopy.execution.saveWorkout }))
    expect(complete).toHaveBeenCalledWith('session', 12, 'COMPLETE', undefined)
    expect(await within(card as HTMLElement).findByRole('heading', { name: uiCopy.execution.feedback })).toBeVisible()
    for (const label of [uiCopy.execution.easy, uiCopy.execution.justRight, uiCopy.execution.hard])
      expect(within(card as HTMLElement).getByRole('button', { name: label })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.execution.skipFeedback }))
    expect(screen.queryByRole('heading', { name: uiCopy.execution.feedback })).not.toBeInTheDocument()
  })

  it('shows a completed Rest-day extra with its recorded duration below the primary Rest state', async () => {
    const rest = { id: 'rest-day', trainingPlanRunId: 'run', trainingPlanDayId: 'plan-day',
      scheduledLocalDate: '2026-09-13', originalScheduledLocalDate: '2026-09-13',
      status: 'SCHEDULED' as const, executionKind: 'NONE' as const, planEquivalence: null,
      rescheduleCount: 0, dayIndex: 1, title: null, isRestDay: true, primaryWorkoutId: null }
    const completed = { ...inProgress(), lifecycleStatus: 'COMPLETED' as const,
      completionStatus: 'COMPLETE' as const, endedAt: new Date().toISOString(), durationMinutes: 1 }
    const extra = { ...workout, title: 'anna hiit', durationMinutes: 20 }
    const current = snapshot({ runDays: [rest], currentDay: rest,
      workouts: [extra], pendingWorkoutId: null, mainWorkout: null, session: null,
      completedActivities: [{ session: { ...completed, workoutContentId: extra.id },
        origin: 'EXISTING_LIBRARY', recommendationSource: null }] })
    const service = { load: async () => current, today: () => '2026-09-13' } as unknown as TrainingExecution
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    const card = (await screen.findByRole('heading', { name: uiCopy.execution.rest })).closest('.workout-card')!
    const activity = screen.getByRole('region', { name: uiCopy.todayActivity.title })
    expect(within(activity).getByText(uiCopy.todayProvenance.restExtra)).toBeVisible()
    expect(within(activity).getByText('anna hiit')).toBeVisible()
    expect(within(activity).getByText('1 分钟')).toBeVisible()
    expect(within(activity).queryByText('20 分钟')).not.toBeInTheDocument()
    expect(within(card as HTMLElement).queryByText('anna hiit')).not.toBeInTheDocument()
  })

  it('prefills completion from elapsed session time rather than the workout estimate', async () => {
    const user = userEvent.setup()
    const estimated = { ...workout, durationMinutes: 20 }
    const active = { ...inProgress(), startedAt: new Date(Date.now() - 60_000).toISOString() }
    let current = snapshot({ workouts: [estimated], mainWorkout: estimated, session: active })
    const complete = vi.fn(async () => { current = snapshot({ session: null }); return active })
    const service = { load: async () => current, today: () => '2026-09-13',
      completeWorkout: complete } as unknown as TrainingExecution
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    await screen.findByRole('heading', { name: uiCopy.execution.inProgress })
    await user.click(screen.getByRole('button', { name: uiCopy.execution.complete }))
    await user.click(screen.getByRole('button', { name: uiCopy.execution.finishedYes }))
    expect(screen.getByLabelText(`${uiCopy.execution.duration} · ${uiCopy.execution.minutes}`))
      .toHaveValue(1)
    await user.click(screen.getByRole('button', { name: uiCopy.execution.saveWorkout }))
    expect(complete).toHaveBeenCalledWith('session', 1, 'COMPLETE', undefined)
  })

  it('hides missing planned metadata while keeping source visible and actual duration separate', async () => {
    const missing = { ...workout, durationMinutes: null, estimatedIntensity: null, sourceType: 'YOUTUBE' as const }
    const current = snapshot({ workouts: [missing], mainWorkout: missing, session: inProgress() })
    const service = { load: async () => current, today: () => '2026-09-13' } as unknown as TrainingExecution
    const { container } = render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    await screen.findByRole('heading', { name: uiCopy.execution.inProgress })
    const meta = container.querySelector('.workout-card__meta')!
    expect(within(meta as HTMLElement).getByText(uiCopy.training.sources.YOUTUBE)).toBeVisible()
    expect(within(meta as HTMLElement).queryByText(uiCopy.training.unknown)).not.toBeInTheDocument()
    expect(meta.children).toHaveLength(1)
    expect(screen.queryByLabelText(`${uiCopy.execution.duration} · ${uiCopy.execution.minutes}`)).not.toBeInTheDocument()
  })

  it('does not ask plan credit for the originally planned workout', async () => {
    const user = userEvent.setup()
    const session = { ...inProgress(), trainingPlanRunDayId: 'day' }
    const day = { id: 'day', trainingPlanRunId: 'run', trainingPlanDayId: 'plan-day',
      scheduledLocalDate: '2026-09-13', originalScheduledLocalDate: '2026-09-13',
      status: 'IN_PROGRESS' as const, executionKind: 'NONE' as const, planEquivalence: null,
      rescheduleCount: 0, dayIndex: 1, title: null, isRestDay: false, primaryWorkoutId: workout.id }
    const current = snapshot({ session, currentDay: day, runDays: [day] })
    const complete = vi.fn(async () => session)
    const service = { load: async () => current, today: () => '2026-09-13',
      completeWorkout: complete } as unknown as TrainingExecution
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    await screen.findByRole('heading', { name: uiCopy.execution.inProgress })
    await user.click(screen.getByRole('button', { name: uiCopy.execution.complete }))
    await user.click(screen.getByRole('button', { name: uiCopy.execution.finishedYes }))
    expect(screen.queryByLabelText(uiCopy.execution.equivalence)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: uiCopy.execution.saveWorkout }))
    expect(complete).toHaveBeenCalledWith('session', expect.any(Number), 'COMPLETE', undefined)
  })

  it.each([['FULL', 'full'], ['PARTIAL', 'partial'], ['NONE', 'none']] as const)(
    'maps replacement choice %s without exposing domain terms', async (value, copyKey) => {
      const user = userEvent.setup()
      const session = { ...inProgress(), trainingPlanRunDayId: 'day' }
      const day = { id: 'day', trainingPlanRunId: 'run', trainingPlanDayId: 'plan-day',
        scheduledLocalDate: '2026-09-13', originalScheduledLocalDate: '2026-09-13',
        status: 'IN_PROGRESS' as const, executionKind: 'NONE' as const, planEquivalence: null,
        rescheduleCount: 0, dayIndex: 1, title: null, isRestDay: false, primaryWorkoutId: 'original' }
      const current = snapshot({ session, currentDay: day, runDays: [day] })
      const complete = vi.fn(async () => session)
      const service = { load: async () => current, today: () => '2026-09-13',
        completeWorkout: complete } as unknown as TrainingExecution
      render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
      await screen.findByRole('heading', { name: uiCopy.execution.inProgress })
      await user.click(screen.getByRole('button', { name: uiCopy.execution.complete }))
      await user.click(screen.getByRole('button', { name: uiCopy.execution.finishedYes }))
      const select = screen.getByRole('combobox', { name: new RegExp(uiCopy.execution.equivalence) })
      expect(select).toBeVisible()
      expect(screen.queryByText('与原计划的关系')).not.toBeInTheDocument()
      await user.click(select)
      const option = screen.getByRole('option', { name: uiCopy.execution[copyKey] })
      expect(option).toHaveAttribute('data-value', value)
      await user.click(option)
      expect(select).toHaveTextContent(uiCopy.execution[copyKey])
      await user.click(screen.getByRole('button', { name: uiCopy.execution.saveWorkout }))
      expect(complete).toHaveBeenCalledWith('session', expect.any(Number), 'COMPLETE', value)
    })

  it('restores the same in-progress session after returning from an external link', async () => {
    const current = snapshot({ session: inProgress() })
    const load = vi.fn(async () => current)
    const service = { load, today: () => '2026-09-13' } as unknown as TrainingExecution
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    await screen.findByRole('heading', { name: uiCopy.execution.inProgress })
    expect(screen.getByRole('link', { name: uiCopy.execution.openWorkout }))
      .toHaveAttribute('href', new URL(workout.sourceUrl!).toString())
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('heading', { name: uiCopy.execution.inProgress })).toBeVisible()
    expect(screen.getByRole('button', { name: uiCopy.execution.complete })).toBeVisible()
    visibility.mockRestore()
  })

  it('keeps abandoning available without completing the session', async () => {
    const user = userEvent.setup()
    let current = snapshot({ session: inProgress() })
    const abandon = vi.fn(async () => { current = snapshot({ session: null }); return inProgress() })
    const complete = vi.fn(async () => inProgress())
    const service = { load: async () => current, today: () => '2026-09-13',
      abandonWorkout: abandon, completeWorkout: complete } as unknown as TrainingExecution
    render(<MemoryRouter><TodayScreen execution={service} /></MemoryRouter>)
    await screen.findByRole('heading', { name: uiCopy.execution.inProgress })
    await user.click(screen.getByRole('button', { name: uiCopy.execution.complete }))
    const card = screen.getByRole('heading', { name: uiCopy.execution.inProgress }).closest('.workout-card')!
    await user.click(within(card as HTMLElement).getByRole('button', { name: uiCopy.execution.abandon }))
    expect(abandon).toHaveBeenCalledWith('session')
    expect(complete).not.toHaveBeenCalled()
    expect(within(card as HTMLElement).queryByRole('heading', { name: uiCopy.execution.finishQuestion }))
      .not.toBeInTheDocument()
  })

  it('creates a plan from a workout and exposes Start in the saved-plan list', async () => {
    const user = userEvent.setup()
    let current = snapshot({ pendingWorkoutId: null, mainWorkout: null })
    const createPlan = vi.fn(async () => {
      current = snapshot({ pendingWorkoutId: null, mainWorkout: null,
        plans: [{ id: 'plan', title: '七天计划', sourceType: 'MANUAL', plannedDays: 1, createdAt: '2026-09-13' }] })
      return current.plans[0]!
    })
    const startPlan = vi.fn(async () => 'run')
    const service = { load: async () => current, today: () => '2026-09-13',
      createPlan, startPlan } as unknown as TrainingExecution
    render(<MemoryRouter><TrainingPlanScreen execution={service} /></MemoryRouter>)
    await screen.findByRole('heading', { name: uiCopy.plan.title, level: 1 })
    await user.click(screen.getByRole('button', { name: uiCopy.plan.create }))
    await user.type(screen.getByLabelText(uiCopy.plan.planName), '七天计划')
    await user.click(screen.getByRole('combobox', { name: new RegExp(uiCopy.plan.workout) }))
    await user.click(screen.getByRole('option', { name: workout.title! }))
    await user.click(screen.getByRole('button', { name: uiCopy.plan.save }))
    expect(createPlan).toHaveBeenCalledWith('七天计划', [{ dayIndex: 1, isRestDay: false,
      items: [{ workoutContentId: workout.id, role: 'PRIMARY' }] }])
    await user.click(await screen.findByRole('button', { name: uiCopy.plan.start }))
    expect(startPlan).toHaveBeenCalledWith('plan')
  })

  it('returns from the plan to the tab that opened it', async () => {
    const service = { load: async () => snapshot({ pendingWorkoutId: null, mainWorkout: null }),
      today: () => '2026-09-13' } as unknown as TrainingExecution
    render(<MemoryRouter initialEntries={[{ pathname: '/training/plan', state: { from: '/' } }]}>
      <TrainingPlanScreen execution={service} />
    </MemoryRouter>)
    const back = await screen.findByRole('link', { name: uiCopy.plan.backToday })
    expect(back).toHaveAttribute('href', '/')
  })
})
