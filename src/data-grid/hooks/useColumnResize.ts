import { useRef } from "react";

import { MIN_COL_WIDTH } from "../internal/constants";
import { clampNum } from "../internal/layout";

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { Zone } from "../core/selection/geometry";
import type { ResizeStore } from "../core/store/resize-store";
import type { ColumnId } from "../core/types";
import type { GridGeometryHelpers } from "./useGridGeometryHelpers";

export interface ColumnResizeHandlers {
  /** Returns true when the gesture consumed the event (a resize is in progress). */
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => boolean;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => boolean;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => boolean;
  onLostPointerCapture: () => void;
}

// Handles commit-on-release column resizing. Pointer moves update only the guide overlay; committing
// once on release avoids repeatedly laying out the windowed cells.
export function useColumnResize<T>(args: {
  /** Resizing feature gate; off means no gesture or handle. */
  enabled: boolean;
  resizeStore: ResizeStore;
  scrollRef: RefObject<HTMLDivElement | null>;
  helpers: GridGeometryHelpers<T>;
  /** Called once on release with the committed, clamped width. */
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
      src.maxWidth
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
