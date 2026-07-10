import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type {
  CellCoord,
  CellCommit,
  CellCommitFailure,
  CellEditContext,
  Column,
  ColumnId,
  RowId,
} from "../core/types";
import { stepCoord } from "../core/selection/geometry";
import type { Direction, GridGeometry } from "../core/selection/geometry";
import type { GridStore } from "../core/store/grid-store";
import type { EditStore } from "../core/store/edit-store";
import type { PendingStore } from "../core/store/pending-store";
import { ERROR_FLASH_MS } from "../core/store/pending-store";
import { DEFAULT_COL_WIDTH } from "../internal/constants";

const CORRECTIVE_VALIDATION_DELAY_MS = 200;

export interface CellEditingApi {
  /** Open the editor on a cell; `initialDraft` overrides the value (type-to-replace). */
  beginEdit: (cell: CellCoord, initialDraft?: unknown) => boolean;
  /** Update the active draft; after a validation error, schedule corrective revalidation. */
  setDraft: (next: unknown) => void;
  cancelEdit: () => void;
  /** EXPLICIT commit — the user is actively saving from inside the editor (`ctx.commit`, select pick). */
  commitCell: () => void;
  /** IMPLICIT commit — focus left the editor (blur / outside-click). Discards an invalid draft. */
  commitImplicit: () => void;
  commitAndMove: (dir: Direction) => void;
}

