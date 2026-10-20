import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Agentation } from 'agentation'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles/index.css'
import { initLive } from './state/live'

void initLive() // no backend = the Phase 1 mock path keeps working

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
    {/* Visual feedback toolbar: development only, never in the production build */}
    {import.meta.env.DEV && <Agentation />}
  </StrictMode>,
)
