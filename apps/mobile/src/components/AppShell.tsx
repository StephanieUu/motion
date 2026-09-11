import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

import { AppIcon, type IconName } from './AppIcon'

interface AppShellProps {
  children: ReactNode
}

const tabs: ReadonlyArray<{
  label: string
  path: string
  icon: IconName
  end?: boolean
}> = [
  { label: 'Today', path: '/', icon: 'today', end: true },
  { label: 'Training', path: '/training', icon: 'training' },
  { label: 'Food', path: '/food', icon: 'food' },
  { label: 'Body', path: '/body', icon: 'body' },
  { label: 'Me', path: '/me', icon: 'me' },
]

export function AppShell({ children }: AppShellProps) {
  const [isCoachOpen, setIsCoachOpen] = useState(false)

  return (
    <div className="app-viewport">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <div className="mobile-shell">
        <main id="main-content" className="screen-content">
          {children}
        </main>

        <button
          className="coach-entry"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isCoachOpen}
          onClick={() => setIsCoachOpen(true)}
        >
          <AppIcon name="spark" />
          <span>Coach</span>
        </button>

        <nav className="bottom-nav" aria-label="Primary navigation">
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              className={({ isActive }) =>
                `bottom-nav__item${isActive ? ' is-active' : ''}`
              }
              to={tab.path}
              end={tab.end ?? false}
            >
              <AppIcon name={tab.icon} />
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {isCoachOpen ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setIsCoachOpen(false)
            }
          }}
        >
          <section
            className="coach-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="coach-dialog-title"
          >
            <div className="coach-dialog__mark" aria-hidden="true">
              <AppIcon name="spark" />
            </div>
            <span className="eyebrow">A quiet space to reflect</span>
            <h2 id="coach-dialog-title">Coach is taking shape.</h2>
            <p>
              Your planning companion will live here when coaching becomes available.
            </p>
            <button type="button" onClick={() => setIsCoachOpen(false)}>
              Close
            </button>
          </section>
        </div>
      ) : null}
    </div>
  )
}
