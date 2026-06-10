import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { ColumnId } from "../core/types";
import type { Zone } from "../core/selection/geometry";
import type { ResizeStore } from "../core/store/resize-store";
import { clampNum } from "../internal/layout";
import { MIN_COL_WIDTH } from "../internal/constants";
import type { GridGeometryHelpers } from "./useGridGeometryHelpers";

export interface ColumnResizeHandlers {
  /** Returns true when the gesture consumed the event (a resize is in progress). */
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => boolean;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => boolean;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => boolean;
  onLostPointerCapture: () => void;
}

// Column resize gesture (P-resize / D12): header-edge press → drag → commit-on-release. The body
// is NEVER on the per-move path — only the guide-line `ResizeOverlay` leaf re-renders while dragging
// (D1/D6); the actual width change is emitted ONCE on pointerup via `onColumnResize`, then the
// consumer feeds the new `column.width` back (one relayout). Each pointer handler returns a
// "consumed" flag so the shell can compose it AHEAD of reorder + drag-select (the edge wins). Owns
// its own ref — the gestures never overlap.
//
// Resize is single-column and commit-on-release, so there's no auto-scroll: the column's left edge
// is fixed for the whole gesture, the new width is `clamp(startWidth + dx, min, max)`, and the
// guide line sits at the prospective right edge (`colOffset + width`, zone-local). The same clamp
// runs in `zoneLayout`, so the committed layout matches the guide.
export function useColumnResize<T>(args: {
  /** Feature gate (`enableColumnResize`); off ⇒ no gesture, no handle. */
  enabled: boolean;
  resizeStore: ResizeStore;
  scrollRef: RefObject<HTMLDivElement | null>;
  helpers: GridGeometryHelpers<T>;
  /** Called once on release with the committed (clamped) width. The shell applies it (uncontrolled
   *  internal state and/or the controlled prop's `onColumnResize`). */
  onCommit: (columnId: ColumnId, width: number) => void;
}): ColumnResizeHandlers {
  const { enabled, resizeStore, scrollRef, helpers, onCommit } = args;
  const { headerResizeHitTest, zoneColsFor } = helpers;

  const sourceRef = useRef<{
    columnId: ColumnId;
    zone: Zone;
    /** Zone-local left edge of the column — fixed for the whole gesture (we drag the right edge). */
    colOffset: number;
    startWidth: number;
    minWidth: number;
    maxWidth: number;
    /** clientX at pointerdown — the drag origin. */
    originX: number;
    /** The live (clamped) width, read on pointerup to commit. */
    width: number;
  } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): boolean => {
    // Feature off ⇒ no gesture, no handle affordance.
    if (!enabled) return false;
    const hit = headerResizeHitTest(e.clientX, e.clientY);
    if (!hit) return false;

    const col = zoneColsFor(hit.zone)[hit.localIndex];
    sourceRef.current = {
      columnId: hit.columnId,
      zone: hit.zone,
      colOffset: hit.boundaryX - hit.startWidth, // left edge = right boundary − width
      startWidth: hit.startWidth,
      minWidth: col?.minWidth ?? MIN_COL_WIDTH,
      maxWidth: col?.maxWidth ?? Infinity,
      originX: e.clientX,
      width: hit.startWidth,
    };
    resizeStore.start({
      columnId: hit.columnId,
      zone: hit.zone,
      indicatorX: hit.boundaryX,
    });
    // Pointer capture redirects the cursor to the capture target (this container), so force
    // `col-resize` for the whole gesture; reset on pointerup. One write covers the drag.
    if (scrollRef.current) scrollRef.current.style.cursor = "col-resize";
    scrollRef.current?.setPointerCapture(e.pointerId);
    return true;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): boolean => {
    const src = sourceRef.current;
    if (!src) return false;
    const width = clampNum(
      src.startWidth + (e.clientX - src.originX),
      src.minWidth,
      src.maxWidth,
    );
    src.width = width;
    resizeStore.setIndicator(src.colOffset + width); // overlay-only: the body never re-renders here
    return true;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): boolean => {
    const src = sourceRef.current;
    if (!src) return false;
    sourceRef.current = null;
    scrollRef.current?.releasePointerCapture(e.pointerId);
    if (scrollRef.current) scrollRef.current.style.cursor = "";
    resizeStore.end();
    // Commit once, only if the width actually changed (a bare click on the handle is a no-op).
    if (src.width !== src.startWidth) onCommit(src.columnId, src.width);
    return true;
  };

  // Safety net mirroring the reorder gesture: a pointercancel / OS-stolen pointer must not leave the
  // `col-resize` cursor or the resize state stuck. Idempotent on the normal release path.
  const onLostPointerCapture = () => {
    if (scrollRef.current) scrollRef.current.style.cursor = "";
    if (sourceRef.current) {
      sourceRef.current = null;
      resizeStore.end();
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp, onLostPointerCapture };
}
