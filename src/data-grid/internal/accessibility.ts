import type { RowId } from "../core/types";

export function gridCellId(
  gridId: string,
  rowId: RowId | null,
  columnId: string | null
) {
  return `${gridId}-${encodeURIComponent(JSON.stringify([rowId === null ? "header" : typeof rowId, rowId, columnId]))}`;
}
