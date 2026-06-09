// Identity & coordinate model (DECISIONS.md D2).
//
// The rule: virtualization math uses indices; persistence (selection, edits, expansion) uses
// stable ids. Row *index* is layout-only and not stable across sort/filter/insert. Column
// *order* changes but column *identity* does not — so columns are keyed by id, rows by index
// for layout and by RowId for persistence.

export type RowId = string | number
export type ColumnId = string

/** Canonical cell address. Note the asymmetry: row by index, column by stable id. */
export interface CellCoord {
  rowIndex: number
  columnId: ColumnId
}

/** Stable per-cell key for overlay/edit-status maps (keyed by RowId, survives reorder). */
export type CellKey = `${RowId}:${ColumnId}`

export function cellKey(rowId: RowId, columnId: ColumnId): CellKey {
  return `${rowId}:${columnId}`
}
