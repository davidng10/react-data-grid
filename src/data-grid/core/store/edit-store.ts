// Edit store (DECISIONS.md D1, D4, R4, R5).
//
// The second D1 plain-TS observable store (after grid-store): zero React imports, one immutable
// `EditState` snapshot behind subscribe/getSnapshot (for `useSyncExternalStore`). Only the
// `EditorPortal` leaf subscribes — `DataGrid` and the windowed body never do, so opening an
// editor, typing a draft, and the submit/error transitions never re-render the body (D1/D6).
//
// This module is just the state container + intent mutators. The actual async commit (calling the
// consumer's `onCommit` / `onCellCommit`) is orchestrated by the shell, which owns those props;
// the store only tracks the resulting status. One active edit at a time (the chosen async model:
// the editor stays open until the commit resolves) — so a single `EditState`, not a pending map.

import type { CellCoord } from '../types/ids'
import type { EditState } from '../types/editing'

const IDLE: EditState = { status: 'idle' }

export interface EditStore {
  getSnapshot: () => EditState
  subscribe: (listener: () => void) => () => void

  /** Open the editor on `cell` with an initial draft (current value, or a typed char). */
  begin: (cell: CellCoord, draft: unknown) => void
  /**
   * Update the draft as the user types. No-op while submitting (the editor is locked); after an
   * error, a keystroke clears the error and returns to a clean `editing` state with the new draft.
   */
  setDraft: (next: unknown) => void
  /** editing | error -> submitting (commit in flight). Keeps cell + draft. */
  submitting: () => void
  /** Commit resolved -> close the editor. */
  succeed: () => void
  /** Commit rejected -> error, keeping cell + draft so the user can retry or edit. */
  fail: (error: unknown) => void
  /** Abandon the edit (Escape) -> idle. */
  cancel: () => void
}

export function createEditStore(): EditStore {
  let state: EditState = IDLE
  const listeners = new Set<() => void>()

  const set = (next: EditState) => {
    state = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    begin(cell, draft) {
      set({ status: 'editing', cell, draft })
    },

    setDraft(next) {
      // Only meaningful while an editor is open; a locked (submitting) editor ignores input.
      if (state.status === 'editing') {
        set({ status: 'editing', cell: state.cell, draft: next })
      } else if (state.status === 'error') {
        // A keystroke after a failed commit returns to editing and clears the error.
        set({ status: 'editing', cell: state.cell, draft: next })
      }
    },

    submitting() {
      if (state.status === 'editing' || state.status === 'error') {
        set({ status: 'submitting', cell: state.cell, draft: state.draft })
      }
    },

    succeed() {
      if (state.status !== 'idle') set(IDLE)
    },

    fail(error) {
      if (state.status !== 'idle') {
        set({ status: 'error', cell: state.cell, draft: state.draft, error })
      }
    },

    cancel() {
      if (state.status !== 'idle') set(IDLE)
    },
  }
}
