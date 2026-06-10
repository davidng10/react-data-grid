import type { RefObject } from "react";
import type { CellCoord, Column, ColumnId } from "../core/types";
import type { Zone } from "../core/selection/geometry";
import { colIndexAtX, clampNum } from "../internal/layout";
import type { ZoneLayout } from "../internal/layout";
import { RESIZE_HANDLE_WIDTH } from "../internal/constants";
import type { GridLayout } from "./useGridLayout";

export interface GridGeometryHelpers<T> {
  hitTest: (clientX: number, clientY: number) => CellCoord | null;
  headerHitTest: (
    clientX: number,
    clientY: number,
  ) => { columnId: ColumnId; zone: Zone; sourceIndex: number } | null;
  /** Map a header-strip point near a column's right boundary to that column's resize handle (D12). */
  headerResizeHitTest: (
    clientX: number,
    clientY: number,
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
  rows: T[];
  rowHeight: number;
}): GridGeometryHelpers<T> {
  const { scrollRef, layout, rows, rowHeight } = args;
  const { zones, left, center, right, gutterW, leftBand, columnOrder, placementMap } = layout;

  // Map a viewport point to a cell. Zone is chosen by screen band (the gutter + frozen zones are
  // pinned to the viewport edges); the header strip and the gutter return null (not selectable).
  // Row/column clamp to the grid edges so a drag past the edge still resolves to the last cell.
  const hitTest = (clientX: number, clientY: number): CellCoord | null => {
    const el = scrollRef.current;
    if (!el || columnOrder.length === 0) return null;
    const rect = el.getBoundingClientRect();

    const vpY = clientY - rect.top;
    if (vpY < rowHeight) return null; // over the sticky header
    const rowIndex = clampNum(
      Math.floor((vpY - rowHeight + el.scrollTop) / rowHeight),
      0,
      rows.length - 1,
    );

    const localX = clientX - rect.left;
    const viewportW = el.clientWidth;
    if (gutterW > 0 && localX < gutterW) return null; // over the checkbox gutter

    let cols: Column<T>[];
    let offsets: number[];
    let zoneX: number;
    if (left.total > 0 && localX < leftBand) {
      cols = zones.left;
      offsets = left.offsets;
      zoneX = localX - gutterW;
    } else if (right.total > 0 && localX >= viewportW - right.total) {
      cols = zones.right;
      offsets = right.offsets;
      zoneX = localX - (viewportW - right.total);
    } else {
      cols = zones.center;
      offsets = center.offsets;
      zoneX = localX - leftBand + el.scrollLeft;
    }
    if (cols.length === 0) return null;
    const i = colIndexAtX(offsets, zoneX);
    if (i < 0) return null;
    const col = cols[i];
    // Action columns are non-selectable — a click there isn't a cell hit (no focus/drag/auto-scroll),
    // so interactive content inside handles its own clicks with no extra wiring.
    if (!col || col.type === "action") return null;
    return { rowIndex, columnId: col.id };
  };

  // Map a viewport point in the HEADER strip to the header it's over (P7). Mirrors `hitTest`'s
  // zone-band detection (for `vpY < rowHeight`, the header strip) AND its `type: 'action'`
  // exclusion: an action column is a pure UI affordance (D10), so the grid skips it for every
  // interaction — drag-reorder included (grabbing a button column to sort it is meaningless).
  const headerHitTest = (
    clientX: number,
    clientY: number,
  ): { columnId: ColumnId; zone: Zone; sourceIndex: number } | null => {
    const el = scrollRef.current;
    if (!el || columnOrder.length === 0) return null;
    const rect = el.getBoundingClientRect();

    const vpY = clientY - rect.top;
    if (vpY < 0 || vpY >= rowHeight) return null; // only the header strip

    const localX = clientX - rect.left;
    const viewportW = el.clientWidth;
    if (gutterW > 0 && localX < gutterW) return null; // over the checkbox gutter

    let cols: Column<T>[];
    let offsets: number[];
    let zoneX: number;
    let zone: Zone;
    if (left.total > 0 && localX < leftBand) {
      cols = zones.left;
      offsets = left.offsets;
      zoneX = localX - gutterW;
      zone = "left";
    } else if (right.total > 0 && localX >= viewportW - right.total) {
      cols = zones.right;
      offsets = right.offsets;
      zoneX = localX - (viewportW - right.total);
      zone = "right";
    } else {
      cols = zones.center;
      offsets = center.offsets;
      zoneX = localX - leftBand + el.scrollLeft;
      zone = "center";
    }
    if (cols.length === 0) return null;
    const i = colIndexAtX(offsets, zoneX);
    const col = cols[i];
    if (!col || col.type === "action") return null;
    return { columnId: col.id, zone, sourceIndex: i };
  };

  // Map a header-strip point to a column resize handle (D12): the pointer must be within
  // RESIZE_HANDLE_WIDTH of a column's RIGHT boundary, and a boundary belongs to the column on its
  // LEFT — that's the one a drag resizes. Mirrors `headerHitTest`'s zone banding (only the center
  // adds `scrollLeft`). `type: 'action'` / `resizable: false` columns are inert (no handle), exactly
  // as they're inert for reorder.
  const headerResizeHitTest = (clientX: number, clientY: number) => {
    const el = scrollRef.current;
    if (!el || columnOrder.length === 0) return null;
    const rect = el.getBoundingClientRect();

    const vpY = clientY - rect.top;
    if (vpY < 0 || vpY >= rowHeight) return null; // only the header strip

    const localX = clientX - rect.left;
    const viewportW = el.clientWidth;
    if (gutterW > 0 && localX < gutterW) return null; // over the checkbox gutter

    let cols: Column<T>[];
    let zl: ZoneLayout;
    let zoneX: number;
    let zone: Zone;
    if (left.total > 0 && localX < leftBand) {
      cols = zones.left;
      zl = left;
      zoneX = localX - gutterW;
      zone = "left";
    } else if (right.total > 0 && localX >= viewportW - right.total) {
      cols = zones.right;
      zl = right;
      zoneX = localX - (viewportW - right.total);
      zone = "right";
    } else {
      cols = zones.center;
      zl = center;
      zoneX = localX - leftBand + el.scrollLeft;
      zone = "center";
    }
    if (cols.length === 0) return null;

    // The pointer can sit just inside the column whose right edge it's near, or just past that
    // boundary in the next column — so test the column containing zoneX and its left neighbour.
    const i = colIndexAtX(zl.offsets, zoneX);
    for (const c of [i, i - 1]) {
      if (c < 0 || c >= cols.length) continue;
      const boundaryX = zl.offsets[c] + zl.widths[c];
      if (Math.abs(zoneX - boundaryX) <= RESIZE_HANDLE_WIDTH) {
        const col = cols[c];
        if (!col || col.type === "action" || col.resizable === false) return null;
        return { columnId: col.id, zone, localIndex: c, startWidth: zl.widths[c], boundaryX };
      }
    }
    return null;
  };

  // The ZoneLayout for a zone (offsets/widths/total) — drives the drop-index geometry.
  const layoutFor = (zone: Zone) =>
    zone === "left" ? left : zone === "right" ? right : center;

  // The zone's columns (for barrier detection during a drag).
  const zoneColsFor = (zone: Zone) =>
    zone === "left" ? zones.left : zone === "right" ? zones.right : zones.center;

  // A clientX → zone-local x for `zone`, clamped to the zone so a pointer that wanders into another
  // band pins to the source zone's nearest edge (this is what keeps reorder WITHIN-zone, D5).
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
      if (colLeft < el.scrollLeft + leftBand) el.scrollLeft = colLeft - leftBand;
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
