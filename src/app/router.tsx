import { createBrowserRouter } from 'react-router'
import { Home } from '../playground/pages/Home'
import { DomPlayground } from '../playground/pages/DomPlayground'

// Phase 0 router. As shells land they get their own routes:
//   /dom        — the DOM shell (active; the committed architecture)
//   /css-grid   — deferred comparison shell (DECISIONS.md D5)
//   /canvas     — deferred "future spike" (DECISIONS.md D0)
export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/dom', element: <DomPlayground /> },
])
