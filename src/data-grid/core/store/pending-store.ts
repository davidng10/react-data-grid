// Tracks optimistic values and failures by display coordinate. The store is transient; parent rows
// remain authoritative, and only `PendingOverlay` subscribes.

import type { CellCoord } from "../types/ids";

/**
 * How long the error state lives: the red-flash animation duration AND the delay before the entry
 * is cleared (which reverts the cell to its old value). Single-sourced so the two can't drift —
 * a mismatch makes the flash "reappear" after the animation ends. Tune here.
 */
export const ERROR_FLASH_MS = 500;

export type PendingStatus = "pending" | "error";

export interface PendingCell {
  cell: CellCoord;
  /** The optimistic value shown while the commit is in flight (ignored once status is 'error'). */
  value: unknown;
  status: PendingStatus;
}

export type PendingMap = ReadonlyMap<string, PendingCell>;

const keyOf = (cell: CellCoord) => `${cell.rowIndex}:${cell.columnId}`;

export interface PendingStore {
  getSnapshot: () => PendingMap;
  subscribe: (listener: () => void) => () => void;

  /** Mark a cell's commit as in flight, showing `value` optimistically. */
  setPending: (cell: CellCoord, value: unknown) => void;
  /** Flip a cell to the error (revert + flash) state. */
  setError: (cell: CellCoord) => void;
  /** Remove a cell's entry (commit resolved, or the error flash finished). */
  clear: (cell: CellCoord) => void;
  /** Is this cell mid-commit (so it can't be re-edited)? */
  has: (cell: CellCoord) => boolean;
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

    setPending(cell, value) {
      const next = new Map(state);
      next.set(keyOf(cell), { cell, value, status: "pending" });
      set(next);
    },

    setError(cell) {
      const k = keyOf(cell);
      const prev = state.get(k);
      const next = new Map(state);
      next.set(k, { cell, value: prev?.value, status: "error" });
      set(next);
    },

    clear(cell) {
      const k = keyOf(cell);
      if (!state.has(k)) return;
      const next = new Map(state);
      next.delete(k);
      set(next);
    },

    has(cell) {
      return state.has(keyOf(cell));
    },
  };
}
