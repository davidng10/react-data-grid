// Pure geometry for keyboard navigation, selection overlays, and column reordering.

import type { CellCoord, ColumnId } from "../types/ids";
import type { CellRange } from "../types/selection";

export type Zone = "left" | "center" | "right";
export type Direction = "up" | "down" | "left" | "right";

/** Where a column sits, in its own zone's local coordinate space. */
export interface ColumnPlacement {
  zone: Zone;
  /** Cumulative x offset within the zone — matches the cell's `translateX`. */
  offset: number;
  width: number;
  /** Index in the visual column order: `[...left, ...center, ...right]`. */
  visualIndex: number;
  /** False for non-selectable columns (`type: 'action'`); keyboard nav skips them. Default true. */
  selectable?: boolean;
}

export interface GridGeometry {
  rowCount: number;
  rowHeight: number;
  /** Column ids in visual order. */
  columnOrder: ColumnId[];
  /** Placement lookup by column id (undefined if the id is unknown). */
  placement: (columnId: ColumnId) => ColumnPlacement | undefined;
}

/** A rectangle to draw inside one zone's overlay layer (zone-local coords). */
export interface ZoneRect {
  zone: Zone;
  x: number;
  y: number;
  width: number;
  height: number;
}

const ZONE_ORDER: Zone[] = ["left", "center", "right"];

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/** Next focused cell after an arrow key. `toEdge` jumps to the grid edge. */
export function stepCoord(
  focus: CellCoord,
  dir: Direction,
  geom: GridGeometry,
  toEdge = false
): CellCoord {
  if (dir === "up" || dir === "down") {
    const last = Math.max(0, geom.rowCount - 1);
    const next =
      dir === "up"
        ? toEdge
          ? 0
          : focus.rowIndex - 1
        : toEdge
          ? last
          : focus.rowIndex + 1;
    return { rowIndex: clamp(next, 0, last), columnId: focus.columnId };
  }

  const lastCol = Math.max(0, geom.columnOrder.length - 1);
  const cur = geom.columnOrder.indexOf(focus.columnId);
  const base = cur < 0 ? 0 : cur;
  const step = dir === "right" ? 1 : -1;

  // A column is selectable unless its placement says otherwise (`type: 'action'`). Skip those so
  // keyboard nav never lands focus on a non-selectable cell.
  const selectable = (i: number) => {
    const p = geom.placement(geom.columnOrder[i]);
    return !p || p.selectable !== false;
  };
  const scanFrom = (start: number, st: number) => {
    for (let i = start; i >= 0 && i <= lastCol; i += st)
      if (selectable(i)) return i;
    return -1;
  };

  // Normal movement selects the next eligible column; `toEdge` starts from the far edge.
  let target = toEdge
    ? scanFrom(step > 0 ? lastCol : 0, -step)
    : scanFrom(base + step, step);
  if (target < 0) target = base;
  return {
    rowIndex: focus.rowIndex,
    columnId: geom.columnOrder[clamp(target, 0, lastCol)],
  };
}

/**
 * The 1–4 overlay rectangles for a range. Each zone is a contiguous block of the visual order
 * and the selected columns are a contiguous visual run, so a zone's selected columns are
 * themselves contiguous — one rectangle each, from the min offset to the max (offset + width).
 */
export function rangeToZoneRects(
  range: CellRange,
  geom: GridGeometry
): ZoneRect[] {
  const a = geom.placement(range.anchor.columnId);
  const f = geom.placement(range.focus.columnId);
  if (!a || !f) return [];

  const minRow = Math.min(range.anchor.rowIndex, range.focus.rowIndex);
  const maxRow = Math.max(range.anchor.rowIndex, range.focus.rowIndex);
  const y = minRow * geom.rowHeight;
  const height = (maxRow - minRow + 1) * geom.rowHeight;

  const minIdx = Math.min(a.visualIndex, f.visualIndex);
  const maxIdx = Math.max(a.visualIndex, f.visualIndex);

  const spans = new Map<Zone, { min: number; max: number }>();
  for (let i = minIdx; i <= maxIdx; i++) {
    const p = geom.placement(geom.columnOrder[i]);
    if (!p) continue;
    const lo = p.offset;
    const hi = p.offset + p.width;
    const span = spans.get(p.zone);
    if (!span) spans.set(p.zone, { min: lo, max: hi });
    else {
      span.min = Math.min(span.min, lo);
      span.max = Math.max(span.max, hi);
    }
  }

  const rects: ZoneRect[] = [];
  for (const zone of ZONE_ORDER) {
    const span = spans.get(zone);
    if (span)
      rects.push({ zone, x: span.min, y, width: span.max - span.min, height });
  }
  return rects;
}

