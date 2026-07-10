import { afterEach, describe, expect, it, vi } from "vitest";

import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, screen } from "@testing-library/react";

import { DataGrid } from "../data-grid";

import type { Column, GridSelection } from "../core/types";
import type { DataGridProps } from "../data-grid";

// Interaction tests share a mocked 1000×600 box with a 32px header and 100px columns.

interface Row {
  id: number;
  v: string;
}
const ROWS: Row[] = Array.from({ length: 50 }, (_, i) => ({
  id: i,
  v: `r${i}`,
}));

const centerCols = (): Column<Row>[] => [
  { id: "c0", name: "C0", width: 100, accessor: (r) => r.v },
  { id: "c1", name: "C1", width: 100, accessor: (r) => r.v },
  { id: "c2", name: "C2", width: 100, accessor: (r) => r.v },
  { id: "c3", name: "C3", width: 100, accessor: (r) => r.v },
];

function renderGrid(props: Partial<DataGridProps<Row>> = {}) {
  const result = render(
    <DataGrid
      rows={ROWS}
      columns={centerCols()}
      getRowId={(r) => r.id}
      {...props}
    />
  );
  const scroller =
    result.container.querySelector<HTMLElement>('[tabindex="0"]');
  if (!scroller) throw new Error("scroll container not found");
  return { ...result, scroller };
}

const down = (
  el: HTMLElement,
  x: number,
  y: number,
  init: Partial<PointerEventInit> = {}
) =>
  fireEvent.pointerDown(el, {
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1,
    ...init,
  });
const move = (el: HTMLElement, x: number, y: number) =>
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 });
const up = (el: HTMLElement, x: number, y: number) =>
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });
const click = (
  el: HTMLElement,
  x: number,
  y: number,
  init?: Partial<PointerEventInit>
) => {
  down(el, x, y, init);
  up(el, x, y);
};

const lastSelection = (fn: ReturnType<typeof vi.fn>): GridSelection =>
  fn.mock.calls.at(-1)![0] as GridSelection;

// jsdom's scrollTop/scrollLeft are unreliable across versions; install a real backing store on the
// scroller so the grid's `el.scrollLeft += dx` is observable and feeds back into hitTest.
function makeScrollable(el: HTMLElement) {
  let top = 0;
  let left = 0;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v) => (top = v),
  });
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    get: () => left,
    set: (v) => (left = v),
  });
}

// Deterministic rAF control: capture scheduled callbacks and run exactly one generation per flush.
// The auto-scroll ticks re-`requestAnimationFrame(self)`, so each flush() runs one tick and queues
// the next — mirroring a single animation frame.
function installRaf() {
  const queue = new Map<number, FrameRequestCallback>();
  let id = 0;
  const origRaf = globalThis.requestAnimationFrame;
  const origCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    id += 1;
    queue.set(id, cb);
    return id as unknown as number;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((rid: number) => {
    queue.delete(rid);
  }) as typeof cancelAnimationFrame;
  const flush = () => {
    const gen = [...queue.values()];
    queue.clear();
    act(() => {
      for (const cb of gen) cb(0);
    });
  };
  const restore = () => {
    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCancel;
  };
  return { flush, restore };
}

let raf: ReturnType<typeof installRaf> | null = null;
afterEach(() => {
  raf?.restore();
  raf = null;
});

