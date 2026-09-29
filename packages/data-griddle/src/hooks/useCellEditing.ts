import { useEffect, useMemo, useRef } from "react";

import { stepCoord } from "../core/selection/geometry";
import { ERROR_FLASH_MS } from "../core/store/pending-store";
import { resolveColumnCapabilities } from "../internal/column-capabilities";
import { DEFAULT_COL_WIDTH } from "../internal/constants";
import { useIsomorphicLayoutEffect as useLayoutEffect } from "../internal/use-isomorphic-layout-effect";

import type { RefObject } from "react";
import type { Direction, GridGeometry } from "../core/selection/geometry";
import type { EditStore } from "../core/store/edit-store";
import type { GridStore } from "../core/store/grid-store";
import type { PendingStore } from "../core/store/pending-store";
import type {
  CellCommit,
  CellCommitFailure,
  CellCoord,
  CellEditContext,
  Column,
  ColumnId,
  RowId,
} from "../core/types";

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
  loading: boolean;
  store: GridStore;
  editStore: EditStore;
  pendingStore: PendingStore;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowIndexById: ReadonlyMap<RowId, number>;
  getRowId: (row: T, index: number) => RowId;
  rowHeight: number;
  geom: GridGeometry;
  onCellCommit?: (update: CellCommit<T>) => Promise<void> | void;
  onCellCommitError?: (failure: CellCommitFailure<T>) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollCellIntoView: (cell: CellCoord) => void;
}): CellEditingApi {
  const {
    loading,
    store,
    editStore,
    pendingStore,
    columns,
    rows,
    rowIndexById,
    getRowId,
    rowHeight,
    geom,
    onCellCommit,
    onCellCommitError,
    scrollRef,
    scrollCellIntoView,
  } = args;

  // Also guards callbacks retained by custom editors and events dispatched during DOM changes.
  const loadingRef = useRef(loading);
  useLayoutEffect(() => {
    loadingRef.current = loading;
  });

  const returnFocus = () => scrollRef.current?.focus({ preventScroll: true });
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
    []
  );

  const isEditable = (cell: CellCoord): boolean => {
    const col = findColumn(cell.columnId);
    if (!col) return false;
    const editable = resolveColumnCapabilities(col).editable;
    if (!editable) return false;
    if (editable === true) return true;
    const row = rows[cell.rowIndex];
    if (row == null) return false;
    const width = geom.placement(cell.columnId)?.width ?? DEFAULT_COL_WIDTH;
    return editable({
      row,
      rowId: getRowId(row, cell.rowIndex),
      rowIndex: cell.rowIndex,
      column: col,
      columnId: col.id,
      value: col.accessor(row),
      width,
      height: rowHeight,
    });
  };

  // Open the editor on a cell. `initialDraft` overrides the current value (type-to-replace).
  // A cell mid-commit is "disabled" — refuse until its pending overlay resolves.
  const beginEdit = (cell: CellCoord, initialDraft?: unknown): boolean => {
    if (loadingRef.current || editStore.getSnapshot().status !== "idle")
      return false;
    clearCorrectiveTimer();
    const col = findColumn(cell.columnId);
    const row = rows[cell.rowIndex];
    if (
      !col ||
      row == null ||
      !isEditable(cell) ||
      pendingStore.has(getRowId(row, cell.rowIndex), cell.columnId)
    )
      return false;
    store.focusCell(cell);
    scrollCellIntoView(cell);
    editStore.begin(
      cell,
      initialDraft !== undefined ? initialDraft : col.accessor(row),
      getRowId(row, cell.rowIndex)
    );
    return true;
  };

  const resolveCell = (originalCell: CellCoord, targetRowId?: RowId) => {
    const rowIndex =
      targetRowId == null
        ? originalCell.rowIndex
        : rowIndexById.get(targetRowId);
    return rowIndex == null ? null : { ...originalCell, rowIndex };
  };

  // Resolve the consumer-facing context and parsed value in one place so commit-time validation
  // and debounced corrective validation always evaluate the draft identically.
  const resolveDraft = (
    originalCell: CellCoord,
    draft: unknown,
    targetRowId?: RowId
  ) => {
    const cell = resolveCell(originalCell, targetRowId);
    if (!cell) return null;
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
      columnId: col.id,
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
    if (loadingRef.current) return;
    const snap = editStore.getSnapshot();
    if (snap.status !== "error") return;
    const resolved = resolveDraft(snap.cell, snap.draft, snap.rowId);
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
    if (loadingRef.current) return;
    const wasError = editStore.getSnapshot().status === "error";
    editStore.setDraft(next);
    if (!wasError) return; // initial typing remains validation-free
    clearCorrectiveTimer();
    correctiveTimerRef.current = window.setTimeout(
      () => correctiveValidationRef.current(),
      CORRECTIVE_VALIDATION_DELAY_MS
    );
  };

  const cancelEdit = () => {
    if (loadingRef.current) return;
    clearCorrectiveTimer();
    editStore.cancel(); // abandon — no commit
    returnFocus();
  };

  // Explicit validation failures keep the editor open; implicit failures discard the draft so an
  // outside click cannot trap focus. Accepted values move to the pending overlay while the consumer
  // persists them. Returns whether the editor closed.
  const startCommit = (implicit: boolean): boolean => {
    if (loadingRef.current) return false;
    // Enter/Tab/blur never wait for the debounce: validate the latest draft immediately.
    clearCorrectiveTimer();
    const snap = editStore.getSnapshot();
    if (snap.status === "idle") return false;
    const { cell, draft } = snap;

    const resolved = resolveDraft(cell, draft, snap.rowId);
    if (!resolved) {
      // The row/column may return after a fetch. Keep the draft until an explicit discard.
      return false;
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
      pendingStore.setError(rowId, col.id);
      window.setTimeout(
        () => pendingStore.clear(rowId, col.id),
        ERROR_FLASH_MS
      );
      onCellCommitError?.({ update, error });
    };

    pendingStore.setPending(rowId, col.id, nextValue); // optimistic
    let result: Promise<void> | void;
    try {
      result = handler(update);
    } catch (error) {
      handleCommitError(error);
      return true;
    }
    Promise.resolve(result)
      .then(() => pendingStore.clear(rowId, col.id)) // persisted → value flows back, overlay clears
      .catch(handleCommitError); // revert + flash; the draft is discarded
    return true;
  };

  // Explicit commit-in-place (`ctx.commit` / select pick). On a rejected validation the editor stays
  // open and FOCUSED so the user can fix it — so only return focus to the grid when it actually closed.
  const commitCell = () => {
    if (startCommit(false)) returnFocus();
  };

  // Implicit commit (blur / outside-click). Valid → save + close; invalid → discard + close. Either
  // way, preserve the outside focus destination rather than returning focus to the grid.
  const commitImplicit = () => {
    startCommit(true);
  };

  // Commit (optimistically), then advance the focused cell — Enter→down, Tab→right. We do NOT wait
  // for the async: the user moves on immediately; a later failure reverts + flashes that cell. A
  // rejected validation keeps the editor open — DON'T move or return focus (the editor holds it).
  const commitAndMove = (dir: Direction) => {
    const snap = editStore.getSnapshot();
    const fromCell =
      snap.status === "idle" ? null : resolveCell(snap.cell, snap.rowId);
    if (!startCommit(false)) return; // invalid explicit save → stay open, don't move
    returnFocus();
    if (fromCell) {
      const next = stepCoord(fromCell, dir, geom);
      store.focusCell(next);
      scrollCellIntoView(next);
    }
  };

  // A custom editor may retain its first context (e.g. a delayed save). Delegate to the latest
  // committed render so resumed actions resolve current row identities, values and callbacks.
  const latestApiRef = useRef<CellEditingApi | null>(null);
  useLayoutEffect(() => {
    latestApiRef.current = {
      beginEdit,
      setDraft,
      cancelEdit,
      commitCell,
      commitImplicit,
      commitAndMove,
    };
    return () => {
      latestApiRef.current = null;
    };
  });
  return useMemo<CellEditingApi>(
    () => ({
      beginEdit: (...args) => latestApiRef.current?.beginEdit(...args) ?? false,
      setDraft: (next) => latestApiRef.current?.setDraft(next),
      cancelEdit: () => latestApiRef.current?.cancelEdit(),
      commitCell: () => latestApiRef.current?.commitCell(),
      commitImplicit: () => latestApiRef.current?.commitImplicit(),
      commitAndMove: (dir) => latestApiRef.current?.commitAndMove(dir),
    }),
    []
  );
}
