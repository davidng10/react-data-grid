// Plain TypeScript selection store. Only selection UI subscribes, keeping focus and drag updates
// off the windowed cell body.

import type { CellCoord, RowId } from '../types/ids'
import type { CellRange, GridSelection } from '../types/selection'

export interface GridStore {
  getSnapshot: () => GridSelection
  subscribe: (listener: () => void) => () => void

  /** Move the cursor to a single cell and drop any range (plain click / arrow). */
  focusCell: (cell: CellCoord) => void
  /**
   * Extend the range to `cell`, anchoring on the existing range's anchor (so a drag or a
   * shift-sequence keeps its origin) or, if there is no range yet, on the current focused cell.
   * Used by drag-select, shift+click, and shift+arrow.
   */
  extendTo: (cell: CellCoord) => void
  /** Drop the range but keep the focused cell. */
  clearRange: () => void
  /** Toggle one row's checkbox selection. */
  toggleRow: (rowId: RowId) => void
  /** Bulk add/remove a set of rows (select-all / clear-all over the current row set). */
  setRowsSelected: (rowIds: RowId[], selected: boolean) => void
  /** Reset focus, range, and row selection. */
  reset: () => void
}

function freshState(): GridSelection {
  return { focusedCell: null, range: null, selectedRows: new Set() }
}

export function createGridStore(initial?: Partial<GridSelection>): GridStore {
  let state: GridSelection = { ...freshState(), ...initial }
  const listeners = new Set<() => void>()

  const set = (next: GridSelection) => {
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

    focusCell(cell) {
      set({ ...state, focusedCell: cell, range: null })
    },

    extendTo(cell) {
      const anchor = state.range?.anchor ?? state.focusedCell ?? cell
      const range: CellRange = { anchor, focus: cell }
      set({ ...state, range, focusedCell: cell })
    },

    clearRange() {
      if (state.range === null) return
      set({ ...state, range: null })
    },

    toggleRow(rowId) {
      const selectedRows = new Set(state.selectedRows)
      if (selectedRows.has(rowId)) selectedRows.delete(rowId)
      else selectedRows.add(rowId)
      set({ ...state, selectedRows })
    },

    setRowsSelected(rowIds, selected) {
      const selectedRows = new Set(state.selectedRows)
      if (selected) for (const id of rowIds) selectedRows.add(id)
      else for (const id of rowIds) selectedRows.delete(id)
      set({ ...state, selectedRows })
    },

    reset() {
      set(freshState())
    },
  }
}
