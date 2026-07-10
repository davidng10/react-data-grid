// Stores the active resize guide position. Only `ResizeOverlay` subscribes; width calculation and
// commit behavior live in the resize gesture hook.

import type { ColumnId } from '../types/ids'
import type { Zone } from '../selection/geometry'

export type ResizeState =
  | { status: 'idle' }
  | {
      status: 'resizing'
      /** The column whose right edge is being dragged. */
      columnId: ColumnId
      /** The column's zone — the overlay draws the guide line only in this zone. */
      zone: Zone
      /** Zone-local x of the prospective right edge (the guide line). */
      indicatorX: number
    }

const IDLE: ResizeState = { status: 'idle' }

export interface ResizeStore {
  getSnapshot: () => ResizeState
  subscribe: (listener: () => void) => () => void

  /** Begin a resize (called on pointerdown over a column's resize handle). */
  start: (args: { columnId: ColumnId; zone: Zone; indicatorX: number }) => void
  /**
   * Move the guide line as the pointer moves. No-op while idle; skips the `set` (so the overlay
   * doesn't re-render) when the indicator is unchanged — mirrors the drag store's same-target guard.
   */
  setIndicator: (indicatorX: number) => void
  /** End the resize (commit or cancel) -> idle. */
  end: () => void
}

export function createResizeStore(): ResizeStore {
  let state: ResizeState = IDLE
  const listeners = new Set<() => void>()

  const set = (next: ResizeState) => {
    state = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    start({ columnId, zone, indicatorX }) {
      set({ status: 'resizing', columnId, zone, indicatorX })
    },

    setIndicator(indicatorX) {
      if (state.status !== 'resizing') return
      if (state.indicatorX === indicatorX) return
      set({ ...state, indicatorX })
    },

    end() {
      if (state.status !== 'idle') set(IDLE)
    },
  }
}
