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

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)

void initializeNativeStorage().catch((error: unknown) => {
  logger.error('Native SQLite initialization failed', error)
})
