import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { AppIcon, type IconName } from './AppIcon'
import { uiCopy } from '../locales'

interface AppShellProps {
  children: ReactNode
}

const tabs: ReadonlyArray<{
  copyKey: 'today' | 'training' | 'food' | 'body' | 'me'
  path: string
  icon: IconName
  end?: boolean
}> = [
  { copyKey: 'today', path: '/', icon: 'today', end: true },
  { copyKey: 'training', path: '/training', icon: 'training' },
  { copyKey: 'food', path: '/food', icon: 'food' },
  { copyKey: 'body', path: '/body', icon: 'body' },
  { copyKey: 'me', path: '/me', icon: 'me' },
]

export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate()

  return (
    <div className="app-viewport">
      <a className="skip-link" href="#main-content">
        {uiCopy.navigation.skipToContent}
      </a>

      <div className="mobile-shell">
        <main id="main-content" className="screen-content">
          {children}
        </main>

        <button
          className="coach-entry"
          type="button"
          onClick={() => navigate('/coach')}
        >
          <AppIcon name="spark" />
          <span>{uiCopy.coach.entry}</span>
        </button>

        <nav className="bottom-nav" aria-label={uiCopy.navigation.primaryLabel}>
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
              <span>{uiCopy.navigation[tab.copyKey]}</span>
            </NavLink>
          ))}
        </nav>
      </div>

    </div>
  )
}
