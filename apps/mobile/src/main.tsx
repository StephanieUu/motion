import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './app/App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import { logger } from './app/logger'
import { initializeNativeStorage } from './platform/storage/initializeNativeStorage'
import './styles/index.css'

document.documentElement.dataset.theme = 'light'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Motion root element was not found')
}

const root = createRoot(rootElement)

void initializeNativeStorage().then(() => {
  root.render(
    <StrictMode>
      <AppErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppErrorBoundary>
    </StrictMode>,
  )
}).catch((error: unknown) => {
  logger.error('Native SQLite initialization failed', error)
  root.render(
    <main className="fatal-error" role="alert">
      <span className="eyebrow">Storage needs attention</span>
      <h1>Your data is still on this device.</h1>
      <p>Motion could not open or upgrade its local database. Close the app and try again. If this continues, keep the app installed and export device logs for support.</p>
    </main>,
  )
})
