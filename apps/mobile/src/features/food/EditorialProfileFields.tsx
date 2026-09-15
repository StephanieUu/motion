import { useId, useMemo, useState } from 'react'
import { birthDateParts, canonicalBirthDate, daysInBirthMonth, twoDateDigits,
  type BirthDateParts } from './birthDatePicker'

interface EditorialNumberFieldProps {
  label: string
  ariaLabel: string
  value: string
  unit: string
  scale: readonly string[]
  step?: string
  onChange: (value: string) => void
}

export function EditorialNumberField({ label, ariaLabel, value, unit, scale, step = '1',
  onChange }: EditorialNumberFieldProps) {
  const id = useId()
  const minimum = Number(scale[0])
  const maximum = Number(scale.at(-1))
  const parsedValue = Number(value)
  const sliderValue = Number.isFinite(parsedValue) && parsedValue >= minimum && parsedValue <= maximum
    ? parsedValue : (minimum + maximum) / 2
  const decimalPlaces = step.includes('.') ? step.split('.')[1]!.length : 0

  return <div className="editorial-number"><label className="editorial-number__label" htmlFor={id}>{label}</label>
    <span className="editorial-number__value"><input id={id} aria-label={ariaLabel} type="number" min="1" step={step}
      inputMode="decimal" value={value} placeholder="—" onChange={(event) => onChange(event.target.value)} />
      <small>{unit}</small></span>
    <span className="editorial-number__ruler">
      <input aria-label={`${ariaLabel}刻度`} type="range" min={minimum} max={maximum} step={step}
        value={sliderValue} onChange={(event) => onChange(event.currentTarget.valueAsNumber.toFixed(decimalPlaces))} />
      <span aria-hidden="true">{scale.map((mark) => <small key={mark}>{mark}</small>)}</span></span>
  </div>
}

export function EditorialDateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [parts, setParts] = useState<BirthDateParts>(() => birthDateParts(value))
  const [invalid, setInvalid] = useState(false)
  const today = new Date()
  const currentYear = today.getFullYear()
  const years = useMemo(() => Array.from({ length: 121 }, (_, index) => currentYear - index), [currentYear])
  const selectedYear = Number(parts.year) || currentYear
  const selectedMonth = Number(parts.month) || 1
  const dayCount = daysInBirthMonth(selectedYear, selectedMonth)

  function update(key: keyof BirthDateParts, nextValue: string) {
    const next = { ...parts, [key]: nextValue }
    if ((key === 'year' || key === 'month') && next.day) {
      const maximum = daysInBirthMonth(Number(next.year) || today.getFullYear(), Number(next.month) || 1)
      if (Number(next.day) > maximum) next.day = String(maximum)
    }
    setParts(next)
    const complete = Boolean(next.year && next.month && next.day)
    const canonical = complete ? canonicalBirthDate(next, today) : null
    setInvalid(complete && canonical === null)
    onChange(canonical ?? '')
  }

  return <div className="editorial-date"><span>出生日期</span>
    <button id={id} className="editorial-date__control" type="button" aria-label="出生日期" aria-expanded={open}
      aria-controls={`${id}-picker`} onClick={() => setOpen((shown) => !shown)}>
      <output>{value ? value.replaceAll('-', ' / ') : '年 / 月 / 日'}</output><i aria-hidden="true">⌄</i></button>
    {open ? <div id={`${id}-picker`} className="editorial-date__picker" role="group" aria-label="选择出生日期">
      <label><span>年</span><select aria-label="出生年份" value={parts.year}
        onChange={(event) => update('year', event.target.value)}><option value="">年</option>
        {years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
      <label><span>月</span><select aria-label="出生月份" value={parts.month}
        onChange={(event) => update('month', event.target.value)}><option value="">月</option>
        {Array.from({ length: 12 }, (_, index) => index + 1).map((month) =>
          <option key={month} value={month}>{twoDateDigits(month)}</option>)}</select></label>
      <label><span>日</span><select aria-label="出生日期" value={parts.day}
        onChange={(event) => update('day', event.target.value)}><option value="">日</option>
        {Array.from({ length: dayCount }, (_, index) => index + 1).map((day) =>
          <option key={day} value={day}>{twoDateDigits(day)}</option>)}</select></label>
      {invalid ? <p role="alert">请选择有效的过去日期</p> : null}
      <button type="button" onClick={() => setOpen(false)}>完成</button>
    </div> : null}</div>
}
