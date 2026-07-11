import { resolveColumnCapabilities } from "../internal/column-capabilities";
import { RESIZE_HANDLE_WIDTH } from "../internal/constants";
import { clampNum, colIndexAtX } from "../internal/layout";

import type { RefObject } from "react";
import type { Zone } from "../core/selection/geometry";
import type { CellCoord, Column, ColumnId } from "../core/types";
import type { ZoneLayout } from "../internal/layout";
import type { GridLayout } from "./useGridLayout";

export interface GridGeometryHelpers<T> {
  hitTest: (clientX: number, clientY: number) => CellCoord | null;
  headerHitTest: (
    clientX: number,
    clientY: number
  ) => { columnId: ColumnId; zone: Zone; sourceIndex: number } | null;
  /** Map a point near a header's right edge to its resize handle. */
  headerResizeHitTest: (
    clientX: number,
    clientY: number
  ) => {
    columnId: ColumnId;
    zone: Zone;
    localIndex: number;
    /** The column's current width (the resize start width). */
    startWidth: number;
    /** Zone-local x of the column's right boundary (the initial guide-line position). */
    boundaryX: number;
  } | null;
  layoutFor: (zone: Zone) => ZoneLayout;
  zoneColsFor: (zone: Zone) => Column<T>[];
  zoneLocalXFor: (zone: Zone, clientX: number) => number;
  scrollCellIntoView: (cell: CellCoord) => void;
}

