// Selection model (DECISIONS.md D6).
//
// Three independent selections, any combination allowed. The range is stored as two
// coordinates and drawn as overlay rectangles — never as a per-cell `selected` flag, so a
// 1,000 x 100,000 selection stays a single object.

import type { CellCoord, RowId } from './ids'

export interface CellRange {
  anchor: CellCoord
  focus: CellCoord
}

export interface GridSelection {
  /** Drives keyboard navigation. */
  focusedCell: CellCoord | null
  /** Active rectangular range (overlay-drawn), or null. */
  range: CellRange | null
  /** Checkbox row selection, keyed by stable RowId. */
  selectedRows: Set<RowId>
}

export const EMPTY_SELECTION: GridSelection = {
  focusedCell: null,
  range: null,
  selectedRows: new Set(),
}
