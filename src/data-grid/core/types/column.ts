// Column schema and rendering contract. React imports are type-only.

import type { CSSProperties, ReactNode } from "react";
import type { CellCommit, EditStatus } from "./editing";
import type { ColumnId, RowId } from "./ids";

/** Built-in editor kind. Action cells are non-selectable and own their pointer input. */
export type CellType = "text" | "select" | "action";

/** Frozen zone. Omit for the horizontally scrolling center zone. */
export type FrozenZone = "left" | "right";

export interface SelectOption {
  label: string;
  value: string;
}

/** Context passed to read-mode / overflow render hooks and predicates. */
export interface CellRenderContext<T> {
  row: T;
  rowId: RowId;
  rowIndex: number;
  column: Column<T>;
  /** Result of `column.accessor(row)`. */
  value: unknown;
}

/** Edit context. The editor owns input state; the grid owns commit behavior. */
export interface CellEditContext<T> extends CellRenderContext<T> {
  draft: unknown;
  setDraft: (next: unknown) => void;
  commit: () => void;
  cancel: () => void;
  status: EditStatus;
  error?: unknown;
  /** The cell's width/height in px — so a custom editor can fill the cell (e.g. `width: ctx.width`). */
  width: number;
  height: number;
}

/** Defines how the grid reads, edits, and lays out a field from row type `T`. */
export interface Column<T> {
  id: ColumnId;
  name: string;

  /** Read this column's value from a row. */
  accessor: (row: T) => unknown;

  // Layout. `width` is the initial width; the grid layers in-session resizes over it. All widths are
  // clamped to `minWidth` and `maxWidth`.
  width?: number;
  /** Resize floor in px. Default MIN_COL_WIDTH. */
  minWidth?: number;
  /** Resize ceiling in px. Default unbounded. */
  maxWidth?: number;
  /** Opt out of resizing. Action columns are never resizable. */
  resizable?: boolean;
  frozen?: FrozenZone;

  // Type and editing
  type?: CellType;
  options?: SelectOption[];
  editable?: boolean | ((ctx: CellRenderContext<T>) => boolean);
  /** Coerce/validate the draft before commit (e.g. string -> number). */
  parseValue?: (next: unknown, ctx: CellEditContext<T>) => unknown;
  /**
   * Validate a changed, parsed value before commit. Return a message to reject it. Explicit
   * rejections keep the editor open; implicit rejections discard the draft.
   */
  validate?: (
    value: unknown,
    ctx: CellEditContext<T>
  ) => string | null | undefined;
  /** Commit handler for this column. Falls back to the grid-level handler. */
  onCommit?: (update: CellCommit<T>) => Promise<void> | void;

  // Render hooks. Defaults coerce values to truncated strings.
  renderRead?: (ctx: CellRenderContext<T>) => ReactNode;
  /** Reserved for an overflow popover. Not currently rendered by the grid. */
  renderOverflow?: (ctx: CellRenderContext<T>) => ReactNode;
  renderEdit?: (ctx: CellEditContext<T>) => ReactNode;
  /** Reserved for overflow behavior. */
  overflow?: boolean;

  // Reserved styling hooks; the current cell shell does not apply them.
  className?: string | ((ctx: CellRenderContext<T>) => string);
  style?: CSSProperties | ((ctx: CellRenderContext<T>) => CSSProperties);
  headerClassName?: string;
  headerStyle?: CSSProperties;
}
