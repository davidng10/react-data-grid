// Tracks one active editor. Only `EditorPortal` subscribes; asynchronous commit state moves to the
// pending store after the editor closes.

import type { EditState } from "../types/editing";
import type { CellCoord, RowId } from "../types/ids";

const IDLE: EditState = { status: "idle" };

export interface EditStore {
  getSnapshot: () => EditState;
  subscribe: (listener: () => void) => () => void;

  /** Open the editor on `cell` with an initial draft (current value, or a typed char). */
  begin: (cell: CellCoord, draft: unknown, rowId?: RowId) => void;
  /**
   * Update the draft as the user types. No-op while submitting (the editor is locked). After an
   * error, retain that error until the editing orchestrator revalidates the updated draft.
   */
  setDraft: (next: unknown) => void;
  /** Clear a validation error after corrective revalidation accepts the current draft. */
  clearError: () => void;
  /** editing | error -> submitting (commit in flight). Keeps cell + draft. */
  submitting: () => void;
  /** Commit resolved -> close the editor. */
  succeed: () => void;
  /** Commit rejected -> error, keeping cell + draft so the user can retry or edit. */
  fail: (error: unknown) => void;
  /** Abandon the edit (Escape) -> idle. */
  cancel: () => void;
}

export function createEditStore(): EditStore {
  let state: EditState = IDLE;
  const listeners = new Set<() => void>();

  const set = (next: EditState) => {
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

    begin(cell, draft, rowId) {
      set({
        status: "editing",
        cell,
        draft,
        ...(rowId == null ? {} : { rowId }),
      });
    },

    setDraft(next) {
      // Only meaningful while an editor is open; a locked (submitting) editor ignores input.
      if (state.status === "editing") {
        set({ ...state, draft: next });
      } else if (state.status === "error") {
        // Keep the message stable while corrective validation is debounced. The editing
        // orchestrator clears or replaces it after checking the latest draft.
        set({
          ...state,
          draft: next,
        });
      }
    },

    clearError() {
      if (state.status === "error") {
        set({
          status: "editing",
          cell: state.cell,
          draft: state.draft,
          ...(state.rowId == null ? {} : { rowId: state.rowId }),
        });
      }
    },

    submitting() {
      if (state.status === "editing" || state.status === "error") {
        set({
          status: "submitting",
          cell: state.cell,
          draft: state.draft,
          ...(state.rowId == null ? {} : { rowId: state.rowId }),
        });
      }
    },

    succeed() {
      if (state.status !== "idle") set(IDLE);
    },

    fail(error) {
      if (state.status !== "idle") {
        set({ ...state, status: "error", error });
      }
    },

    cancel() {
      if (state.status !== "idle") set(IDLE);
    },
  };
}
