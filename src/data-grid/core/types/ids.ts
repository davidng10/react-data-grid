// Layout uses row indices; persistent state uses stable row and column ids.

export type RowId = string | number;
export type ColumnId = string;

/** Canonical cell address. Note the asymmetry: row by index, column by stable id. */
export interface CellCoord {
  rowIndex: number;
  columnId: ColumnId;
}

/** Stable per-cell key for overlay/edit-status maps (keyed by RowId, survives reorder). */
export type CellKey = `${RowId}:${ColumnId}`;

export function cellKey(rowId: RowId, columnId: ColumnId): CellKey {
  return `${rowId}:${columnId}`;
}
