import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { ColumnId } from "../core/types";
import {
  dragBounds,
  dropIndexAtX,
  reorderWithinZone,
} from "../core/selection/geometry";
import type { Zone } from "../core/selection/geometry";
import type { DragStore } from "../core/store/drag-store";
import { EDGE_ZONE, EDGE_SPEED, DRAG_THRESHOLD } from "../internal/constants";
import type { GridLayout } from "./useGridLayout";
import type { GridGeometryHelpers } from "./useGridGeometryHelpers";

export interface ColumnDragHandlers {
  /** Returns true when the gesture consumed the event (a header-drag is in progress). */
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => boolean;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => boolean;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => boolean;
  onLostPointerCapture: () => void;
}

// Column drag-reorder gesture (P7): header press → threshold → within-zone reorder, with center-zone
// edge auto-scroll. Owns the drag refs + the drag store updates; the windowed body never re-renders
// (D1/D6). Each pointer handler returns a "consumed" flag so the shell can compose it ahead of the
// cell drag-select (header-drag wins). Owns its own `pointerRef` — the two gestures never overlap.
export function useColumnDrag<T>(args: {
  reorderable: boolean;
  dragStore: DragStore;
  scrollRef: RefObject<HTMLDivElement | null>;
  layout: GridLayout<T>;
  helpers: GridGeometryHelpers<T>;
  onColumnOrderChange?: (order: ColumnId[]) => void;
}): ColumnDragHandlers {
  const { reorderable, dragStore, scrollRef, layout, helpers, onColumnOrderChange } = args;
  const { leftBand, right, columnOrder, placementMap } = layout;
  const { headerHitTest, zoneColsFor, layoutFor, zoneLocalXFor } = helpers;

  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  // Separate RAF for the column drag's edge auto-scroll (P7) — horizontal, center-zone only.
  const dragScrollRef = useRef<number | null>(null);
  // The header captured on pointerdown; the drag only starts (and the drag store only flips to
  // `dragging`) once the pointer crosses `DRAG_THRESHOLD`. `bounds` is the insertion range the drag
  // is confined to — it can't cross an `action` barrier column (D10).
  const dragSourceRef = useRef<{
    columnId: ColumnId;
    zone: Zone;
    sourceIndex: number;
    bounds: [number, number];
  } | null>(null);

  // Edge auto-scroll for a CENTER column drag (P7): while the pointer is held near the center band's
  // left/right edge, ramp `scrollLeft` so off-screen columns flow in and become reachable in one
  // gesture. Horizontal only; frozen zones never scroll (all their columns are rendered, D5). Each
  // frame that scrolls also re-derives the drop target — the same pointer maps to a new column once
  // `scrollLeft` moves — so the indicator tracks the columns flowing in. The drop stays clamped to
  // the source's barrier `bounds`, so auto-scroll can't push a column past an `action` column.
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
    const rect = el.getBoundingClientRect();
    const leftLimit = rect.left + leftBand;
    const rightLimit = rect.left + el.clientWidth - right.total;
    let dx = 0;
    if (pt.x < leftLimit + EDGE_ZONE) dx = -EDGE_SPEED;
    else if (pt.x > rightLimit - EDGE_ZONE) dx = EDGE_SPEED;
    if (dx) {
      el.scrollLeft += dx;
      const zl = layoutFor("center");
      const zoneX = zoneLocalXFor("center", pt.x);
      const { index, indicatorX } = dropIndexAtX(
        zl.offsets,
        zl.widths,
        zoneX,
        src.bounds,
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
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): boolean => {
    // Header press → a column drag candidate (P7). Capture the source and the origin, but don't
    // start the drag store yet — wait for the pointer to cross DRAG_THRESHOLD so a plain header
    // click isn't swallowed.
    const header = reorderable ? headerHitTest(e.clientX, e.clientY) : null;
    if (!header) return false;
    // Confine the drag so it can't be pushed past an `action` barrier column (D10). Constant for
    // the gesture (source + zone are fixed), so compute it once here.
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
    // target. Clamped zone-local x keeps the indicator inside the source zone (D5).
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
      src.bounds,
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
      // A center drag can reach off-screen columns — start the edge auto-scroll (D5: frozen
      // zones are fully rendered, so they never need it).
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
        (id) => placementMap.get(id)?.zone,
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