// Live-DOM geometry readers shared by the interaction hooks: map viewport points to cells/headers,
// resolve per-zone layout/columns/local-x, and scroll a cell into view past the pinned chrome. These
// close over the live `scrollRef` + `layout` and are intentionally recreated each render (no memo),
// so every gesture reads the current scroll position and column placement.
export function useGridGeometryHelpers<T>(args: {
  scrollRef: RefObject<HTMLDivElement | null>;
  layout: GridLayout<T>;
  rows: readonly T[];
  rowHeight: number;
}): GridGeometryHelpers<T> {
  const { scrollRef, layout, rows, rowHeight } = args;
  const {
    zones,
    left,
    center,
    right,
    gutterW,
    leftBand,
    columnOrder,
    placementMap,
  } = layout;

  // Which zone a viewport-local x falls in, plus that zone's columns, layout, and the zone-local x.
  // The single source of truth for the gutter/left/center/right banding shared by hitTest,
  // headerHitTest, and headerResizeHitTest — a band-boundary or scroll-offset fix lands here once.
  // Returns null over the checkbox gutter or for an empty zone (neither is a hit).
  const resolveZone = (
    localX: number,
    viewportW: number,
    scrollLeft: number
  ): {
    zone: Zone;
    cols: Column<T>[];
    zl: ZoneLayout;
    zoneX: number;
  } | null => {
    if (gutterW > 0 && localX < gutterW) return null; // over the checkbox gutter
    let zone: Zone;
    let cols: Column<T>[];
    let zl: ZoneLayout;
    let zoneX: number;
    if (left.total > 0 && localX < leftBand) {
      zone = "left";
      cols = zones.left;
      zl = left;
      zoneX = localX - gutterW;
    } else if (right.total > 0 && localX >= viewportW - right.total) {
      zone = "right";
      cols = zones.right;
      zl = right;
      zoneX = localX - (viewportW - right.total);
    } else {
      zone = "center";
      cols = zones.center;
      zl = center;
      zoneX = localX - leftBand + scrollLeft;
    }
    if (cols.length === 0) return null;
    return { zone, cols, zl, zoneX };
  };

  // Map a viewport point to a cell. Zone is chosen by `resolveZone`'s screen banding; the header strip
  // and the gutter return null (not selectable). Row/column clamp to the grid edges so a drag past the
  // edge still resolves to the last cell.
  const hitTest = (clientX: number, clientY: number): CellCoord | null => {
    const el = scrollRef.current;
    if (!el || columnOrder.length === 0) return null;
    const rect = el.getBoundingClientRect();

    const vpY = clientY - rect.top;
    if (vpY < rowHeight) return null; // over the sticky header
    const rowIndex = clampNum(
      Math.floor((vpY - rowHeight + el.scrollTop) / rowHeight),
      0,
      rows.length - 1
    );

    const r = resolveZone(clientX - rect.left, el.clientWidth, el.scrollLeft);
    if (!r) return null;
    const i = colIndexAtX(r.zl.offsets, r.zoneX);
    if (i < 0) return null;
    const col = r.cols[i];
    // Non-selectable columns aren't cell hits (no focus/drag/auto-scroll),
    // so interactive content inside handles its own clicks with no extra wiring.
    if (!col || !resolveColumnCapabilities(col).selectable) return null;
    return { rowIndex, columnId: col.id };
  };

  // Non-reorderable columns are excluded from the header drag hit area.
  const headerHitTest = (
    clientX: number,
    clientY: number
  ): { columnId: ColumnId; zone: Zone; sourceIndex: number } | null => {
    const el = scrollRef.current;
    if (!el || columnOrder.length === 0) return null;
    const rect = el.getBoundingClientRect();

    const vpY = clientY - rect.top;
    if (vpY < 0 || vpY >= rowHeight) return null; // only the header strip

    const r = resolveZone(clientX - rect.left, el.clientWidth, el.scrollLeft);
    if (!r) return null;
    const i = colIndexAtX(r.zl.offsets, r.zoneX);
    const col = r.cols[i];
    if (!col || !resolveColumnCapabilities(col).reorderable) return null;
    return { columnId: col.id, zone: r.zone, sourceIndex: i };
  };

  // A resize boundary belongs to the column on its left. Action and non-resizable columns are
  // excluded.
  const headerResizeHitTest = (clientX: number, clientY: number) => {
    const el = scrollRef.current;
    if (!el || columnOrder.length === 0) return null;
    const rect = el.getBoundingClientRect();

    const vpY = clientY - rect.top;
    if (vpY < 0 || vpY >= rowHeight) return null; // only the header strip

    const r = resolveZone(clientX - rect.left, el.clientWidth, el.scrollLeft);
    if (!r) return null;
    const { cols, zl, zone, zoneX } = r;

    // The pointer can sit just inside the column whose right edge it's near, or just past that
    // boundary in the next column — so test the column containing zoneX and its left neighbour.
    const i = colIndexAtX(zl.offsets, zoneX);
    for (const c of [i, i - 1]) {
      if (c < 0 || c >= cols.length) continue;
      const boundaryX = zl.offsets[c] + zl.widths[c];
      if (Math.abs(zoneX - boundaryX) <= RESIZE_HANDLE_WIDTH) {
        const col = cols[c];
        if (!col || !resolveColumnCapabilities(col).resizable) return null;
        return {
          columnId: col.id,
          zone,
          localIndex: c,
          startWidth: zl.widths[c],
          boundaryX,
        };
      }
    }
    return null;
  };

  // The ZoneLayout for a zone (offsets/widths/total) — drives the drop-index geometry.
  const layoutFor = (zone: Zone) =>
    zone === "left" ? left : zone === "right" ? right : center;

  // The zone's columns (for barrier detection during a drag).
  const zoneColsFor = (zone: Zone) =>
    zone === "left"
      ? zones.left
      : zone === "right"
        ? zones.right
        : zones.center;

  // A clientX → zone-local x for `zone`, clamped to the zone so a pointer that wanders into another
  // band pins to the source zone's nearest edge, keeping reorder within the zone.
  const zoneLocalXFor = (zone: Zone, clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const localX = clientX - el.getBoundingClientRect().left;
    const z = layoutFor(zone);
    if (zone === "left") return clampNum(localX - gutterW, 0, z.total);
    if (zone === "right")
      return clampNum(localX - (el.clientWidth - right.total), 0, z.total);
    return clampNum(localX - leftBand + el.scrollLeft, 0, z.total);
  };

  // Scroll a cell fully into view, accounting for the pinned chrome the virtualizer can't see:
  // the sticky header (top `rowHeight`) and the gutter + frozen bands (left/right). Setting
  // scrollTop/scrollLeft drives the virtualizer, which re-renders the windowed body.
  const scrollCellIntoView = (cell: CellCoord) => {
    const el = scrollRef.current;
    if (!el) return;

    const rowTop = rowHeight + cell.rowIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < el.scrollTop + rowHeight) el.scrollTop = rowTop - rowHeight;
    else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowBottom - el.clientHeight;
    }

    const p = placementMap.get(cell.columnId);
    if (p && p.zone === "center") {
      const colLeft = leftBand + p.offset;
      const colRight = colLeft + p.width;
      if (colLeft < el.scrollLeft + leftBand)
        el.scrollLeft = colLeft - leftBand;
      else if (colRight > el.scrollLeft + el.clientWidth - right.total) {
        el.scrollLeft = colRight - el.clientWidth + right.total;
      }
    }
  };

  return {
    hitTest,
    headerHitTest,
    headerResizeHitTest,
    layoutFor,
    zoneColsFor,
    zoneLocalXFor,
    scrollCellIntoView,
  };
}
