import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { uiCopy } from '../locales'
import type { TrainingLibrary } from '../features/training/trainingLibrary'

const emptyLibrary: TrainingLibrary = {
  load: async () => ({ workouts: [], activityTypes: [], pendingTodayWorkoutId: null }),
  addUrl: async () => { throw new Error('Unexpected add') },
  addFreeActivity: async () => { throw new Error('Unexpected add') },
  update: async () => { throw new Error('Unexpected update') },
  setPreference: async () => { throw new Error('Unexpected preference change') },
  setVisibility: async () => { throw new Error('Unexpected visibility change') },
  remove: async () => { throw new Error('Unexpected remove') },
  importShare: async () => { throw new Error('Unexpected import') },
  selectToday: async () => { throw new Error('Unexpected selection') },
}

describe('application shell', () => {
  it('shows Today and the five primary destinations', async () => {
    render(<MemoryRouter><App trainingLibrary={emptyLibrary} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: uiCopy.navigation.today })).toBeVisible()
    expect(await screen.findByRole('heading', { name: uiCopy.execution.unavailable })).toBeVisible()
    for (const label of Object.values(uiCopy.navigation).slice(0, 5)) {
      expect(screen.getByRole('link', { name: label })).toBeVisible()
    }
    expect(screen.getByRole('navigation', { name: uiCopy.navigation.primaryLabel })).toBeVisible()
  })

  it('switches tabs and opens Coach', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><App trainingLibrary={emptyLibrary} /></MemoryRouter>)
    await user.click(screen.getByRole('link', { name: uiCopy.navigation.food }))
    expect(screen.getByRole('heading', { name: uiCopy.placeholders.food.title })).toBeVisible()
    await user.click(screen.getByRole('link', { name: uiCopy.navigation.training }))
    expect(await screen.findByRole('heading', { name: uiCopy.training.title })).toBeVisible()
    expect(screen.getByRole('link', { name: uiCopy.plan.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.coach.entry }))
    expect(screen.getByRole('dialog', { name: uiCopy.coach.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: uiCopy.coach.close }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