describe("drag-select auto-scroll (rAF hot path)", () => {
  it("auto-scrolls and keeps extending while drag-selecting past the bottom edge", () => {
    const onSel = vi.fn();
    const { scroller } = renderGrid({ onSelectionChange: onSel });
    makeScrollable(scroller);
    raf = installRaf();

    down(scroller, 50, 48); // c0 r0
    move(scroller, 150, 200); // cross into another cell → movedRef true
    move(scroller, 150, 590); // y > bottom(600) − EDGE_ZONE(48) → into the edge band
    expect(scroller.scrollTop).toBe(0); // nothing scrolls until a frame ticks

    raf.flush(); // one autoScrollTick
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(lastSelection(onSel).range).toBeTruthy();

    up(scroller, 150, 590);
  });

  it("lostpointercapture mid-drag-select aborts the gesture: auto-scroll stops and hover no longer extends", () => {
    // Capture can be lost without a pointerup (touch pointercancel, the captured node
    // re-rendering out, capture stolen). The gesture must end — otherwise the auto-scroll RAF
    // reschedules forever and pointermove keeps extending the range on plain hover.
    const onSel = vi.fn();
    const { scroller } = renderGrid({ onSelectionChange: onSel });
    makeScrollable(scroller);
    raf = installRaf();

    down(scroller, 50, 48); // c0 r0
    move(scroller, 150, 200); // cross into another cell → movedRef true
    move(scroller, 150, 590); // into the bottom edge band
    raf.flush(); // one tick → auto-scroll engages
    const scrolledTo = scroller.scrollTop;
    expect(scrolledTo).toBeGreaterThan(0);

    fireEvent.lostPointerCapture(scroller);

    raf.flush(); // the loop must be dead now — no further scrolling
    expect(scroller.scrollTop).toBe(scrolledTo);

    const callsBefore = onSel.mock.calls.length;
    move(scroller, 250, 300); // hover over another cell with no button held
    expect(onSel.mock.calls.length).toBe(callsBefore); // gesture aborted → no extend
  });

  it("a stationary press on a frozen cell in the edge band does NOT auto-scroll (movedRef gate)", () => {
    // Frozen-left columns sit IN the left edge band, so without the movedRef gate a plain click
    // would auto-scroll every frame. This pins that gate (the subtle invariant, previously untested).
    const cols: Column<Row>[] = [
      {
        id: "L0",
        name: "L0",
        width: 100,
        frozen: "left",
        accessor: (r) => r.v,
      },
      {
        id: "L1",
        name: "L1",
        width: 100,
        frozen: "left",
        accessor: (r) => r.v,
      },
      { id: "c0", name: "C0", width: 100, accessor: (r) => r.v },
    ];
    const { scroller } = renderGrid({ columns: cols });
    makeScrollable(scroller);
    raf = installRaf();

    down(scroller, 50, 48); // press a frozen-left cell, no movement
    raf.flush();
    raf.flush();
    expect(scroller.scrollLeft).toBe(0);
    expect(scroller.scrollTop).toBe(0);

    up(scroller, 50, 48);
  });
});

describe("column-drag auto-scroll + cleanup", () => {
  // Wide center zone so columns overflow the 1000px viewport and edge auto-scroll has somewhere to go.
  const wideCols = (): Column<Row>[] =>
    Array.from({ length: 15 }, (_, i) => ({
      id: `c${i}`,
      name: `C${i}`,
      width: 100,
      accessor: (r: Row) => r.v,
    }));

  it("a center-column drag near the right edge ramps scrollLeft", () => {
    const onColumnOrderChange = vi.fn();
    const { scroller } = renderGrid({
      columns: wideCols(),
      onColumnOrderChange,
    });
    makeScrollable(scroller);
    raf = installRaf();

    down(scroller, 50, 16); // grab C0 header
    move(scroller, 60, 16); // cross DRAG_THRESHOLD → drag starts, schedules dragScrollTick
    move(scroller, 980, 16); // into the right edge band (x > 1000 − 48)
    expect(scroller.scrollLeft).toBe(0);

    raf.flush(); // one dragScrollTick
    expect(scroller.scrollLeft).toBeGreaterThan(0);

    up(scroller, 980, 16);
    expect(onColumnOrderChange).toHaveBeenCalled();
  });

  it("lostpointercapture mid-drag resets the cursor and aborts the reorder", () => {
    const onColumnOrderChange = vi.fn();
    const { scroller } = renderGrid({
      columns: wideCols(),
      onColumnOrderChange,
    });

    down(scroller, 50, 16); // grab C0
    move(scroller, 80, 16); // start dragging
    expect(scroller.style.cursor).toBe("grabbing");

    fireEvent.lostPointerCapture(scroller);
    expect(scroller.style.cursor).toBe("");

    up(scroller, 80, 16); // the drag was aborted → no order change emitted
    expect(onColumnOrderChange).not.toHaveBeenCalled();
  });
});

