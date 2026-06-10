import type { ReactNode } from "react";
import type { Column, RowId } from "../core/types";

// Read-mode content for a body cell: a column's `renderRead` (D4) if present — where custom cell UI
// like an actions button lives — else the value coerced to a truncated string (the cheap default for
// the thousands of resting cells).
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
