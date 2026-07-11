// Tracks optimistic values and failures by stable cell identity. The store is transient; parent rows
// remain authoritative, and only `PendingOverlay` subscribes.

import type { ColumnId, RowId } from "../types/ids";

/**
 * How long the error state lives: the red-flash animation duration AND the delay before the entry
 * is cleared (which reverts the cell to its old value). Single-sourced so the two can't drift —
 * a mismatch makes the flash "reappear" after the animation ends. Tune here.
 */
export const ERROR_FLASH_MS = 500;

export type PendingStatus = "pending" | "error";

export interface PendingCell {
  rowId: RowId;
  columnId: ColumnId;
  /** The optimistic value shown while the commit is in flight (ignored once status is 'error'). */
  value: unknown;
  status: PendingStatus;
}

export type PendingMap = ReadonlyMap<string, PendingCell>;

const keyOf = (rowId: RowId, columnId: ColumnId) =>
  JSON.stringify([typeof rowId, rowId, columnId]);

export interface PendingStore {
  getSnapshot: () => PendingMap;
  subscribe: (listener: () => void) => () => void;

  /** Mark a cell's commit as in flight, showing `value` optimistically. */
  setPending: (rowId: RowId, columnId: ColumnId, value: unknown) => void;
  /** Flip a cell to the error (revert + flash) state. */
  setError: (rowId: RowId, columnId: ColumnId) => void;
  /** Remove a cell's entry (commit resolved, or the error flash finished). */
  clear: (rowId: RowId, columnId: ColumnId) => void;
  /** Is this cell mid-commit (so it can't be re-edited)? */
  has: (rowId: RowId, columnId: ColumnId) => boolean;
}

export function createPendingStore(): PendingStore {
  let state: ReadonlyMap<string, PendingCell> = new Map();
  const listeners = new Set<() => void>();

  const set = (next: ReadonlyMap<string, PendingCell>) => {
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setPending(rowId, columnId, value) {
      const next = new Map(state);
      next.set(keyOf(rowId, columnId), {
        rowId,
        columnId,
        value,
        status: "pending",
      });
      set(next);
    },

    setError(rowId, columnId) {
      const k = keyOf(rowId, columnId);
      const prev = state.get(k);
      const next = new Map(state);
      next.set(k, {
        rowId,
        columnId,
        value: prev?.value,
        status: "error",
      });
      set(next);
    },

    clear(rowId, columnId) {
      const k = keyOf(rowId, columnId);
      if (!state.has(k)) return;
      const next = new Map(state);
      next.delete(k);
      set(next);
    },

    has(rowId, columnId) {
      return state.has(keyOf(rowId, columnId));
    },
  };
}
