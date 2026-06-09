// Column schema & cell contract (DECISIONS.md D3, D4, D5, D7).
//
// React note: the only `react` imports here are TYPES (`ReactNode`, `CSSProperties`) — erased
// at compile time, so they don't violate D1's "no React runtime in the core". The pure
// state/geometry modules (P2+) import no React at all.

import type { CSSProperties, ReactNode } from 'react'
import type { CellCommit, EditStatus } from './editing'
import type { ColumnId, RowId } from './ids'

/** Built-in cell kinds. Undefined => text (value coerced to string). Anything else is custom. */
export type CellType = 'text' | 'select'

/** Frozen zone (D5). Omit => center (horizontally scrolling) zone. */
export type FrozenZone = 'left' | 'right'

export interface SelectOption {
  label: string
  value: string
}

/** Context passed to read-mode / overflow render hooks and predicates. */
export interface CellRenderContext<T> {
  row: T
  rowId: RowId
  rowIndex: number
  column: Column<T>
  /** Result of `column.accessor(row)` (D3). */
  value: unknown
}

/** Context passed to the edit-mode hook (D4). The editor owns its input; the grid owns commit. */
export interface CellEditContext<T> extends CellRenderContext<T> {
  draft: unknown
  setDraft: (next: unknown) => void
  commit: () => void
  cancel: () => void
  status: EditStatus
  error?: unknown
}

/**
 * A column definition over row objects of type `T`.
 *
 * Cell render contract (D4) — three read states + edit:
 *   renderRead     cheap static markup for the resting cell (ellipsis-truncated)
 *   renderOverflow content shown in the click-popover when the cell overflows (defaults to
 *                  the full value); set `overflow: false` to disable the popover affordance
 *   renderEdit     the heavy editor (e.g. AntD), mounted ONLY for the active cell
 *
 * Styling (D7) — `className`/`style` accept a value or a function of cell context; the shell
 * additionally emits `data-*` state attributes (data-selected, data-editing, data-frozen,
 * data-overflow) for plain-CSS targeting.
 */
export interface Column<T> {
  id: ColumnId
  name: string

  /** Push-model value access (D3). */
  accessor: (row: T) => unknown

  // Layout (D5). Width undefined => flex remainder (R2).
  width?: number
  minWidth?: number
  maxWidth?: number
  frozen?: FrozenZone

  // Type + editing (D4 / R4).
  type?: CellType
  options?: SelectOption[]
  editable?: boolean | ((ctx: CellRenderContext<T>) => boolean)
  /** Coerce/validate the draft before commit (e.g. string -> number). */
  parseValue?: (next: unknown, ctx: CellEditContext<T>) => unknown
  /** Per-column commit. Grid-level `onCellCommit` is the fallback (R4). */
  onCommit?: (update: CellCommit<T>) => Promise<void> | void

  // Render hooks (D4 / D7). All optional — defaults coerce `value` to a truncated string.
  renderRead?: (ctx: CellRenderContext<T>) => ReactNode
  renderOverflow?: (ctx: CellRenderContext<T>) => ReactNode
  renderEdit?: (ctx: CellEditContext<T>) => ReactNode
  /** Enable click-to-popover when content overflows. Default true. */
  overflow?: boolean

  // Styling hooks (D7).
  className?: string | ((ctx: CellRenderContext<T>) => string)
  style?: CSSProperties | ((ctx: CellRenderContext<T>) => CSSProperties)
  headerClassName?: string
  headerStyle?: CSSProperties
}
