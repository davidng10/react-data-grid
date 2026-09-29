import { describe, expect, it } from "vitest";

import {
  cellToZoneRect,
  cellViewportRect,
  dragBounds,
  dropIndexAtX,
  rangeToZoneRects,
  reorderWithinZone,
  stepCoord,
} from "../../../core/selection/geometry";

import type {
  ColumnPlacement,
  GridGeometry,
  ViewportInfo,
  Zone,
} from "../../../core/selection/geometry";

// A fixture grid: 1 frozen-left col, 3 center cols, 1 frozen-right col.
//   visual order: L0 | C0 C1 C2 | R0
const COLS: Record<string, ColumnPlacement> = {
  L0: { zone: "left", offset: 0, width: 80, visualIndex: 0 },
  C0: { zone: "center", offset: 0, width: 100, visualIndex: 1 },
  C1: { zone: "center", offset: 100, width: 100, visualIndex: 2 },
  C2: { zone: "center", offset: 200, width: 100, visualIndex: 3 },
  R0: { zone: "right", offset: 0, width: 60, visualIndex: 4 },
};

const geom: GridGeometry = {
  rowCount: 10,
  rowHeight: 32,
  columnOrder: ["L0", "C0", "C1", "C2", "R0"],
  placement: (id) => COLS[id],
};

describe("stepCoord", () => {
  it("moves down/up one row, same column", () => {
    expect(stepCoord({ rowIndex: 2, columnId: "C1" }, "down", geom)).toEqual({
      rowIndex: 3,
      columnId: "C1",
    });
    expect(stepCoord({ rowIndex: 2, columnId: "C1" }, "up", geom)).toEqual({
      rowIndex: 1,
      columnId: "C1",
    });
  });

  it("clamps at the top and bottom rows", () => {
    expect(
      stepCoord({ rowIndex: 0, columnId: "C1" }, "up", geom).rowIndex
    ).toBe(0);
    expect(
      stepCoord({ rowIndex: 9, columnId: "C1" }, "down", geom).rowIndex
    ).toBe(9);
  });

  it("toEdge jumps to the first/last row", () => {
    expect(
      stepCoord({ rowIndex: 5, columnId: "C1" }, "up", geom, true).rowIndex
    ).toBe(0);
    expect(
      stepCoord({ rowIndex: 5, columnId: "C1" }, "down", geom, true).rowIndex
    ).toBe(9);
  });

  it("steps columns across zone boundaries in visual order", () => {
    expect(
      stepCoord({ rowIndex: 0, columnId: "C2" }, "right", geom).columnId
    ).toBe("R0"); // center -> right
    expect(
      stepCoord({ rowIndex: 0, columnId: "C0" }, "left", geom).columnId
    ).toBe("L0"); // center -> left
  });

  it("clamps at the first/last column", () => {
    expect(
      stepCoord({ rowIndex: 0, columnId: "L0" }, "left", geom).columnId
    ).toBe("L0");
    expect(
      stepCoord({ rowIndex: 0, columnId: "R0" }, "right", geom).columnId
    ).toBe("R0");
  });

  it("toEdge jumps to the first/last column", () => {
    expect(
      stepCoord({ rowIndex: 0, columnId: "C1" }, "left", geom, true).columnId
    ).toBe("L0");
    expect(
      stepCoord({ rowIndex: 0, columnId: "C1" }, "right", geom, true).columnId
    ).toBe("R0");
  });

  // Non-selectable columns (`type: 'action'`, placement.selectable === false) are skipped.
  const withUnselectable = (col: string): GridGeometry => ({
    ...geom,
    placement: (id) =>
      id === col ? { ...COLS[col], selectable: false } : COLS[id],
  });

  it("skips a non-selectable column when stepping left/right", () => {
    const g = withUnselectable("C1");
    expect(
      stepCoord({ rowIndex: 0, columnId: "C0" }, "right", g).columnId
    ).toBe("C2");
    expect(stepCoord({ rowIndex: 0, columnId: "C2" }, "left", g).columnId).toBe(
      "C0"
    );
  });

  it("stays put when there is no selectable column in that direction", () => {
    const g = withUnselectable("R0");
    expect(
      stepCoord({ rowIndex: 0, columnId: "C2" }, "right", g).columnId
    ).toBe("C2");
  });

  it("toEdge lands on the last selectable column, skipping a trailing action column", () => {
    const g = withUnselectable("R0");
    expect(
      stepCoord({ rowIndex: 0, columnId: "C0" }, "right", g, true).columnId
    ).toBe("C2");
  });
});

