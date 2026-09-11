import { Component, type ErrorInfo, type ReactNode } from 'react'

import { logger } from './logger'

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
          <span className="eyebrow">Motion paused</span>
          <h1>Something went wrong.</h1>
          <p>Your local data is still on this device. Reload Motion to try again.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload Motion
          </button>
        </main>
      )
    }

    return this.props.children
  }
}
