// Editor state machine. Parent rows remain authoritative; the grid keeps only transient edit state.

import type { CellCoord, ColumnId, RowId } from "./ids";

export type EditStatus = "editing" | "submitting" | "error";

export type EditState =
  | { status: "idle" }
  | { status: "editing"; cell: CellCoord; draft: unknown }
  | { status: "submitting"; cell: CellCoord; draft: unknown }
  | { status: "error"; cell: CellCoord; draft: unknown; error: unknown };

/**
 * Payload handed to `onCommit` / `onCellCommit`. The consumer applies `nextValue` to its own
 * data and lets it flow back in as new `rows`. `previousValue` enables optimistic
 * rollback on rejection.
 */
export interface CellCommit<T> {
  rowId: RowId;
  row: T;
  columnId: ColumnId;
  previousValue: unknown;
  nextValue: unknown;
}

/** A rejected asynchronous cell commit, exposed so consumers can notify or log the failure. */
export interface CellCommitFailure<T> {
  update: CellCommit<T>;
  error: unknown;
}
