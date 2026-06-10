// Setup for the jsdom ("dom") test project — registers jest-dom matchers, RTL cleanup, and the
// browser primitives jsdom lacks but the grid relies on. The grid is measurement-driven, but its
// per-column geometry comes from the offsets arrays (props), not per-element layout, so tests only
// need to mock the SCROLL CONTAINER's rect/size (done per-test) plus these globals.

import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => cleanup())

type Globalish = Record<string, unknown>

// TanStack Virtual observes the scroll element via ResizeObserver — jsdom has none.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as Globalish).ResizeObserver = ResizeObserver
}

// The drag/selection auto-scroll ticks schedule rAF; jsdom may not provide it.
if (!('requestAnimationFrame' in globalThis)) {
  ;(globalThis as Globalish).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number
  ;(globalThis as Globalish).cancelAnimationFrame = (id: number) => clearTimeout(id)
}

// jsdom lacks PointerEvent — synthesize from MouseEvent so clientX/clientY/button carry over.
if (!('PointerEvent' in globalThis)) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
    }
  }
  ;(globalThis as Globalish).PointerEvent = PointerEventPolyfill
}

// Pointer capture is a no-op in jsdom; the grid calls these during a drag.
for (const m of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'] as const) {
  if (!(m in Element.prototype)) {
    ;(Element.prototype as unknown as Record<string, unknown>)[m] = () => {}
  }
}
