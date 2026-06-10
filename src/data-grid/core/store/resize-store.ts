// Column resize store (DECISIONS.md D1, D12).
//
// The fifth D1 plain-TS observable store (after grid/edit/pending/drag): zero React imports, one
// immutable `ResizeState` snapshot behind subscribe/getSnapshot (for `useSyncExternalStore`). Only
// the per-zone `ResizeOverlay` leaf subscribes — `DataGrid` and the windowed body never do, so a
// header-edge drag (and every pointermove that moves the guide line) re-renders only that leaf,
// never the body (D1/D6). The width is committed once on pointer-up (commit-on-release) via
// `onColumnResize`; during the drag the store carries ONLY the guide-line position.
//
// Like the drag store, this holds only interaction state; the width math (clamp to min/max) lives
// in the gesture hook over the column's static constraints. Resize is single-column, so there's no
// "source zone" filtering beyond the overlay drawing its own zone's line.

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
