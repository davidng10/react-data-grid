// Canonical public grid contract.

import type { CSSProperties } from "react";
import type { Column } from "./column";
import type { CellCommit, CellCommitFailure } from "./editing";
import type { ColumnId, RowId } from "./ids";
import type { GridSelection } from "./selection";

export interface DataGridProps<T> {
  rows: readonly T[];
  columns: readonly Column<T>[];
  getRowId: (row: T, index: number) => RowId;

  rowHeight?: number;
  overscanRows?: number;
  overscanColumns?: number;

  enableRowSelection?: boolean;
  selectedRowIds?: ReadonlySet<RowId>;
  defaultSelectedRowIds?: ReadonlySet<RowId>;
  onSelectedRowIdsChange?: (rowIds: ReadonlySet<RowId>) => void;
  /** Observes focus, range, and selected rows; it does not control focus or range. */
  onSelectionChange?: (next: GridSelection) => void;

  reorderable?: boolean;
  columnOrder?: readonly ColumnId[];
  defaultColumnOrder?: readonly ColumnId[];
  onColumnOrderChange?: (order: readonly ColumnId[]) => void;

  resizable?: boolean;
  columnWidths?: Readonly<Record<ColumnId, number>>;
  defaultColumnWidths?: Readonly<Record<ColumnId, number>>;
  onColumnWidthsChange?: (widths: Readonly<Record<ColumnId, number>>) => void;

  onCellCommit?: (update: CellCommit<T>) => Promise<void> | void;
  onCellCommitError?: (failure: CellCommitFailure<T>) => void;

  id?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}
