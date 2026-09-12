import type { ReactNode } from 'react'
import { uiCopy } from '../locales'

interface SectionPlaceholderProps {
  eyebrow: string
  title: string
  description: string
  motif: ReactNode
}

export function SectionPlaceholder({
  eyebrow,
  title,
  description,
  motif,
}: SectionPlaceholderProps) {
  return (
    <section className="placeholder-screen">
      <header className="placeholder-screen__header">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <div className="placeholder-art" aria-hidden="true">
        {motif}
      </div>
      <div className="placeholder-note">
        <span className="placeholder-note__line" />
        <span>{uiCopy.placeholders.note}</span>
      </div>
    </section>
  )
}