describe("rangeToZoneRects", () => {
  it("a single center cell is one center rect", () => {
    const r = rangeToZoneRects(
      {
        anchor: { rowIndex: 2, columnId: "C1" },
        focus: { rowIndex: 2, columnId: "C1" },
      },
      geom
    );
    expect(r).toEqual([
      { zone: "center", x: 100, y: 64, width: 100, height: 32 },
    ]);
  });

  it("a center-only span is one rect spanning the columns and rows", () => {
    const r = rangeToZoneRects(
      {
        anchor: { rowIndex: 1, columnId: "C0" },
        focus: { rowIndex: 3, columnId: "C2" },
      },
      geom
    );
    expect(r).toEqual([
      { zone: "center", x: 0, y: 32, width: 300, height: 96 },
    ]);
  });

  it("a left→center span splits into one rect per zone", () => {
    const r = rangeToZoneRects(
      {
        anchor: { rowIndex: 0, columnId: "L0" },
        focus: { rowIndex: 0, columnId: "C1" },
      },
      geom
    );
    expect(r).toEqual([
      { zone: "left", x: 0, y: 0, width: 80, height: 32 },
      { zone: "center", x: 0, y: 0, width: 200, height: 32 },
    ]);
  });

  it("a full-width span is three rects (one per zone)", () => {
    const r = rangeToZoneRects(
      {
        anchor: { rowIndex: 0, columnId: "L0" },
        focus: { rowIndex: 0, columnId: "R0" },
      },
      geom
    );
    expect(r).toEqual([
      { zone: "left", x: 0, y: 0, width: 80, height: 32 },
      { zone: "center", x: 0, y: 0, width: 300, height: 32 },
      { zone: "right", x: 0, y: 0, width: 60, height: 32 },
    ]);
  });

  it("normalizes a reversed anchor/focus to the same rects", () => {
    const forward = rangeToZoneRects(
      {
        anchor: { rowIndex: 1, columnId: "C0" },
        focus: { rowIndex: 3, columnId: "C2" },
      },
      geom
    );
    const reversed = rangeToZoneRects(
      {
        anchor: { rowIndex: 3, columnId: "C2" },
        focus: { rowIndex: 1, columnId: "C0" },
      },
      geom
    );
    expect(reversed).toEqual(forward);
  });

  it("returns no rects when a column id is unknown", () => {
    const r = rangeToZoneRects(
      {
        anchor: { rowIndex: 0, columnId: "ZZ" },
        focus: { rowIndex: 0, columnId: "C0" },
      },
      geom
    );
    expect(r).toEqual([]);
  });
});

describe("cellToZoneRect", () => {
  it("maps a cell to a single zone-local rect", () => {
    expect(cellToZoneRect({ rowIndex: 2, columnId: "C1" }, geom)).toEqual({
      zone: "center",
      x: 100,
      y: 64,
      width: 100,
      height: 32,
    });
    expect(cellToZoneRect({ rowIndex: 0, columnId: "R0" }, geom)).toEqual({
      zone: "right",
      x: 0,
      y: 0,
      width: 60,
      height: 32,
    });
  });

  it("returns null for an unknown column", () => {
    expect(cellToZoneRect({ rowIndex: 0, columnId: "ZZ" }, geom)).toBeNull();
  });
});

