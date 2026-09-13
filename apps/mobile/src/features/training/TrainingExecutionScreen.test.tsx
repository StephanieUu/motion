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

describe('M4 screens', () => {
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
    expect(screen.getByRole('heading', { name: uiCopy.execution.finishQuestion })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.execution.notYet }))
    expect(screen.getByRole('heading', { name: uiCopy.execution.inProgress })).toBeVisible()
    expect(complete).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: uiCopy.execution.complete }))
    await user.click(screen.getByRole('button', { name: uiCopy.execution.finishedYes }))
    await user.clear(screen.getByLabelText(`${uiCopy.execution.duration} · ${uiCopy.execution.minutes}`))
    await user.type(screen.getByLabelText(`${uiCopy.execution.duration} · ${uiCopy.execution.minutes}`), '12')
    await user.click(screen.getByRole('button', { name: uiCopy.execution.saveWorkout }))
    expect(complete).toHaveBeenCalledWith('session', 12, 'COMPLETE', undefined)
    expect(await screen.findByRole('heading', { name: uiCopy.execution.feedback })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.execution.skipFeedback }))
    expect(screen.queryByRole('heading', { name: uiCopy.execution.feedback })).not.toBeInTheDocument()
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
      const select = screen.getByLabelText(uiCopy.execution.equivalence)
      expect(select).toBeVisible()
      expect(screen.queryByText('与原计划的关系')).not.toBeInTheDocument()
      await user.selectOptions(select, value)
      expect(screen.getByRole('option', { name: uiCopy.execution[copyKey] })).toHaveAttribute('value', value)
      expect((select as HTMLSelectElement).value).toBe(value)
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
    await user.click(screen.getByRole('button', { name: uiCopy.execution.abandon }))
    expect(abandon).toHaveBeenCalledWith('session')
    expect(complete).not.toHaveBeenCalled()
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
    await user.selectOptions(screen.getByLabelText(uiCopy.plan.workout), workout.id)
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
