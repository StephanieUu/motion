import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { App } from './App'

describe('M0 application shell', () => {
  it('renders the Today mock and all five primary destinations', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Good morning.' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Full-body reset' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '8 day streak' })).toBeVisible()

    for (const label of ['Today', 'Training', 'Food', 'Body', 'Me']) {
      expect(screen.getByRole('link', { name: label })).toBeVisible()
    }
  })

  it('switches tabs and opens the global Coach placeholder', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('link', { name: 'Food' }))
    expect(screen.getByRole('heading', { name: 'Nourish the day.' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Coach' }))
    expect(screen.getByRole('dialog', { name: 'Coach is taking shape.' })).toBeVisible()
  })
})
