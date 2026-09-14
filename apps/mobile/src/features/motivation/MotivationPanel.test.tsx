import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MotivationRepository, MotivationState } from '../../db/repositories/MotivationRepository'
import { uiCopy } from '../../locales'
import { MotivationPanel } from './MotivationPanel'

const base: MotivationState = {
  localDate: '2026-09-14', currentStreak: 2, longestStreak: 9, protectionBalance: 0,
  weeklyGoal: { achieved: 1, target: 5, weekStart: '2026-09-14' }, activeToday: false,
  plannedRestToday: false, rescueTime: null, notificationsEnabled: false,
  rescueActive: false, neverMissTwice: false, protectionEligibleDate: null,
}

function panel(state: MotivationState, useProtection = vi.fn(async () => undefined)) {
  const motivation = { state: vi.fn(async () => state), useProtection } as unknown as MotivationRepository
  const action = async () => undefined
  return { motivation, useProtection, element: <MotivationPanel motivation={motivation} refreshKey={0}
    sessionActive={false} onVideo={action} onMiniRoutine={action} onPostpone={action} onRest={action} /> }
}

describe('Today consistency status', () => {
  it('keeps weekly goal and current streak compact without a heading, longest streak, or empty Protection row', async () => {
    const { element } = panel(base)
    render(element)
    const region = await screen.findByRole('region', { name: uiCopy.motivation.title })
    expect(within(region).getByText(uiCopy.motivation.weeklyGoal)).toBeVisible()
    expect(within(region).getByText('1 / 5')).toBeVisible()
    expect(within(region).getByText(uiCopy.motivation.streakCompact)).toBeVisible()
    expect(region.querySelector('.motivation__streak strong')).toHaveTextContent('2 天')
    expect(within(region).queryByText(uiCopy.motivation.title)).not.toBeInTheDocument()
    expect(within(region).queryByText('最长连续')).not.toBeInTheDocument()
    expect(within(region).queryByText(uiCopy.motivation.protection)).not.toBeInTheDocument()
    expect(region.querySelector('.motivation__week-nodes')).toBeInTheDocument()
    expect(region.querySelector('.motivation__growth')).not.toBeInTheDocument()
  })

  it('shows available Protection subtly and makes its explicit eligible action visible', async () => {
    const available = panel({ ...base, protectionBalance: 1 })
    const view = render(available.element)
    const region = await screen.findByRole('region', { name: uiCopy.motivation.title })
    expect(within(region).getByText(uiCopy.motivation.protectionAvailable)).toBeVisible()
    expect(region.querySelector('.motivation__moon')).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: uiCopy.motivation.useProtection })).not.toBeInTheDocument()
    view.unmount()

    const actionable = panel({ ...base, protectionBalance: 1, protectionEligibleDate: '2026-09-13' })
    render(actionable.element)
    const button = await screen.findByRole('button', { name: uiCopy.motivation.useProtection })
    expect(button).toBeVisible()
    expect(actionable.useProtection).not.toHaveBeenCalled()
    await userEvent.setup().click(button)
    await waitFor(() => expect(actionable.useProtection).toHaveBeenCalledWith('2026-09-13'))
  })
})
