import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { EditorialDateField, EditorialNumberField } from './EditorialProfileFields'
import { canonicalBirthDate } from './birthDatePicker'

function Example() {
  const [value, setValue] = useState('70')
  return <EditorialNumberField label="当前体重" ariaLabel="当前体重" value={value} unit="kg" step="0.1"
    scale={['50', '60', '70', '80', '90']} onChange={setValue} />
}

describe('EditorialNumberField', () => {
  it('keeps the draggable ruler and typed number synchronized', async () => {
    const user = userEvent.setup()
    render(<Example />)

    const ruler = screen.getByRole('slider', { name: '当前体重刻度' })
    fireEvent.change(ruler, { target: { value: '74.5' } })
    expect(screen.getByRole('spinbutton', { name: '当前体重' })).toHaveValue(74.5)

    const number = screen.getByRole('spinbutton', { name: '当前体重' })
    await user.clear(number)
    await user.type(number, '68.2')
    expect(ruler).toHaveValue('68.2')
  })
})

function DateExample() {
  const [value, setValue] = useState('')
  return <><EditorialDateField value={value} onChange={setValue} /><output data-testid="canonical-date">{value}</output></>
}

describe('EditorialDateField', () => {
  it('selects an adult birth date without opening a calendar grid', async () => {
    const user = userEvent.setup()
    render(<DateExample />)

    await user.click(screen.getByRole('button', { name: '出生日期' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '出生年份' }), '1999')
    await user.selectOptions(screen.getByRole('combobox', { name: '出生月份' }), '2')
    await user.selectOptions(screen.getByRole('combobox', { name: '出生日期' }), '25')

    expect(screen.getByTestId('canonical-date')).toHaveTextContent('1999-02-25')
    expect(screen.getByRole('button', { name: '出生日期' })).toHaveTextContent('1999 / 02 / 25')
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })

  it('accepts leap day only in a leap year and rejects future dates', () => {
    expect(canonicalBirthDate({ year: '2000', month: '2', day: '29' }, new Date(2026, 8, 15)))
      .toBe('2000-02-29')
    expect(canonicalBirthDate({ year: '2001', month: '2', day: '29' }, new Date(2026, 8, 15))).toBeNull()
    expect(canonicalBirthDate({ year: '2026', month: '9', day: '16' }, new Date(2026, 8, 15))).toBeNull()
  })
})
