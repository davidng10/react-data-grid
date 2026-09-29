// Cell focus, range selection, and checkbox row selection are independent.

import type { CellCoord, RowId } from "./ids";

export interface CellRange {
  anchor: CellCoord;
  focus: CellCoord;
}

export interface GridSelection {
  /** Drives keyboard navigation. */
  focusedCell: CellCoord | null;
  /** Active rectangular range (overlay-drawn), or null. */
  range: CellRange | null;
  /** Checkbox row selection, keyed by stable RowId. */
  selectedRows: Set<RowId>;
}

export const EMPTY_SELECTION: GridSelection = {
  focusedCell: null,
  range: null,
  selectedRows: new Set(),
};
