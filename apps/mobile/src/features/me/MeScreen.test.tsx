import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MotivationRepository, MotivationState } from '../../db/repositories/MotivationRepository'
import { rescueNotifications } from '../../platform/notifications/rescueNotifications'
import { uiCopy } from '../../locales'
import { MeScreen } from './MeScreen'

vi.mock('../../platform/notifications/rescueNotifications', () => ({
  rescueNotifications: { requestPermission: vi.fn(async () => true), synchronize: vi.fn(async () => undefined) },
}))

const base: MotivationState = {
  localDate: '2026-09-14', currentStreak: 0, longestStreak: 0, protectionBalance: 0,
  weeklyGoal: { achieved: 0, target: 5, weekStart: '2026-09-14' }, activeToday: false,
  plannedRestToday: false, rescueTime: 18 * 60 + 30, notificationsEnabled: false,
  rescueActive: false, neverMissTwice: false, protectionEligibleDate: null,
}

function settingsRepository() {
  let preference = { rescueTime: base.rescueTime, notificationsEnabled: base.notificationsEnabled }
  const repository = {
    state: vi.fn(async () => ({ ...base, ...preference })),
    configureRescue: vi.fn(async (rescueTime: number | null, notificationsEnabled: boolean) => {
      preference = { rescueTime, notificationsEnabled }
    }),
  } as unknown as MotivationRepository
  return repository
}

function renderMe(repository: MotivationRepository) {
  return render(<MemoryRouter><MeScreen motivation={repository} /></MemoryRouter>)
}

beforeEach(() => { vi.clearAllMocks() })

describe('Me reminder settings', () => {
  it('moves persisted reminder controls to Me and synchronizes the existing adapter', async () => {
    const user = userEvent.setup()
    const repository = settingsRepository()
    renderMe(repository)
    expect(await screen.findByRole('heading', { name: uiCopy.me.remindersTitle })).toBeVisible()
    expect(screen.getByLabelText(uiCopy.motivation.rescueTime)).toHaveValue('18:30')
    fireEvent.change(screen.getByLabelText(uiCopy.motivation.rescueTime), { target: { value: '19:15' } })
    await user.click(screen.getByRole('checkbox', { name: uiCopy.motivation.notifications }))
    await user.click(screen.getByRole('button', { name: uiCopy.motivation.saveTime }))
    await waitFor(() => expect(repository.configureRescue).toHaveBeenCalledWith(19 * 60 + 15, true))
    expect(rescueNotifications.requestPermission).toHaveBeenCalledTimes(1)
    expect(rescueNotifications.synchronize).toHaveBeenCalledWith(repository)
    expect(await screen.findByText(uiCopy.me.reminderSaved)).toBeVisible()
  })

  it('keeps the reminder time when notification permission is denied', async () => {
    vi.mocked(rescueNotifications.requestPermission).mockResolvedValueOnce(false)
    const user = userEvent.setup()
    const repository = settingsRepository()
    renderMe(repository)
    await screen.findByRole('heading', { name: uiCopy.me.remindersTitle })
    await user.click(screen.getByRole('checkbox', { name: uiCopy.motivation.notifications }))
    await user.click(screen.getByRole('button', { name: uiCopy.motivation.saveTime }))
    await waitFor(() => expect(repository.configureRescue).toHaveBeenCalledWith(18 * 60 + 30, false))
    expect(screen.getByRole('checkbox', { name: uiCopy.motivation.notifications })).not.toBeChecked()
    expect(await screen.findByText(uiCopy.motivation.permissionDenied)).toBeVisible()
  })

  it('rechecks permission when a previously enabled reminder is saved after Android revokes access', async () => {
    vi.mocked(rescueNotifications.requestPermission).mockResolvedValueOnce(false)
    const user = userEvent.setup()
    const repository = settingsRepository()
    await repository.configureRescue(18 * 60 + 30, true)
    renderMe(repository)
    await screen.findByRole('heading', { name: uiCopy.me.remindersTitle })
    await user.click(screen.getByRole('button', { name: uiCopy.motivation.saveTime }))
    await waitFor(() => expect(repository.configureRescue).toHaveBeenLastCalledWith(18 * 60 + 30, false))
    expect(screen.getByRole('checkbox', { name: uiCopy.motivation.notifications })).not.toBeChecked()
    expect(await screen.findByText(uiCopy.motivation.permissionDenied)).toBeVisible()
  })

  it('opens AI settings through client-side routing', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/me']}><Routes>
      <Route path="/me" element={<MeScreen motivation={settingsRepository()} />} />
      <Route path="/me/ai" element={<h1>AI 与隐私</h1>} />
    </Routes></MemoryRouter>)
    await user.click(await screen.findByRole('link', { name: /AI 与隐私/ }))
    expect(await screen.findByRole('heading', { name: 'AI 与隐私' })).toBeVisible()
  })
})
