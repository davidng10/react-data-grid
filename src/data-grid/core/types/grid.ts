// Additional grid contracts.

import type { CSSProperties, ReactNode } from 'react'
import type { Column } from './column'
import type { CellCommit, CellCommitFailure } from './editing'
import type { ColumnId, RowId } from './ids'
import type { GridSelection } from './selection'

/** Fluid fills the parent; fixed uses explicit pixel dimensions. */
export type GridSize =
  | { mode: 'fluid' }
  | { mode: 'fixed'; width: number; height: number }

/** Class-name hooks for grid parts. */
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
  // Data
  rows: T[]
  columns: Column<T>[]
  getRowId: (row: T, index: number) => RowId

  // Layout
  /** Uniform row height in pixels. */
  rowHeight?: number
  size?: GridSize

  // Expanded rows
  expandedRowHeight?: number
  renderExpanded?: (ctx: ExpandedRowContext<T>) => ReactNode

  // Selection
  selection?: GridSelection
  onSelectionChange?: (next: GridSelection) => void

  // Editing
  onCellCommit?: (update: CellCommit<T>) => Promise<void> | void
  onCellCommitError?: (failure: CellCommitFailure<T>) => void

  // Controlled column order
  columnOrder?: ColumnId[]
  onColumnOrderChange?: (order: ColumnId[]) => void

  // Column resize
  enableColumnResize?: boolean
  onColumnResize?: (columnId: ColumnId, width: number) => void

  // Styling
  className?: string
  style?: CSSProperties
  classNames?: GridClassNames
}
