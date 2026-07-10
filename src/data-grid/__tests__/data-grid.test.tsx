import { describe, expect, it, vi } from "vitest";

import "@testing-library/jest-dom/vitest"; // jest-dom matchers (toBeInTheDocument, …) typed on expect

import { fireEvent, render } from "@testing-library/react";

import { DataGrid } from "../data-grid";

import type { Column } from "../core/types";

// Integration tests for the React shell in jsdom. jsdom has no layout engine, but the grid derives
// per-column geometry from the offsets arrays (prop widths), not per-element measurement — so we
// only need to mock the SCROLL CONTAINER's rect + size for the pointer math to resolve. This makes
// the interaction logic (headerHitTest → pointer handlers → drag store → reorder) testable.

interface Row {
  id: number;
  v: string;
}

const ROWS: Row[] = Array.from({ length: 50 }, (_, i) => ({
  id: i,
  v: `r${i}`,
}));

// Four 100px center columns: offsets [0,100,200,300], midpoints 50/150/250/350.
const cols = (): Column<Row>[] => [
  { id: "c0", name: "C0", width: 100, accessor: (r) => r.v },
  { id: "c1", name: "C1", width: 100, accessor: (r) => r.v },
  { id: "c2", name: "C2", width: 100, accessor: (r) => r.v },
  { id: "c3", name: "C3", width: 100, accessor: (r) => r.v },
];

function mockViewport(el: HTMLElement, w = 800, h = 600) {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: w,
      bottom: h,
      width: w,
      height: h,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  Object.defineProperty(el, "clientWidth", { configurable: true, value: w });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: h });
}

function getScroller(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[tabindex="0"]');
  if (!el) throw new Error("scroll container not found");
  return el;
}

describe("DataGrid (jsdom integration)", () => {
  it("renders without crashing", () => {
    const { container } = render(
      <DataGrid rows={ROWS} columns={cols()} getRowId={(r) => r.id} />
    );
    expect(getScroller(container)).toBeInTheDocument();
  });

  it("emits onColumnOrderChange when a center header is dragged within its zone", () => {
    const onColumnOrderChange = vi.fn();
    const { container } = render(
      <DataGrid
        rows={ROWS}
        columns={cols()}
        getRowId={(r) => r.id}
        onColumnOrderChange={onColumnOrderChange}
      />
    );
    const scroller = getScroller(container);
    mockViewport(scroller);

    // Grab c1's header (x in 100..200, y in the header strip) and drag past c3's midpoint (350).
    fireEvent.pointerDown(scroller, {
      clientX: 150,
      clientY: 16,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(scroller, {
      clientX: 360,
      clientY: 16,
      pointerId: 1,
    });
    fireEvent.pointerUp(scroller, { clientX: 360, clientY: 16, pointerId: 1 });

    expect(onColumnOrderChange).toHaveBeenCalledTimes(1);
    expect(onColumnOrderChange).toHaveBeenCalledWith(["c0", "c2", "c3", "c1"]);
  });

  it("does not emit on a plain header click (below the drag threshold)", () => {
    const onColumnOrderChange = vi.fn();
    const { container } = render(
      <DataGrid
        rows={ROWS}
        columns={cols()}
        getRowId={(r) => r.id}
        onColumnOrderChange={onColumnOrderChange}
      />
    );
    const scroller = getScroller(container);
    mockViewport(scroller);

    fireEvent.pointerDown(scroller, {
      clientX: 150,
      clientY: 16,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(scroller, { clientX: 151, clientY: 16, pointerId: 1 });

    expect(onColumnOrderChange).not.toHaveBeenCalled();
  });

  it("does not emit when reorder is uncontrolled (no onColumnOrderChange)", () => {
    // Without the handler the grid won't start a drag at all (reorderable === false).
    const { container } = render(
      <DataGrid rows={ROWS} columns={cols()} getRowId={(r) => r.id} />
    );
    const scroller = getScroller(container);
    mockViewport(scroller);
    // Should be a no-op (and not throw).
    fireEvent.pointerDown(scroller, {
      clientX: 150,
      clientY: 16,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(scroller, {
      clientX: 360,
      clientY: 16,
      pointerId: 1,
    });
    fireEvent.pointerUp(scroller, { clientX: 360, clientY: 16, pointerId: 1 });
    expect(getScroller(container)).toBeInTheDocument();
  });
});
