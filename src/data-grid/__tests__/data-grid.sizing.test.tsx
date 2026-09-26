import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataGrid } from "../data-grid";

import type { Column, DataGridProps } from "../core/types";

type Row = { id: number };
const rows = [{ id: 1 }];
const getRowId = (row: Row) => row.id;
const column = (
  id: string,
  options: Partial<Column<Row>> = {}
): Column<Row> => ({
  id,
  name: id,
  accessor: (row) => `${id}-${row.id}`,
  ...options,
});

function setup(
  columns: Column<Row>[],
  props: Partial<DataGridProps<Row>> = {}
) {
  const result = render(
    <DataGrid rows={rows} columns={columns} getRowId={getRowId} {...props} />
  );
  const scroller = result.container.querySelector<HTMLElement>(
    "[data-grid-scroller]"
  )!;
  return { ...result, scroller };
}

afterEach(() => vi.unstubAllGlobals());

function resize(scroller: HTMLElement, fromX: number, toX: number) {
  fireEvent.pointerDown(scroller, {
    clientX: fromX,
    clientY: 16,
    button: 0,
    pointerId: 1,
  });
  fireEvent.pointerMove(scroller, { clientX: toX, clientY: 16, pointerId: 1 });
  fireEvent.pointerUp(scroller, { clientX: toX, clientY: 16, pointerId: 1 });
}

describe("remaining-space column sizing", () => {
  it("preserves explicit widths even when they leave spare space", () => {
    setup([column("A", { width: 200 }), column("B", { width: 200 })]);
    expect(screen.getByText("A")).toHaveStyle({ width: "200px" });
    expect(screen.getByText("B")).toHaveStyle({ width: "200px" });
  });

  it("gives the last unspecified column real cell width and selectable space", () => {
    const onSelectionChange = vi.fn();
    const { scroller } = setup([column("A", { width: 200 }), column("B")], {
      onSelectionChange,
    });
    expect(screen.getByText("B")).toHaveStyle({ width: "800px" });
    expect(screen.getByText("B-1")).toHaveStyle({ width: "800px" });
    fireEvent.pointerDown(scroller, {
      clientX: 850,
      clientY: 48,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerUp(scroller, { clientX: 850, clientY: 48, pointerId: 1 });
    expect(onSelectionChange.mock.calls.at(-1)?.[0].focusedCell).toEqual({
      columnId: "B",
      rowIndex: 0,
    });
  });

  it("keeps earlier unspecified columns at the default width", () => {
    setup([column("A"), column("B"), column("C", { width: 100 })]);
    expect(screen.getByText("A")).toHaveStyle({ width: "140px" });
    expect(screen.getByText("B")).toHaveStyle({ width: "760px" });
    expect(screen.getByText("C")).toHaveStyle({ width: "100px" });
  });

  it("subtracts the checkbox gutter and both frozen zones", () => {
    setup(
      [
        column("Left", { width: 200, frozen: "left" }),
        column("Middle"),
        column("Right", { width: 100, frozen: "right" }),
      ],
      { enableRowSelection: true }
    );
    expect(screen.getByText("Middle")).toHaveStyle({ width: "660px" });
    expect(screen.getByText("Middle-1")).toHaveStyle({ width: "660px" });
    expect(screen.getByText("Right")).toHaveStyle({ width: "100px" });
  });

  it("chooses the last unspecified column in visual order", () => {
    setup([column("A"), column("B")], { columnOrder: ["B", "A"] });
    expect(screen.getByText("B")).toHaveStyle({ width: "140px" });
    expect(screen.getByText("A")).toHaveStyle({ width: "860px" });
  });

  it("counts controlled widths as explicit and resumes automatic sizing when cleared", () => {
    const cols = [column("A", { width: 200 }), column("B")];
    const { rerender } = setup(cols, { columnWidths: { B: 250 } });
    expect(screen.getByText("B")).toHaveStyle({ width: "250px" });
    rerender(
      <DataGrid
        rows={rows}
        columns={cols}
        getRowId={getRowId}
        columnWidths={{}}
      />
    );
    expect(screen.getByText("B")).toHaveStyle({ width: "800px" });
  });

  it("resizing a fixed column recalculates the automatic column without persisting its width", () => {
    const onColumnWidthsChange = vi.fn();
    const { scroller } = setup([column("A", { width: 200 }), column("B")], {
      onColumnWidthsChange,
    });
    resize(scroller, 200, 300);
    expect(screen.getByText("A")).toHaveStyle({ width: "300px" });
    expect(screen.getByText("B")).toHaveStyle({ width: "700px" });
    expect(onColumnWidthsChange).toHaveBeenLastCalledWith({ A: 300 });
  });

  it("a manual resize fixes the automatic column at the chosen width", () => {
    const onColumnWidthsChange = vi.fn();
    const { scroller } = setup([column("A", { width: 200 }), column("B")], {
      onColumnWidthsChange,
    });
    resize(scroller, 999, 899);
    expect(screen.getByText("B")).toHaveStyle({ width: "700px" });
    expect(onColumnWidthsChange).toHaveBeenLastCalledWith({ B: 700 });
    resize(scroller, 200, 250);
    expect(screen.getByText("A")).toHaveStyle({ width: "250px" });
    expect(screen.getByText("B")).toHaveStyle({ width: "700px" });
  });

  it("allows a frozen-right unspecified column to fill last in visual order", () => {
    setup([
      column("Right", { frozen: "right" }),
      column("Middle"),
      column("Left", { width: 100, frozen: "left" }),
    ]);
    expect(screen.getByText("Middle")).toHaveStyle({ width: "140px" });
    expect(screen.getByText("Right")).toHaveStyle({ width: "760px" });
  });

  it.each([
    { fixed: 980, options: {}, expected: 48 },
    { fixed: 980, options: { minWidth: 120 }, expected: 120 },
    { fixed: 200, options: { maxWidth: 300 }, expected: 300 },
  ])(
    "respects size limits: $fixed fixed, $expected automatic",
    ({ fixed, options, expected }) => {
      setup([column("A", { width: fixed }), column("B", options)]);
      expect(screen.getByText("B")).toHaveStyle({ width: `${expected}px` });
    }
  );

  it("recalculates actual cells on container resize without emitting manual width changes", () => {
    const observers = new Map<
      ResizeObserver,
      { callback: ResizeObserverCallback; target?: Element }
    >();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.set(this as unknown as ResizeObserver, { callback });
        }
        observe(target: Element) {
          observers.get(this as unknown as ResizeObserver)!.target = target;
        }
        unobserve() {}
        disconnect() {
          observers.delete(this as unknown as ResizeObserver);
        }
      }
    );
    const onColumnWidthsChange = vi.fn();
    const { scroller } = setup([column("A", { width: 200 }), column("B")], {
      onColumnWidthsChange,
    });
    Object.defineProperty(scroller, "clientWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(scroller, "offsetWidth", {
      configurable: true,
      value: 800,
    });
    act(() => {
      observers.forEach(({ callback, target }, observer) => {
        if (!target) return;
        callback(
          [
            {
              target,
              contentRect: { width: 800, height: 600 },
              borderBoxSize: [{ inlineSize: 800, blockSize: 600 }],
            } as unknown as ResizeObserverEntry,
          ],
          observer
        );
      });
    });
    expect(screen.getByText("A")).toHaveStyle({ width: "200px" });
    expect(screen.getByText("B")).toHaveStyle({ width: "600px" });
    expect(screen.getByText("B-1")).toHaveStyle({ width: "600px" });
    expect(onColumnWidthsChange).not.toHaveBeenCalled();
  });
});
