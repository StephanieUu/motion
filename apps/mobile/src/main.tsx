import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './app/App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import { logger } from './app/logger'
import { initializeNativeStorage } from './platform/storage/initializeNativeStorage'
import { defaultLocale, uiCopy } from './locales'
import './styles/index.css'

document.documentElement.dataset.theme = 'light'
document.documentElement.lang = defaultLocale

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
      <span className="eyebrow">{uiCopy.errors.storage.eyebrow}</span>
      <h1>{uiCopy.errors.storage.title}</h1>
      <p>{uiCopy.errors.storage.description}</p>
    </main>,
  )
})
