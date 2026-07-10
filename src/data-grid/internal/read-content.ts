import type { ReactNode } from "react";
import type { Column, RowId } from "../core/types";

// Custom renderers override the cheap string representation used by ordinary cells.
export function readContent<T>(
  col: Column<T>,
  row: T,
  rowIndex: number,
  rowId: RowId,
): ReactNode {
  const value = col.accessor(row);
  return col.renderRead
    ? col.renderRead({ row, rowId, rowIndex, column: col, value })
    : String(value ?? "");
}
