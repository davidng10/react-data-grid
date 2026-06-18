import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { CellCoord } from "../core/types";
import type { GridStore } from "../core/store/grid-store";
import { EDGE_ZONE, EDGE_SPEED } from "../internal/constants";
import type { GridLayout } from "./useGridLayout";
import type { GridGeometryHelpers } from "./useGridGeometryHelpers";

export interface DragSelectHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: () => void;
}

// Cell focus + drag-select gesture, with edge auto-scroll and click-to-edit disambiguation (D1/D6):
// everything routes through the selection store, never the windowed body. Owns its own `pointerRef`
// — the column-drag gesture never overlaps. Takes `beginEdit` from the editing hook to open the
// editor on a clean click of the already-focused cell.
export function useDragSelect<T>(args: {
  store: GridStore;
  scrollRef: RefObject<HTMLDivElement | null>;
  layout: GridLayout<T>;
  rowHeight: number;
  helpers: GridGeometryHelpers<T>;
  beginEdit: (cell: CellCoord, initialDraft?: unknown) => boolean;
}): DragSelectHandlers {
  const { store, scrollRef, layout, rowHeight, helpers, beginEdit } = args;
  const { leftBand, right } = layout;
  const { hitTest } = helpers;

  const draggingRef = useRef(false);
  const lastHitRef = useRef<CellCoord | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollRef = useRef<number | null>(null);
  // Click-to-edit: a press on the ALREADY-focused cell opens its editor — but only on pointer-up
  // and only if the pointer didn't drag (so a drag-select starting on the focused cell still
  // selects a range, never edits). `pendingEditRef` holds that candidate cell; `movedRef` trips the
  // moment the drag crosses into another cell.
  const pendingEditRef = useRef<CellCoord | null>(null);
  const movedRef = useRef(false);

  const extendDrag = (cell: CellCoord | null) => {
    if (!cell) return;
    const last = lastHitRef.current;
    if (
      last &&
      last.rowIndex === cell.rowIndex &&
      last.columnId === cell.columnId
    ) {
      return; // same cell — skip the redundant store update
    }
    lastHitRef.current = cell;
    movedRef.current = true; // crossed into another cell → this is a drag-select, not a click
    store.extendTo(cell);
  };

  // While dragging near a viewport edge, ramp the scroll and keep extending the range. The center
  // edges are inset by the gutter/frozen bands so auto-scroll triggers at the scrolling region's
  // edge, not under the pinned columns.
  //
  // Gated on `movedRef` (a drag has actually crossed a cell): the pinned frozen zones SIT in the
  // edge bands, so a plain click on a frozen cell is "past the edge" and would otherwise scroll the
  // table every frame until pointer-up. Auto-scroll is a drag feature — a stationary click must not
  // trigger it. (By the time a real drag reaches an edge it has already crossed cells, so this never
  // blocks legitimate drag-auto-scroll.)
  const autoScrollTick = () => {
    if (!draggingRef.current) {
      autoScrollRef.current = null;
      return;
    }
    const el = scrollRef.current;
    const pt = pointerRef.current;
    if (el && pt && movedRef.current) {
      const rect = el.getBoundingClientRect();
      const topLimit = rect.top + rowHeight;
      const leftLimit = rect.left + leftBand;
      const rightLimit = rect.left + el.clientWidth - right.total;
      let dx = 0;
      let dy = 0;
      if (pt.y < topLimit + EDGE_ZONE) dy = -EDGE_SPEED;
      else if (pt.y > rect.bottom - EDGE_ZONE) dy = EDGE_SPEED;
      if (pt.x < leftLimit + EDGE_ZONE) dx = -EDGE_SPEED;
      else if (pt.x > rightLimit - EDGE_ZONE) dx = EDGE_SPEED;
      if (dy) el.scrollTop += dy;
      if (dx) el.scrollLeft += dx;
      if (dx || dy) extendDrag(hitTest(pt.x, pt.y));
    }
    autoScrollRef.current = requestAnimationFrame(autoScrollTick);
  };

  useEffect(
    () => () => {
      if (autoScrollRef.current != null)
        cancelAnimationFrame(autoScrollRef.current);
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const cell = hitTest(e.clientX, e.clientY);
    if (!cell) return; // header / gutter / outside — let native handlers (e.g. checkboxes) run
    scrollRef.current?.focus();
    // Was this exact cell already the (single) focus before this press? If so, a plain click on it
    // should open the editor (resolved on pointer-up, if the pointer didn't drag).
    const prev = store.getSnapshot();
    const alreadyFocused =
      !e.shiftKey &&
      prev.range == null &&
      prev.focusedCell != null &&
      prev.focusedCell.rowIndex === cell.rowIndex &&
      prev.focusedCell.columnId === cell.columnId;
    pendingEditRef.current = alreadyFocused ? cell : null;
    movedRef.current = false;
    if (e.shiftKey) store.extendTo(cell);
    else store.focusCell(cell);
    draggingRef.current = true;
    lastHitRef.current = cell;
    pointerRef.current = { x: e.clientX, y: e.clientY };
    scrollRef.current?.setPointerCapture(e.pointerId);
    if (autoScrollRef.current == null) {
      autoScrollRef.current = requestAnimationFrame(autoScrollTick);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    pointerRef.current = { x: e.clientX, y: e.clientY };
    extendDrag(hitTest(e.clientX, e.clientY));
  };

  // End the drag and its auto-scroll loop. Shared by a clean pointer-up and an interrupted
  // lost-pointer-capture so the gesture can never be left "live".
  const stopDrag = () => {
    draggingRef.current = false;
    if (autoScrollRef.current != null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    stopDrag();
    scrollRef.current?.releasePointerCapture(e.pointerId);
    // A click (no drag) on the already-focused cell enters edit mode.
    const editCell = pendingEditRef.current;
    pendingEditRef.current = null;
    if (editCell && !movedRef.current) beginEdit(editCell);
  };

  // Pointer capture was lost WITHOUT a pointer-up — touch `pointercancel`, the captured node
  // re-rendering out, or another gesture stealing capture. Without this the drag would never
  // end: `draggingRef` stays true, so the auto-scroll RAF keeps rescheduling (scrolling every
  // frame if the pointer sat in an edge band) and `onPointerMove` keeps extending the range on
  // plain hover. An interrupted gesture is an abort, so we drop the pending click-to-edit.
  const onLostPointerCapture = () => {
    stopDrag();
    pendingEditRef.current = null;
  };

  return { onPointerDown, onPointerMove, onPointerUp, onLostPointerCapture };
}