/** Single-cell rectangle (for the focus outline), in its zone's local coords. */
export function cellToZoneRect(
  cell: CellCoord,
  geom: GridGeometry
): ZoneRect | null {
  const p = geom.placement(cell.columnId);
  if (!p) return null;
  return {
    zone: p.zone,
    x: p.offset,
    y: cell.rowIndex * geom.rowHeight,
    width: p.width,
    height: geom.rowHeight,
  };
}

/**
 * Live layout snapshot of the scroll container, in pixels. Everything the viewport math needs
 * that GridGeometry doesn't carry (it's read from the DOM each reposition).
 */
export interface ViewportInfo {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
  /** Checkbox gutter width (0 if disabled). */
  gutterW: number;
  /** `gutterW + left.total` — where the center content begins. */
  leftBand: number;
  /** Right frozen zone total width. */
  rightTotal: number;
}

/** A cell rectangle in VIEWPORT coords (relative to the scroll box's top-left). */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the cell overlaps the usable (un-pinned) viewport — used to clamp/hide the editor. */
  visible: boolean;
}

/** Return a cell's viewport rectangle for fixed-position overlays. Only the center zone scrolls. */
export function cellViewportRect(
  cell: CellCoord,
  geom: GridGeometry,
  view: ViewportInfo
): ViewportRect | null {
  const p = geom.placement(cell.columnId);
  if (!p) return null;

  const { rowHeight } = geom;
  // Vertical: the sticky header steals the top `rowHeight`.
  const y = rowHeight + cell.rowIndex * rowHeight - view.scrollTop;
  // Horizontal: only the center adds scrollLeft (frozen zones are pinned).
  let x: number;
  if (p.zone === "left") x = view.gutterW + p.offset;
  else if (p.zone === "right")
    x = view.clientWidth - view.rightTotal + p.offset;
  else x = view.leftBand + p.offset - view.scrollLeft;

  const width = p.width;
  const height = rowHeight;

  // Usable viewport excludes the pinned chrome. A frozen cell is always within its pinned band, so
  // only the center cell can scroll out the left/right under the frozen zones.
  let visible = y + height > rowHeight && y < view.clientHeight;
  if (p.zone === "center") {
    visible =
      visible &&
      x + width > view.leftBand &&
      x < view.clientWidth - view.rightTotal;
  }

  return { x, y, width, height, visible };
}

// Column drag-reorder geometry

/** Resolve a zone-local pointer x to a bounded insertion index and indicator position. */
export function dropIndexAtX(
  offsets: number[],
  widths: number[],
  x: number,
  bounds?: [number, number]
): { index: number; indicatorX: number } {
  const n = offsets.length;
  let index = 0;
  while (index < n && offsets[index] + widths[index] / 2 < x) index++;
  if (bounds) index = clamp(index, bounds[0], bounds[1]);
  const indicatorX = index === 0 ? 0 : offsets[index - 1] + widths[index - 1];
  return { index, indicatorX };
}

/** Return the insertion range bounded by the nearest action columns. */
export function dragBounds(
  isBarrier: boolean[],
  sourceIndex: number
): [number, number] {
  let lo = 0;
  for (let k = sourceIndex - 1; k >= 0; k--) {
    if (isBarrier[k]) {
      lo = k + 1;
      break;
    }
  }
  let hi = isBarrier.length;
  for (let k = sourceIndex + 1; k < isBarrier.length; k++) {
    if (isBarrier[k]) {
      hi = k;
      break;
    }
  }
  return [lo, hi];
}

/** Reorder one zone and return the original array for a no-op. */
export function reorderWithinZone(
  columnOrder: ColumnId[],
  fromId: ColumnId,
  toIndex: number,
  zoneOf: (id: ColumnId) => Zone | undefined
): ColumnId[] {
  const zone = zoneOf(fromId);
  if (zone == null) return columnOrder;

  // The positions in the full array that belong to the source zone (contiguous in practice, but
  // gathered generally so we write the permuted ids back into exactly those slots).
  const positions: number[] = [];
  for (let i = 0; i < columnOrder.length; i++) {
    if (zoneOf(columnOrder[i]) === zone) positions.push(i);
  }
  const slice = positions.map((p) => columnOrder[p]);
  const from = slice.indexOf(fromId);
  if (from < 0) return columnOrder;

  let to = clamp(toIndex, 0, slice.length);
  if (to > from) to -= 1; // removing the source shifts everything after it left by one
  if (to === from) return columnOrder; // no-op — drop onto self

  slice.splice(from, 1);
  slice.splice(to, 0, fromId);

  const next = columnOrder.slice();
  positions.forEach((p, k) => {
    next[p] = slice[k];
  });
  return next;
}
