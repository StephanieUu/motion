import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { uiCopy } from '../locales'

export interface ChoiceOption { value: string; label: string }

export function ChoiceSelect({ label, value, options, onChange, disabled = false }: {
  label: string; value: string; options: readonly ChoiceOption[]
  onChange: (value: string) => void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const selectedLabel = options.find((option) => option.value === value)?.label ?? options[0]?.label ?? ''

  useEffect(() => {
    if (!open) return
    const triggerElement = trigger.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const selected = document.getElementById(`${id}-options`)?.querySelector<HTMLElement>('[aria-selected="true"]')
    selected?.focus()
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
      if (event.key !== 'Tab') return
      const buttons = Array.from(document.getElementById(`${id}-sheet`)
        ?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
      const first = buttons[0]
      const last = buttons.at(-1)
      if (event.shiftKey && document.activeElement === first && last) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last && first) {
        event.preventDefault(); first.focus()
      }
    }
    window.addEventListener('keydown', handleKeys)
    let disposed = false
    let listener: PluginListenerHandle | undefined
    if (Capacitor.isNativePlatform()) void CapacitorApp.addListener('backButton', () => setOpen(false))
      .then((handle) => { if (disposed) void handle.remove(); else listener = handle })
    return () => {
      disposed = true
      window.removeEventListener('keydown', handleKeys)
      if (listener) void listener.remove()
      document.body.style.overflow = previousOverflow
      triggerElement?.focus()
    }
  }, [open, id])

  return <div className="choice-field">
    <span className="choice-field__label" id={`${id}-label`}>{label}</span>
    <button type="button" className="choice-field__trigger" role="combobox" ref={trigger}
      aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-haspopup="listbox"
      aria-controls={open ? `${id}-options` : undefined} disabled={disabled} onClick={() => setOpen(true)}>
      <span id={`${id}-value`}>{selectedLabel}</span><span className="choice-field__chevron" aria-hidden="true" />
    </button>
    {open ? createPortal(<div className="choice-sheet__backdrop" data-choice-sheet="open"
      onClick={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <section className="choice-sheet" id={`${id}-sheet`} role="dialog" aria-modal="true" aria-labelledby={`${id}-sheet-title`}>
        <div className="choice-sheet__header"><h2 id={`${id}-sheet-title`}>{label}</h2>
          <button type="button" className="choice-sheet__close" aria-label={uiCopy.coach.close}
            onClick={() => setOpen(false)}>×</button>
        </div>
        <div className="choice-sheet__options" id={`${id}-options`} role="listbox" aria-label={label}>
          {options.map((option) => <button type="button" role="option" key={option.value}
            data-value={option.value} aria-selected={value === option.value}
            onClick={() => { onChange(option.value); setOpen(false) }}>{option.label}</button>)}
        </div>
      </section>
    </div>, document.body) : null}
  </div>
}
