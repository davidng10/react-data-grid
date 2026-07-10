import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { CellCoord } from "../core/types";
import type { GridStore } from "../core/store/grid-store";
import { edgeScrollDelta } from "../internal/auto-scroll";
import type { GridLayout } from "./useGridLayout";
import type { GridGeometryHelpers } from "./useGridGeometryHelpers";

export interface DragSelectHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: () => void;
}

// Handles cell focus, drag selection, edge auto-scroll, and click-to-edit. Updates go through the
// selection store so pointer movement does not re-render cells.
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
  // Open an already-focused cell only if the pointer never crosses into another cell.
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

  // Start edge auto-scroll only after crossing a cell. Without this guard, a stationary click in a
  // frozen band would be mistaken for a pointer beyond the scrolling region.
  const autoScrollTick = () => {
    if (!draggingRef.current) {
      autoScrollRef.current = null;
      return;
    }
    const el = scrollRef.current;
    const pt = pointerRef.current;
    if (el && pt && movedRef.current) {
      const { dx, dy } = edgeScrollDelta(pt, el, {
        top: rowHeight,
        left: leftBand,
        right: right.total,
      });
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
