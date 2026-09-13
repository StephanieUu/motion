import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Capacitor } from '@capacitor/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChoiceSelect } from './ChoiceSelect'

const nativeBack = vi.hoisted(() => ({ listener: null as (() => void) | null }))
vi.mock('@capacitor/app', () => ({ App: { addListener: async (_event: string, listener: () => void) => {
  nativeBack.listener = listener
  return { remove: async () => { if (nativeBack.listener === listener) nativeBack.listener = null } }
} } }))
afterEach(() => { vi.restoreAllMocks(); nativeBack.listener = null })

describe('ChoiceSelect', () => {
  it('opens a sheet, keeps the current choice, and closes after a new choice or Escape', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ChoiceSelect label="来源" value="ALL" onChange={onChange} options={[
      { value: 'ALL', label: '全部' }, { value: 'QUARK', label: '夸克' },
    ]} />)
    const trigger = screen.getByRole('combobox', { name: /来源/ })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: '来源' })).toBeVisible()
    expect(screen.getByRole('option', { name: '全部' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: '全部' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: '夸克' }))
    expect(onChange).toHaveBeenCalledWith('QUARK')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('uses Android back to dismiss the sheet', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    const user = userEvent.setup()
    render(<ChoiceSelect label="来源" value="ALL" onChange={vi.fn()} options={[
      { value: 'ALL', label: '全部' },
    ]} />)
    await user.click(screen.getByRole('combobox', { name: /来源/ }))
    await waitFor(() => expect(nativeBack.listener).not.toBeNull())
    act(() => nativeBack.listener?.())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
