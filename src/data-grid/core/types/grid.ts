// Public grid props (DECISIONS.md D7, D8, R2, R3, R4).
//
// This is the top-level contract a consumer passes. Selection and column order are optionally
// controlled: omit the value + handler for uncontrolled behavior, or supply both to control.

import type { CSSProperties, ReactNode } from 'react'
import type { Column } from './column'
import type { CellCommit, CellCommitFailure } from './editing'
import type { ColumnId, RowId } from './ids'
import type { GridSelection } from './selection'

/** Sizing (R2). Fluid fills the parent (ResizeObserver); fixed is explicit px. */
export type GridSize =
  | { mode: 'fluid' }
  | { mode: 'fixed'; width: number; height: number }

/** Per-part className hooks for the headless shell (D7). Each part also emits data-* states. */
export interface GridClassNames {
  root?: string
  header?: string
  headerCell?: string
  body?: string
  row?: string
  cell?: string
}

export interface ExpandedRowContext<T> {
  row: T
  rowId: RowId
}

export interface GridProps<T> {
  // Data (D3).
  rows: T[]
  columns: Column<T>[]
  getRowId: (row: T, index: number) => RowId

  // Layout (D8 / R2).
  /** Uniform base row height in px (D8). */
  rowHeight?: number
  size?: GridSize

  // Expandable rows (R1). Separate entity from base rows; fixed height for now.
  expandedRowHeight?: number
  renderExpanded?: (ctx: ExpandedRowContext<T>) => ReactNode

  // Selection (D6) — optionally controlled.
  selection?: GridSelection
  onSelectionChange?: (next: GridSelection) => void

  // Editing (R4) — fallback when a column has no own onCommit.
  onCellCommit?: (update: CellCommit<T>) => Promise<void> | void
  onCellCommitError?: (failure: CellCommitFailure<T>) => void

  // Column order (R3) — controlled; no internal order state.
  columnOrder?: ColumnId[]
  onColumnOrderChange?: (order: ColumnId[]) => void

  // Column resize (D12) — on by default, UNCONTROLLED: `column.width` is the base/initial width and
  // the grid owns in-session resizes, so resize works with no wiring. `onColumnResize` fires for
  // optional persistence. Controlled widths + reset (a `columnWidths` prop) are deferred.
  enableColumnResize?: boolean
  onColumnResize?: (columnId: ColumnId, width: number) => void

  // Styling (D7).
  className?: string
  style?: CSSProperties
  classNames?: GridClassNames
}
