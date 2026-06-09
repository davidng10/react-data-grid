// Selection geometry (DECISIONS.md D6, D8) — pure, DOM-free, unit-tested.
//
// Two jobs, both pure arithmetic:
//   1. `stepCoord` — keyboard navigation: move/clamp the focused cell, with `toEdge` for the
//      Cmd/Ctrl+arrow jump-to-edge semantics (R6).
//   2. `rangeToZoneRects` / `cellToZoneRect` — turn a CellRange (or a single cell) into the
//      overlay rectangles that draw it: up to one rectangle per zone the range spans (D5), each
//      in that zone's LOCAL coordinate space (the same coords the cells use, so the overlay
//      lines up without knowing about scroll). Vertical extent is `rowIndex * rowHeight` thanks
//      to uniform row height (D8) — no prefix-sum needed for rows.

import type { CellCoord, ColumnId } from '../types/ids'
import type { CellRange } from '../types/selection'

export type Zone = 'left' | 'center' | 'right'
export type Direction = 'up' | 'down' | 'left' | 'right'

/** Where a column sits, in its own zone's local coordinate space. */
export interface ColumnPlacement {
  zone: Zone
  /** Cumulative x offset within the zone — matches the cell's `translateX`. */
  offset: number
  width: number
  /** Index in the visual column order: `[...left, ...center, ...right]`. */
  visualIndex: number
}

export interface GridGeometry {
  rowCount: number
  rowHeight: number
  /** Column ids in visual order. */
  columnOrder: ColumnId[]
  /** Placement lookup by column id (undefined if the id is unknown). */
  placement: (columnId: ColumnId) => ColumnPlacement | undefined
}

/** A rectangle to draw inside one zone's overlay layer (zone-local coords). */
export interface ZoneRect {
  zone: Zone
  x: number
  y: number
  width: number
  height: number
}

const ZONE_ORDER: Zone[] = ['left', 'center', 'right']

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** Next focused cell after an arrow key. `toEdge` = Cmd/Ctrl+arrow jump to the grid edge (R6). */
export function stepCoord(
  focus: CellCoord,
  dir: Direction,
  geom: GridGeometry,
  toEdge = false,
): CellCoord {
  if (dir === 'up' || dir === 'down') {
    const last = Math.max(0, geom.rowCount - 1)
    const next =
      dir === 'up'
        ? toEdge
          ? 0
          : focus.rowIndex - 1
        : toEdge
          ? last
          : focus.rowIndex + 1
    return { rowIndex: clamp(next, 0, last), columnId: focus.columnId }
  }

  const lastCol = Math.max(0, geom.columnOrder.length - 1)
  const cur = geom.columnOrder.indexOf(focus.columnId)
  const base = cur < 0 ? 0 : cur
  const next =
    dir === 'left'
      ? toEdge
        ? 0
        : base - 1
      : toEdge
        ? lastCol
        : base + 1
  return { rowIndex: focus.rowIndex, columnId: geom.columnOrder[clamp(next, 0, lastCol)] }
}

/**
 * The 1–4 overlay rectangles for a range. Each zone is a contiguous block of the visual order
 * and the selected columns are a contiguous visual run, so a zone's selected columns are
 * themselves contiguous — one rectangle each, from the min offset to the max (offset + width).
 */
export function rangeToZoneRects(range: CellRange, geom: GridGeometry): ZoneRect[] {
  const a = geom.placement(range.anchor.columnId)
  const f = geom.placement(range.focus.columnId)
  if (!a || !f) return []

  const minRow = Math.min(range.anchor.rowIndex, range.focus.rowIndex)
  const maxRow = Math.max(range.anchor.rowIndex, range.focus.rowIndex)
  const y = minRow * geom.rowHeight
  const height = (maxRow - minRow + 1) * geom.rowHeight

  const minIdx = Math.min(a.visualIndex, f.visualIndex)
  const maxIdx = Math.max(a.visualIndex, f.visualIndex)

  const spans = new Map<Zone, { min: number; max: number }>()
  for (let i = minIdx; i <= maxIdx; i++) {
    const p = geom.placement(geom.columnOrder[i])
    if (!p) continue
    const lo = p.offset
    const hi = p.offset + p.width
    const span = spans.get(p.zone)
    if (!span) spans.set(p.zone, { min: lo, max: hi })
    else {
      span.min = Math.min(span.min, lo)
      span.max = Math.max(span.max, hi)
    }
  }

  const rects: ZoneRect[] = []
  for (const zone of ZONE_ORDER) {
    const span = spans.get(zone)
    if (span) rects.push({ zone, x: span.min, y, width: span.max - span.min, height })
  }
  return rects
}

/** Single-cell rectangle (for the focus outline), in its zone's local coords. */
export function cellToZoneRect(cell: CellCoord, geom: GridGeometry): ZoneRect | null {
  const p = geom.placement(cell.columnId)
  if (!p) return null
  return {
    zone: p.zone,
    x: p.offset,
    y: cell.rowIndex * geom.rowHeight,
    width: p.width,
    height: geom.rowHeight,
  }
}
