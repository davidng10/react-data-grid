import type { ReactNode } from "react";
import type { Column, RowId } from "../core/types";

// Custom renderers override the cheap string representation used by ordinary cells.
export function readContent<T>(
  col: Column<T>,
  row: T,
  rowIndex: number,
  rowId: RowId,
  width: number,
  height: number
): ReactNode {
  const value = col.accessor(row);
  return col.renderCell
    ? col.renderCell({
        row,
        rowId,
        rowIndex,
        column: col,
        columnId: col.id,
        value,
        width,
        height,
      })
    : String(value ?? "");
}