describe("column resize", () => {
  // c0..c3 are 100px → right-edge boundaries at x = 100/200/300/400; header strip is y ∈ [0, 32).
  // A press within RESIZE_HANDLE_WIDTH of a boundary grabs the column on its LEFT.
  it("a header right-edge drag commits the new width on release", () => {
    const onColumnResize = vi.fn();
    const { scroller } = renderGrid({ onColumnResize });

    down(scroller, 100, 16); // c0 right edge
    move(scroller, 150, 16); // +50 → 150
    up(scroller, 150, 16);

    expect(onColumnResize).toHaveBeenCalledTimes(1);
    expect(onColumnResize).toHaveBeenCalledWith("c0", 150);
  });

  it("clamps the committed width to the column maxWidth", () => {
    const onColumnResize = vi.fn();
    const cols: Column<Row>[] = [
      { id: "c0", name: "C0", width: 100, maxWidth: 130, accessor: (r) => r.v },
      { id: "c1", name: "C1", width: 100, accessor: (r) => r.v },
    ];
    const { scroller } = renderGrid({ columns: cols, onColumnResize });

    down(scroller, 100, 16); // c0 right edge
    move(scroller, 400, 16); // far past max
    up(scroller, 400, 16);

    expect(onColumnResize).toHaveBeenCalledWith("c0", 130);
  });

  it("clamps the committed width to the default min floor", () => {
    const onColumnResize = vi.fn();
    const { scroller } = renderGrid({ onColumnResize });

    down(scroller, 100, 16); // c0 right edge
    move(scroller, 20, 16); // 100 − 80 = 20, below MIN_COL_WIDTH (48)
    up(scroller, 20, 16);

    expect(onColumnResize).toHaveBeenCalledWith("c0", 48);
  });

  it("a bare press on the handle (no movement) is a no-op", () => {
    const onColumnResize = vi.fn();
    const { scroller } = renderGrid({ onColumnResize });

    down(scroller, 100, 16);
    up(scroller, 100, 16);

    expect(onColumnResize).not.toHaveBeenCalled();
  });

  it("resize wins over reorder at a column boundary", () => {
    const onColumnResize = vi.fn();
    const onColumnOrderChange = vi.fn();
    const { scroller } = renderGrid({ onColumnResize, onColumnOrderChange });

    down(scroller, 100, 16); // c0 right edge → resize claims the gesture
    move(scroller, 160, 16);
    up(scroller, 160, 16);

    expect(onColumnResize).toHaveBeenCalledWith("c0", 160);
    expect(onColumnOrderChange).not.toHaveBeenCalled();
  });

  it("does not resize a column opted out via resizable:false", () => {
    const onColumnResize = vi.fn();
    const cols: Column<Row>[] = [
      {
        id: "c0",
        name: "C0",
        width: 100,
        resizable: false,
        accessor: (r) => r.v,
      },
      { id: "c1", name: "C1", width: 100, accessor: (r) => r.v },
    ];
    const { scroller } = renderGrid({ columns: cols, onColumnResize });

    down(scroller, 100, 16); // c0 right edge — but c0 is not resizable
    move(scroller, 150, 16);
    up(scroller, 150, 16);

    expect(onColumnResize).not.toHaveBeenCalled();
  });

  it("sets col-resize during the gesture and resets the cursor after", () => {
    const onColumnResize = vi.fn();
    const { scroller } = renderGrid({ onColumnResize });

    down(scroller, 100, 16);
    expect(scroller.style.cursor).toBe("col-resize");
    move(scroller, 150, 16);
    up(scroller, 150, 16);
    expect(scroller.style.cursor).toBe("");
  });

  it("uncontrolled (default): the grid applies the new width itself, no wiring", () => {
    const { scroller } = renderGrid(); // no columnWidths, no onColumnResize
    expect(screen.getByText("C0").style.width).toBe("100px");

    down(scroller, 100, 16); // c0 right edge
    move(scroller, 150, 16);
    up(scroller, 150, 16);

    expect(screen.getByText("C0").style.width).toBe("150px"); // grid owns it
  });

  it("enableColumnResize={false} disables the gesture + handle", () => {
    const onColumnResize = vi.fn();
    const { scroller } = renderGrid({
      enableColumnResize: false,
      onColumnResize,
    });

    down(scroller, 100, 16);
    move(scroller, 150, 16);
    up(scroller, 150, 16);

    expect(onColumnResize).not.toHaveBeenCalled();
    expect(screen.getByText("C0").style.width).toBe("100px"); // unchanged
  });
});

describe("click-to-edit vs drag-select disambiguation", () => {
  const editableCols = (): Column<Row>[] => [
    { id: "c0", name: "C0", width: 100, accessor: (r) => r.v, editable: true },
    { id: "c1", name: "C1", width: 100, accessor: (r) => r.v },
    { id: "c2", name: "C2", width: 100, accessor: (r) => r.v },
    { id: "c3", name: "C3", width: 100, accessor: (r) => r.v },
  ];

  it("a clean second click on the focused cell opens the editor", () => {
    const { scroller } = renderGrid({ columns: editableCols() });
    click(scroller, 50, 48); // focus c0 r0
    click(scroller, 50, 48); // second click, no drag → editor opens
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("pressing the focused cell then dragging selects a range and does NOT open the editor", () => {
    const onSel = vi.fn();
    const { scroller } = renderGrid({
      columns: editableCols(),
      onSelectionChange: onSel,
    });
    click(scroller, 50, 48); // focus c0 r0
    down(scroller, 50, 48); // press the focused cell → edit candidate
    move(scroller, 250, 112); // drag into c2 r2 → movedRef trips
    up(scroller, 250, 112);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(lastSelection(onSel).range).toBeTruthy();
  });
});
