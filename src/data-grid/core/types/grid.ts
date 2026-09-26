// Canonical public grid contract.

import type { CSSProperties, ReactNode } from "react";
import type { Column } from "./column";
import type { CellCommit, CellCommitFailure } from "./editing";
import type { ColumnId, RowId } from "./ids";
import type { GridSelection } from "./selection";

export interface DataGridProps<T> {
  /** null/undefined means no result is available; [] is a completed empty result. */
  rows: readonly T[] | null | undefined;
  /** Application-owned request activity. Keep previous rows supplied during a refresh. */
  loading?: boolean;
  /** Replaces only the refresh indicator. Initial loading always uses skeletons. */
  loadingIndicator?: ReactNode;
  /** Accessible loading announcement, independent of the visual indicator. */
  loadingLabel?: string;
  /** Content for a completed empty result. Defaults to "No rows"; null hides it. */
  emptyContent?: ReactNode;
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
