import { Component, type ErrorInfo, type ReactNode } from 'react'

import { logger } from './logger'
import { uiCopy } from '../locales'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  public state: AppErrorBoundaryState = { hasError: false }

  public static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Unhandled render error', error, {
      componentStack: errorInfo.componentStack,
    })
  }

  public render() {
    if (this.state.hasError) {
      return (
        <main className="fatal-error" role="alert">
          <span className="eyebrow">{uiCopy.errors.render.eyebrow}</span>
          <h1>{uiCopy.errors.render.title}</h1>
          <p>{uiCopy.errors.render.description}</p>
          <button type="button" onClick={() => window.location.reload()}>
            {uiCopy.errors.render.reload}
          </button>
        </main>
      )
    }

    return this.props.children
  }
}