describe("cellViewportRect", () => {
  // gutter 40, left zone 80 -> leftBand 120; right zone 60; 500x320 viewport (~10 rows).
  const baseView: ViewportInfo = {
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 500,
    clientHeight: 320,
    gutterW: 40,
    leftBand: 120,
    rightTotal: 60,
  };

  it("places a center cell after the left band and subtracts scrollLeft", () => {
    expect(
      cellViewportRect({ rowIndex: 2, columnId: "C1" }, geom, baseView)
    ).toEqual({
      x: 220, // leftBand 120 + offset 100 - scrollLeft 0
      y: 96, // header 32 + row 2 * 32
      width: 100,
      height: 32,
      visible: true,
    });
    expect(
      cellViewportRect({ rowIndex: 2, columnId: "C1" }, geom, {
        ...baseView,
        scrollLeft: 50,
      })!.x
    ).toBe(170);
  });

  it("pins frozen zones — scrollLeft does not move them", () => {
    const scrolled = { ...baseView, scrollLeft: 300 };
    expect(
      cellViewportRect({ rowIndex: 0, columnId: "L0" }, geom, scrolled)
    ).toMatchObject({
      x: 40, // gutterW + offset 0
      visible: true,
    });
    expect(
      cellViewportRect({ rowIndex: 0, columnId: "R0" }, geom, scrolled)
    ).toMatchObject({
      x: 440, // clientWidth 500 - rightTotal 60 + offset 0
      visible: true,
    });
  });

  it("row position tracks scrollTop", () => {
    expect(
      cellViewportRect({ rowIndex: 5, columnId: "C0" }, geom, {
        ...baseView,
        scrollTop: 64,
      })!.y
    ).toBe(32 + 5 * 32 - 64);
  });

  it("marks a cell scrolled under the sticky header as not visible", () => {
    const r = cellViewportRect({ rowIndex: 0, columnId: "C0" }, geom, {
      ...baseView,
      scrollTop: 40,
    });
    expect(r?.y).toBe(-8);
    expect(r?.visible).toBe(false);
  });

  it("marks a center cell scrolled under the frozen-left band as not visible", () => {
    const r = cellViewportRect({ rowIndex: 0, columnId: "C0" }, geom, {
      ...baseView,
      scrollLeft: 200,
    });
    expect(r?.visible).toBe(false); // x+width (20) is left of leftBand (120)
  });

  it("returns null for an unknown column", () => {
    expect(
      cellViewportRect({ rowIndex: 0, columnId: "ZZ" }, geom, baseView)
    ).toBeNull();
  });
});

describe("dropIndexAtX", () => {
  // Three 100px-wide columns: offsets [0,100,200], boundaries at 0/100/200/300, midpoints 50/150/250.
  const offsets = [0, 100, 200];
  const widths = [100, 100, 100];

  it("inserts before the first column when left of its midpoint", () => {
    expect(dropIndexAtX(offsets, widths, 40)).toEqual({
      index: 0,
      indicatorX: 0,
    });
  });

  it("inserts after a column once past its midpoint", () => {
    expect(dropIndexAtX(offsets, widths, 60)).toEqual({
      index: 1,
      indicatorX: 100,
    });
    expect(dropIndexAtX(offsets, widths, 160)).toEqual({
      index: 2,
      indicatorX: 200,
    });
  });

  it("inserts at the end (trailing boundary = total) past the last midpoint", () => {
    expect(dropIndexAtX(offsets, widths, 260)).toEqual({
      index: 3,
      indicatorX: 300,
    });
  });

  it("clamps to the end far past the last column", () => {
    expect(dropIndexAtX(offsets, widths, 9999)).toEqual({
      index: 3,
      indicatorX: 300,
    });
  });

  it("an empty zone is { index: 0, indicatorX: 0 }", () => {
    expect(dropIndexAtX([], [], 123)).toEqual({ index: 0, indicatorX: 0 });
  });

  it("a single-column zone only resolves to index 0 or 1", () => {
    expect(dropIndexAtX([0], [100], 40)).toEqual({ index: 0, indicatorX: 0 });
    expect(dropIndexAtX([0], [100], 60)).toEqual({ index: 1, indicatorX: 100 });
  });

  it("clamps the index to bounds and pins the indicator at the barrier edge", () => {
    // Two columns; a barrier sits after index 0, so the source may only land at [0,1].
    // A pointer past the second column (raw index 2) clamps to 1, indicator at the boundary (100).
    expect(dropIndexAtX([0, 100], [100, 100], 160, [0, 1])).toEqual({
      index: 1,
      indicatorX: 100,
    });
    // A pointer before everything (raw 0) with a left barrier at [1,2] clamps up to 1.
    expect(dropIndexAtX([0, 100], [100, 100], 40, [1, 2])).toEqual({
      index: 1,
      indicatorX: 100,
    });
  });
});

