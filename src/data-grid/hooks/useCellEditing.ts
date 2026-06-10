import type { RefObject } from "react";
import type {
  CellCoord,
  CellCommit,
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

export interface CellEditingApi {
  /** Open the editor on a cell; `initialDraft` overrides the value (type-to-replace). */
  beginEdit: (cell: CellCoord, initialDraft?: unknown) => boolean;
  cancelEdit: () => void;
  commitCell: () => void;
  commitAndMove: (dir: Direction) => void;
}

// Editing triggers + optimistic commit orchestration (D4/R4/R5). DataGrid never SUBSCRIBES to the
// edit store; this hook only calls mutators, so opening an editor / typing a draft / submit+error
// never re-render the windowed body. Self-contained: it touches stores + props + scroll only.
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
    scrollRef,
    scrollCellIntoView,
  } = args;

  const returnFocus = () => scrollRef.current?.focus();
  const findColumn = (id: ColumnId) => columns.find((c) => c.id === id);

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

  const cancelEdit = () => {
    editStore.cancel(); // abandon — no commit
    returnFocus();
  };

  // Commit the active edit OPTIMISTICALLY (D10): close the editor immediately, show the new value
  // with a spinner via the pending overlay, and run the consumer's handler in the background.
  // Parent stays authoritative (R4) — we never mutate `rows`. On success the persisted value flows
  // back through `accessor` and the overlay clears; on failure the cell reverts to its old value
  // and flashes red (the draft is discarded). The editor never lingers in a "submitting" state.
  const startCommit = () => {
    const snap = editStore.getSnapshot();
    if (snap.status === "idle") return;
    const { cell, draft } = snap;
    editStore.succeed(); // close the editor NOW (hand off to the pending overlay)

    const col = findColumn(cell.columnId);
    const row = rows[cell.rowIndex];
    if (!col || row == null) return;

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
      width: col.width ?? DEFAULT_COL_WIDTH,
      height: rowHeight,
    };
    const nextValue = col.parseValue ? col.parseValue(draft, editCtx) : draft;
    if (Object.is(nextValue, previousValue)) return; // nothing changed — no commit

    const handler = col.onCommit ?? onCellCommit;
    if (!handler) return; // nowhere to persist

    pendingStore.setPending(cell, nextValue); // optimistic
    Promise.resolve(
      handler({ rowId, row, columnId: col.id, previousValue, nextValue }),
    )
      .then(() => pendingStore.clear(cell)) // persisted → value flows back, overlay clears
      .catch(() => {
        pendingStore.setError(cell); // revert + flash; the draft is discarded
        window.setTimeout(() => pendingStore.clear(cell), ERROR_FLASH_MS);
      });
  };

  const commitCell = () => {
    startCommit();
    returnFocus();
  };

  // Commit (optimistically), then advance the focused cell — Enter→down, Tab→right. We do NOT wait
  // for the async: the user moves on immediately; a later failure reverts + flashes that cell.
  const commitAndMove = (dir: Direction) => {
    const snap = editStore.getSnapshot();
    const fromCell = snap.status === "idle" ? null : snap.cell;
    startCommit();
    returnFocus();
    if (fromCell) {
      const next = stepCoord(fromCell, dir, geom);
      store.focusCell(next);
      scrollCellIntoView(next);
    }
  };

  return { beginEdit, cancelEdit, commitCell, commitAndMove };
}
