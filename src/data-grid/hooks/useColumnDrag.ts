import { useEffect, useRef } from "react";

import {
  dragBounds,
  dropIndexAtX,
  reorderWithinZone,
} from "../core/selection/geometry";
import { edgeScrollDelta } from "../internal/auto-scroll";
import { DRAG_THRESHOLD } from "../internal/constants";

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { Zone } from "../core/selection/geometry";
import type { DragStore } from "../core/store/drag-store";
import type { ColumnId } from "../core/types";
import type { GridGeometryHelpers } from "./useGridGeometryHelpers";
import type { GridLayout } from "./useGridLayout";

export interface ColumnDragHandlers {
  /** Returns true when the gesture consumed the event (a header-drag is in progress). */
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => boolean;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => boolean;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => boolean;
  onLostPointerCapture: () => void;
}

// Handles within-zone column dragging. Store updates redraw only the indicator, and each handler
// reports whether it consumed the pointer event so gestures can be composed safely.
export function useColumnDrag<T>(args: {
  reorderable: boolean;
  dragStore: DragStore;
  scrollRef: RefObject<HTMLDivElement | null>;
  layout: GridLayout<T>;
  helpers: GridGeometryHelpers<T>;
  onColumnOrderChange?: (order: ColumnId[]) => void;
}): ColumnDragHandlers {
  const {
    reorderable,
    dragStore,
    scrollRef,
    layout,
    helpers,
    onColumnOrderChange,
  } = args;
  const { leftBand, right, columnOrder, placementMap } = layout;
  const { headerHitTest, zoneColsFor, layoutFor, zoneLocalXFor } = helpers;

  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  // Column drag uses its own horizontal auto-scroll loop.
  const dragScrollRef = useRef<number | null>(null);
  // The header captured on pointerdown; the drag only starts (and the drag store only flips to
  // `dragging`) once the pointer crosses `DRAG_THRESHOLD`. `bounds` is the insertion range the drag
  // is confined to; it cannot cross an action-column barrier.
  const dragSourceRef = useRef<{
    columnId: ColumnId;
    zone: Zone;
    sourceIndex: number;
    bounds: [number, number];
  } | null>(null);

  // Recompute the target after each center-zone scroll because the pointer maps to a new column.
  const dragScrollTick = () => {
    const src = dragSourceRef.current;
    const el = scrollRef.current;
    const pt = pointerRef.current;
    if (
      !src ||
      src.zone !== "center" ||
      !el ||
      !pt ||
      dragStore.getSnapshot().status !== "dragging"
    ) {
      dragScrollRef.current = null;
      return;
    }
    // Frozen zones are fully rendered and never need horizontal auto-scroll.
    const { dx } = edgeScrollDelta(pt, el, {
      left: leftBand,
      right: right.total,
    });
    if (dx) {
      el.scrollLeft += dx;
      const zl = layoutFor("center");
      const zoneX = zoneLocalXFor("center", pt.x);
      const { index, indicatorX } = dropIndexAtX(
        zl.offsets,
        zl.widths,
        zoneX,
        src.bounds
      );
      dragStore.updateTarget(index, indicatorX);
    }
    dragScrollRef.current = requestAnimationFrame(dragScrollTick);
  };

  useEffect(
    () => () => {
      if (dragScrollRef.current != null)
        cancelAnimationFrame(dragScrollRef.current);
    },
    []
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): boolean => {
    // Capture the source, but wait for the threshold before starting a drag.
    const header = reorderable ? headerHitTest(e.clientX, e.clientY) : null;
    if (!header) return false;
    // Barrier bounds remain constant because the source and zone cannot change during a drag.
    const isBarrier = zoneColsFor(header.zone).map((c) => c.type === "action");
    const bounds = dragBounds(isBarrier, header.sourceIndex);
    dragSourceRef.current = { ...header, bounds };
    pointerRef.current = { x: e.clientX, y: e.clientY };
    // While the pointer is captured the cursor follows the CAPTURE TARGET (this container), not the
    // header under it — so the header's `grab` would vanish. Force `grabbing` on the container for
    // the gesture; reset on pointerup. One write covers the whole drag (capture redirects it).
    if (scrollRef.current) scrollRef.current.style.cursor = "grabbing";
    scrollRef.current?.setPointerCapture(e.pointerId);
    return true;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): boolean => {
    // Below threshold (and not yet dragging) we wait; once moved we start, then track the drop
    // target. Clamped zone-local x keeps the indicator inside the source zone.
    const src = dragSourceRef.current;
    if (!src) return false;
    const origin = pointerRef.current?.x ?? e.clientX;
    const dragging = dragStore.getSnapshot().status === "dragging";
    if (!dragging && Math.abs(e.clientX - origin) < DRAG_THRESHOLD) return true;
    // Past the threshold: track the LIVE pointer so the auto-scroll tick reads the current edge.
    pointerRef.current = { x: e.clientX, y: e.clientY };
    const zl = layoutFor(src.zone);
    const zoneX = zoneLocalXFor(src.zone, e.clientX);
    const { index, indicatorX } = dropIndexAtX(
      zl.offsets,
      zl.widths,
      zoneX,
      src.bounds
    );
    if (dragging) dragStore.updateTarget(index, indicatorX);
    else {
      dragStore.start({
        sourceColumnId: src.columnId,
        sourceZone: src.zone,
        sourceIndex: src.sourceIndex,
        targetIndex: index,
        indicatorX,
      });
      // Only center columns can reach off-screen targets.
      if (src.zone === "center" && dragScrollRef.current == null) {
        dragScrollRef.current = requestAnimationFrame(dragScrollTick);
      }
    }
    return true;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): boolean => {
    // On drop, emit the new order (within-zone). A press that never crossed the threshold leaves
    // the store idle — treat it as a plain header click (no reorder).
    const src = dragSourceRef.current;
    if (!src) return false;
    dragSourceRef.current = null;
    if (dragScrollRef.current != null) {
      cancelAnimationFrame(dragScrollRef.current);
      dragScrollRef.current = null;
    }
    scrollRef.current?.releasePointerCapture(e.pointerId);
    if (scrollRef.current) scrollRef.current.style.cursor = ""; // restore hover grab
    const snap = dragStore.getSnapshot();
    if (snap.status === "dragging") {
      const next = reorderWithinZone(
        columnOrder,
        snap.sourceColumnId,
        snap.targetIndex,
        (id) => placementMap.get(id)?.zone
      );
      dragStore.end();
      if (next !== columnOrder) onColumnOrderChange?.(next); // same ref ⇒ drop onto self ⇒ no-op
    }
    return true;
  };

  // Safety net: if pointer capture is lost WITHOUT a pointerup — e.g. a pointercancel, or the OS
  // stealing the pointer — make sure the imperative `grabbing` cursor and the drag state don't get
  // stuck. Idempotent on the normal release path (state already cleared).
  const onLostPointerCapture = () => {
    if (scrollRef.current) scrollRef.current.style.cursor = "";
    if (dragScrollRef.current != null) {
      cancelAnimationFrame(dragScrollRef.current);
      dragScrollRef.current = null;
    }
    if (dragSourceRef.current) {
      dragSourceRef.current = null;
      dragStore.end();
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp, onLostPointerCapture };
}