describe("dragBounds", () => {
  it("no barriers → the whole zone is in range", () => {
    expect(dragBounds([false, false, false], 1)).toEqual([0, 3]);
  });

  it("a trailing barrier caps the high bound (can’t cross to its right)", () => {
    // [data, data, action]; dragging either data column can reach at most index 2 (before action).
    expect(dragBounds([false, false, true], 0)).toEqual([0, 2]);
    expect(dragBounds([false, false, true], 1)).toEqual([0, 2]);
  });

  it("a leading barrier raises the low bound (can’t cross to its left)", () => {
    expect(dragBounds([true, false], 1)).toEqual([1, 2]);
  });

  it("barriers on both sides lock the column in place", () => {
    expect(dragBounds([true, false, true], 1)).toEqual([1, 2]); // only its own slot → no-op
  });
});

describe("reorderWithinZone", () => {
  // visual order: L0 L1 | C0 C1 C2 | R0  — two frozen-left, three center, one frozen-right.
  const ORDER = ["L0", "L1", "C0", "C1", "C2", "R0"];
  const ZONE: Record<string, Zone> = {
    L0: "left",
    L1: "left",
    C0: "center",
    C1: "center",
    C2: "center",
    R0: "right",
  };
  const zoneOf = (id: string) => ZONE[id];

  it("moves a center column to the end of its zone", () => {
    // C0 dropped after C2 (insertion index 3 in the center slice).
    expect(reorderWithinZone(ORDER, "C0", 3, zoneOf)).toEqual([
      "L0",
      "L1",
      "C1",
      "C2",
      "C0",
      "R0",
    ]);
  });

  it("moves a center column to the start of its zone", () => {
    expect(reorderWithinZone(ORDER, "C2", 0, zoneOf)).toEqual([
      "L0",
      "L1",
      "C2",
      "C0",
      "C1",
      "R0",
    ]);
  });

  it("returns the SAME array reference on a drop-onto-self (both halves of the source)", () => {
    // C1 is at center-local index 1; insertion index 1 (its left edge) and 2 (its right edge) both
    // map back to its own slot after the splice-correction → no-op, same ref (caller skips callback).
    expect(reorderWithinZone(ORDER, "C1", 1, zoneOf)).toBe(ORDER);
    expect(reorderWithinZone(ORDER, "C1", 2, zoneOf)).toBe(ORDER);
  });

  it("reorders within a frozen zone, leaving the other zones untouched", () => {
    expect(reorderWithinZone(ORDER, "L1", 0, zoneOf)).toEqual([
      "L1",
      "L0",
      "C0",
      "C1",
      "C2",
      "R0",
    ]);
  });

  it("never moves ids outside the source zone", () => {
    const next = reorderWithinZone(ORDER, "C0", 3, zoneOf);
    expect(next.filter((id) => zoneOf(id) === "left")).toEqual(["L0", "L1"]);
    expect(next.filter((id) => zoneOf(id) === "right")).toEqual(["R0"]);
  });

  it("a single-column zone is always a same-ref no-op", () => {
    expect(reorderWithinZone(ORDER, "R0", 0, zoneOf)).toBe(ORDER);
    expect(reorderWithinZone(ORDER, "R0", 1, zoneOf)).toBe(ORDER);
  });

  it("clamps an out-of-range insertion index to the zone end", () => {
    expect(reorderWithinZone(ORDER, "C0", 99, zoneOf)).toEqual([
      "L0",
      "L1",
      "C1",
      "C2",
      "C0",
      "R0",
    ]);
  });

  it("returns the same ref for an unknown source id", () => {
    expect(reorderWithinZone(ORDER, "ZZ", 0, zoneOf)).toBe(ORDER);
  });
});
