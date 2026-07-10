import type { Column } from "../core/types";
import type { Direction } from "../core/selection/geometry";
import { DEFAULT_COL_WIDTH } from "./constants";

export interface ZoneLayout {
  widths: number[];
  /** Cumulative start offset of each column within the zone. */
  offsets: number[];
  total: number;
}

// `widthOf` lets callers provide resolved widths; other callers use each column's base width.
export function zoneLayout<T>(
  cols: Column<T>[],
  widthOf: (col: Column<T>) => number = (c) => c.width ?? DEFAULT_COL_WIDTH,
): ZoneLayout {
  const widths = cols.map(widthOf);
  const offsets = new Array<number>(widths.length);
  let acc = 0;
  for (let i = 0; i < widths.length; i++) {
    offsets[i] = acc;
    acc += widths[i];
  }
  return { widths, offsets, total: acc };
}

/** Index of the column whose slot contains local x (clamps to the last column past the end). */
export function colIndexAtX(offsets: number[], x: number): number {
  if (offsets.length === 0) return -1;
  let lo = 0;
  let hi = offsets.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= x) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export const clampNum = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

export const ARROW_DIR: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};