// Coordinates editing, validation, and optimistic commits. This hook mutates stores but does not
// subscribe, keeping edit updates off the windowed cell body.
export function useCellEditing<T>(args: {
  store: GridStore;
  editStore: EditStore;
  pendingStore: PendingStore;
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T, index: number) => RowId;
  rowHeight: number;
  geom: GridGeometry;
  onCellCommit?: (update: CellCommit<T>) => Promise<void> | void;
  onCellCommitError?: (failure: CellCommitFailure<T>) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollCellIntoView: (cell: CellCoord) => void;
}): CellEditingApi {
  const {
    store,
    editStore,
    pendingStore,
    columns,
    rows,
    getRowId,
    rowHeight,
    geom,
    onCellCommit,
    onCellCommitError,
    scrollRef,
    scrollCellIntoView,
  } = args;

  const returnFocus = () => scrollRef.current?.focus();
  const findColumn = (id: ColumnId) => columns.find((c) => c.id === id);
  const correctiveTimerRef = useRef<number | null>(null);
  const correctiveValidationRef = useRef<() => void>(() => {});

  const clearCorrectiveTimer = () => {
    if (correctiveTimerRef.current == null) return;
    window.clearTimeout(correctiveTimerRef.current);
    correctiveTimerRef.current = null;
  };

  useEffect(
    () => () => {
      if (correctiveTimerRef.current != null)
        window.clearTimeout(correctiveTimerRef.current);
    },
    [],
  );

  const isEditable = (cell: CellCoord): boolean => {
    const col = findColumn(cell.columnId);
    if (!col || col.type === "action" || !col.editable) return false;
    if (col.editable === true) return true;
    const row = rows[cell.rowIndex];
    return col.editable({
      row,
      rowId: getRowId(row, cell.rowIndex),
      rowIndex: cell.rowIndex,
      column: col,
      value: col.accessor(row),
    });
  };

  // Open the editor on a cell. `initialDraft` overrides the current value (type-to-replace).
  // A cell mid-commit is "disabled" — refuse until its pending overlay resolves.
  const beginEdit = (cell: CellCoord, initialDraft?: unknown): boolean => {
    clearCorrectiveTimer();
    const col = findColumn(cell.columnId);
    const row = rows[cell.rowIndex];
    if (!col || row == null || !isEditable(cell) || pendingStore.has(cell))
      return false;
    store.focusCell(cell);
    scrollCellIntoView(cell);
    editStore.begin(
      cell,
      initialDraft !== undefined ? initialDraft : col.accessor(row),
    );
    return true;
  };

  // Resolve the consumer-facing context and parsed value in one place so commit-time validation
  // and debounced corrective validation always evaluate the draft identically.
  const resolveDraft = (cell: CellCoord, draft: unknown) => {
    const col = findColumn(cell.columnId);
    const row = rows[cell.rowIndex];
    if (!col || row == null) return null;

    const rowId = getRowId(row, cell.rowIndex);
    const previousValue = col.accessor(row);
    const editCtx: CellEditContext<T> = {
      row,
      rowId,
      rowIndex: cell.rowIndex,
      column: col,
      value: previousValue,
      draft,
      setDraft: editStore.setDraft,
      commit: () => {},
      cancel: () => {},
      status: "editing",
      // Placement contains the current width after any in-session resize.
      width: geom.placement(cell.columnId)?.width ?? DEFAULT_COL_WIDTH,
      height: rowHeight,
    };
    const nextValue = col.parseValue ? col.parseValue(draft, editCtx) : draft;
    return { cell, col, row, rowId, previousValue, editCtx, nextValue };
  };

  // After the first explicit failure, revalidate only after typing pauses. The existing error stays
  // mounted during the delay, avoiding false blue/valid feedback and repeated alert insertion.
  const revalidateCorrectedDraft = () => {
    correctiveTimerRef.current = null;
    const snap = editStore.getSnapshot();
    if (snap.status !== "error") return;
    const resolved = resolveDraft(snap.cell, snap.draft);
    if (!resolved) return;
    const { col, nextValue, previousValue, editCtx } = resolved;
    if (Object.is(nextValue, previousValue)) {
      editStore.clearError();
      return;
    }
    const error = col.validate?.(nextValue, editCtx);
    if (error) editStore.fail(error);
    else editStore.clearError();
  };
  // A pending timer always calls the latest render's resolver/props rather than a stale closure.
  useEffect(() => {
    correctiveValidationRef.current = revalidateCorrectedDraft;
  });

  const setDraft = (next: unknown) => {
    const wasError = editStore.getSnapshot().status === "error";
    editStore.setDraft(next);
    if (!wasError) return; // initial typing remains validation-free
    clearCorrectiveTimer();
    correctiveTimerRef.current = window.setTimeout(
      () => correctiveValidationRef.current(),
      CORRECTIVE_VALIDATION_DELAY_MS,
    );
  };

  const cancelEdit = () => {
    clearCorrectiveTimer();
    editStore.cancel(); // abandon — no commit
    returnFocus();
  };

  // Explicit validation failures keep the editor open; implicit failures discard the draft so an
  // outside click cannot trap focus. Accepted values move to the pending overlay while the consumer
  // persists them. Returns whether the editor closed.
  const startCommit = (implicit: boolean): boolean => {
    // Enter/Tab/blur never wait for the debounce: validate the latest draft immediately.
    clearCorrectiveTimer();
    const snap = editStore.getSnapshot();
    if (snap.status === "idle") return false;
    const { cell, draft } = snap;

    const resolved = resolveDraft(cell, draft);
    if (!resolved) {
      editStore.succeed(); // can't resolve the cell — just close
      return true;
    }
    const { col, row, rowId, previousValue, editCtx, nextValue } = resolved;
    if (Object.is(nextValue, previousValue)) {
      editStore.succeed(); // nothing changed — no-op close (validate is NOT consulted)
      return true;
    }

    // Synchronous validation gate — only on a real change. A returned message REJECTS the commit.
    const error = col.validate?.(nextValue, editCtx);
    if (error) {
      if (implicit)
        editStore.cancel(); // click-away on an invalid draft → discard + close
      else editStore.fail(error); // explicit save → keep the editor open + surface the error
      return false;
    }

    editStore.succeed(); // accepted → close the editor NOW (hand off to the pending overlay)

    const handler = col.onCommit ?? onCellCommit;
    if (!handler) return true; // nowhere to persist

    const update: CellCommit<T> = {
      rowId,
      row,
      columnId: col.id,
      previousValue,
      nextValue,
    };
    const handleCommitError = (error: unknown) => {
      // Preserve the built-in behavior first so a consumer callback cannot prevent rollback/flash.
      pendingStore.setError(cell);
      window.setTimeout(() => pendingStore.clear(cell), ERROR_FLASH_MS);
      onCellCommitError?.({ update, error });
    };

    pendingStore.setPending(cell, nextValue); // optimistic
    let result: Promise<void> | void;
    try {
      result = handler(update);
    } catch (error) {
      handleCommitError(error);
      return true;
    }
    Promise.resolve(result)
      .then(() => pendingStore.clear(cell)) // persisted → value flows back, overlay clears
      .catch(handleCommitError); // revert + flash; the draft is discarded
    return true;
  };

  // Explicit commit-in-place (`ctx.commit` / select pick). On a rejected validation the editor stays
  // open and FOCUSED so the user can fix it — so only return focus to the grid when it actually closed.
  const commitCell = () => {
    if (startCommit(false)) returnFocus();
  };

  // Implicit commit (blur / outside-click). Valid → save + close; invalid → discard + close. Either
  // way the editor is gone on success; don't return focus when it stayed open (it never does here).
  const commitImplicit = () => {
    if (startCommit(true)) returnFocus();
  };

  // Commit (optimistically), then advance the focused cell — Enter→down, Tab→right. We do NOT wait
  // for the async: the user moves on immediately; a later failure reverts + flashes that cell. A
  // rejected validation keeps the editor open — DON'T move or return focus (the editor holds it).
  const commitAndMove = (dir: Direction) => {
    const snap = editStore.getSnapshot();
    const fromCell = snap.status === "idle" ? null : snap.cell;
    if (!startCommit(false)) return; // invalid explicit save → stay open, don't move
    returnFocus();
    if (fromCell) {
      const next = stepCoord(fromCell, dir, geom);
      store.focusCell(next);
      scrollCellIntoView(next);
    }
  };

  return {
    beginEdit,
    setDraft,
    cancelEdit,
    commitCell,
    commitImplicit,
    commitAndMove,
  };
}
