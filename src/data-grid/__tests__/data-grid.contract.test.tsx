import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataGrid } from "../data-grid";

import type { Column, DataGridProps, GridSelection } from "../core/types";

interface Row {
  id: number;
  value: string;
}

const ROWS: Row[] = [
  { id: 1, value: "one" },
  { id: 2, value: "two" },
  { id: 3, value: "three" },
];
const getRowId = (row: Row) => row.id;
const columns = (): Column<Row>[] => [
  { id: "c0", name: "C0", width: 100, accessor: (row) => row.value },
  { id: "c1", name: "C1", width: 100, accessor: (row) => row.value },
];

function renderGrid(props: Partial<DataGridProps<Row>> = {}) {
  const result = render(
    <DataGrid rows={ROWS} columns={columns()} getRowId={getRowId} {...props} />
  );
  const scroller =
    result.container.querySelector<HTMLElement>('[tabindex="0"]');
  if (!scroller) throw new Error("scroll container not found");
  return { ...result, scroller };
}

const drag = (el: HTMLElement, fromX: number, toX: number, y = 16) => {
  fireEvent.pointerDown(el, {
    clientX: fromX,
    clientY: y,
    button: 0,
    pointerId: 1,
  });
  fireEvent.pointerMove(el, { clientX: toX, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: toX, clientY: y, pointerId: 1 });
};

const clickCell = (el: HTMLElement, x: number, y: number) => {
  fireEvent.pointerDown(el, {
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1,
  });
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });
};

describe("Phase 1 public contract", () => {
  it("applies root identity, class, style, and accessible naming props", () => {
    const { scroller } = renderGrid({
      id: "people-grid",
      className: "custom-grid",
      style: { backgroundColor: "rgb(1, 2, 3)" },
      "aria-label": "People",
      "aria-labelledby": "grid-title",
    });

    expect(scroller).toHaveAttribute("id", "people-grid");
    expect(scroller).toHaveClass("custom-grid");
    expect(scroller).toHaveStyle({ backgroundColor: "rgb(1, 2, 3)" });
    expect(scroller).toHaveAttribute("aria-label", "People");
    expect(scroller).toHaveAttribute("aria-labelledby", "grid-title");
  });

  it("passes stable ids and resolved dimensions to cell and header renderers", () => {
    const renderCell = vi.fn((ctx) => `cell:${String(ctx.value)}`);
    const renderHeader = vi.fn((ctx) => `header:${ctx.columnId}`);
    renderGrid({
      rowHeight: 40,
      columns: [
        {
          id: "c0",
          name: "C0",
          width: 123,
          accessor: (row) => row.value,
          renderCell,
          renderHeader,
        },
      ],
    });

    expect(screen.getByText("header:c0")).toBeInTheDocument();
    expect(screen.getAllByText(/^cell:/).length).toBeGreaterThan(0);
    expect(renderHeader).toHaveBeenCalledWith(
      expect.objectContaining({
        columnId: "c0",
        columnIndex: 0,
        width: 123,
        resizable: true,
        reorderable: true,
      })
    );
    expect(renderCell).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: 1,
        columnId: "c0",
        width: 123,
        height: 40,
      })
    );
  });
});

describe("controlled and uncontrolled durable state", () => {
  it("uses default row selection once and updates it internally", () => {
    const onSelectedRowIdsChange = vi.fn();
    renderGrid({
      enableRowSelection: true,
      defaultSelectedRowIds: new Set([1]),
      onSelectedRowIdsChange,
    });
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[1]).toBeChecked();
    fireEvent.click(checkboxes[2]);
    expect(checkboxes[2]).toBeChecked();
    expect(onSelectedRowIdsChange).toHaveBeenLastCalledWith(new Set([1, 2]));
  });

  it("treats selectedRowIds as authoritative", () => {
    const onSelectedRowIdsChange = vi.fn();
    renderGrid({
      enableRowSelection: true,
      selectedRowIds: new Set([1]),
      onSelectedRowIdsChange,
    });
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[1]).toBeChecked();
    fireEvent.click(checkboxes[2]);
    expect(onSelectedRowIdsChange).toHaveBeenCalledWith(new Set([1, 2]));
    expect(checkboxes[2]).not.toBeChecked();
  });

  it("disables row-selection affordances for a read-only controlled value", () => {
    renderGrid({ enableRowSelection: true, selectedRowIds: new Set([1]) });
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toBeDisabled();
    }
  });

  it("reorders internally by default and notifies an optional observer", async () => {
    const onColumnOrderChange = vi.fn();
    const { scroller } = renderGrid({ onColumnOrderChange });
    drag(scroller, 50, 190);
    expect(onColumnOrderChange).toHaveBeenCalledWith(["c1", "c0"]);
    await waitFor(() =>
      expect(screen.getByText("C0")).toHaveStyle({
        transform: "translateX(100px)",
      })
    );
  });

  it("keeps controlled order authoritative and disables read-only order", () => {
    const onColumnOrderChange = vi.fn();
    const controlled = renderGrid({
      columnOrder: ["c0", "c1"],
      onColumnOrderChange,
    });
    drag(controlled.scroller, 50, 190);
    expect(onColumnOrderChange).toHaveBeenCalledWith(["c1", "c0"]);
    expect(screen.getByText("C0")).toHaveStyle({
      transform: "translateX(0px)",
    });
    controlled.unmount();

    const readOnly = renderGrid({ columnOrder: ["c0", "c1"] });
    expect(screen.getByText("C0")).not.toHaveStyle({ cursor: "grab" });
    drag(readOnly.scroller, 50, 190);
    expect(screen.getByText("C0")).toHaveStyle({
      transform: "translateX(0px)",
    });
  });

  it("supports default, controlled, and read-only column widths", async () => {
    const uncontrolled = renderGrid({ defaultColumnWidths: { c0: 125 } });
    expect(screen.getByText("C0")).toHaveStyle({ width: "125px" });
    uncontrolled.unmount();

    const onColumnWidthsChange = vi.fn();
    const controlled = renderGrid({
      columnWidths: { c0: 110 },
      onColumnWidthsChange,
    });
    drag(controlled.scroller, 110, 150);
    expect(onColumnWidthsChange).toHaveBeenCalledWith({ c0: 150 });
    expect(screen.getByText("C0")).toHaveStyle({ width: "110px" });
    controlled.unmount();

    const readOnly = renderGrid({ columnWidths: { c0: 110 } });
    drag(readOnly.scroller, 110, 150);
    await act(async () => {});
    expect(screen.getByText("C0")).toHaveStyle({ width: "110px" });
  });
});

describe("selection and pending reconciliation", () => {
  it("keeps pointer-range updates off the virtualized cell render path", () => {
    const renderCell = vi.fn((ctx) => String(ctx.value));
    const { scroller } = renderGrid({
      columns: [
        {
          id: "c0",
          name: "C0",
          width: 100,
          accessor: (row) => row.value,
          renderCell,
        },
        {
          id: "c1",
          name: "C1",
          width: 100,
          accessor: (row) => row.value,
          renderCell,
        },
      ],
    });
    const initialCalls = renderCell.mock.calls.length;
    fireEvent.pointerDown(scroller, {
      clientX: 50,
      clientY: 48,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(scroller, {
      clientX: 150,
      clientY: 80,
      pointerId: 1,
    });
    fireEvent.pointerUp(scroller, {
      clientX: 150,
      clientY: 80,
      pointerId: 1,
    });
    expect(renderCell).toHaveBeenCalledTimes(initialCalls);
  });

  it("preserves focused row identity through reorder and clears removed rows/columns", async () => {
    const onSelectionChange = vi.fn();
    const cols = columns();
    const { container, rerender } = render(
      <DataGrid
        rows={ROWS}
        columns={cols}
        getRowId={getRowId}
        onSelectionChange={onSelectionChange}
      />
    );
    const root = container.querySelector<HTMLElement>('[tabindex="0"]');
    if (!root) throw new Error("scroll container not found");
    clickCell(root, 50, 48);

    rerender(
      <DataGrid
        rows={[ROWS[1], ROWS[0], ROWS[2]]}
        columns={cols}
        getRowId={getRowId}
        onSelectionChange={onSelectionChange}
      />
    );
    await waitFor(() =>
      expect(
        (onSelectionChange.mock.calls.at(-1)?.[0] as GridSelection).focusedCell
      ).toEqual({ rowIndex: 1, columnId: "c0" })
    );

    rerender(
      <DataGrid
        rows={[ROWS[1], ROWS[2]]}
        columns={cols.slice(1)}
        getRowId={getRowId}
        onSelectionChange={onSelectionChange}
      />
    );
    await waitFor(() =>
      expect(
        (onSelectionChange.mock.calls.at(-1)?.[0] as GridSelection).focusedCell
      ).toBeNull()
    );
  });

  it("removes stale checkbox ids and select-all considers current rows only", async () => {
    const onSelectionChange = vi.fn();
    const cols = columns();
    const { rerender } = render(
      <DataGrid
        rows={ROWS}
        columns={cols}
        getRowId={getRowId}
        enableRowSelection
        defaultSelectedRowIds={new Set([1, 2])}
        onSelectionChange={onSelectionChange}
      />
    );
    rerender(
      <DataGrid
        rows={[ROWS[0]]}
        columns={cols}
        getRowId={getRowId}
        enableRowSelection
        defaultSelectedRowIds={new Set([1, 2])}
        onSelectionChange={onSelectionChange}
      />
    );
    await waitFor(() =>
      expect([
        ...(onSelectionChange.mock.calls.at(-1)?.[0] as GridSelection)
          .selectedRows,
      ]).toEqual([1])
    );
    expect(screen.getByLabelText("Select all rows")).toBeChecked();
  });

  it("keeps an in-flight pending overlay attached to RowId after row reorder", async () => {
    let resolveCommit = () => {};
    const commit = new Promise<void>((resolve) => {
      resolveCommit = resolve;
    });
    const rows = ROWS.slice(0, 2);
    const editable: Column<Row>[] = [
      {
        id: "c0",
        name: "C0",
        width: 100,
        accessor: (row) => row.value,
        editable: true,
      },
    ];
    const { container, rerender } = render(
      <DataGrid
        rows={rows}
        columns={editable}
        getRowId={getRowId}
        onCellCommit={() => commit}
      />
    );
    const root = container.querySelector<HTMLElement>('[tabindex="0"]');
    if (!root) throw new Error("scroll container not found");
    clickCell(root, 50, 48);
    clickCell(root, 50, 48);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "pending value" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    const pendingValue = screen.getByText("pending value");
    expect(pendingValue.parentElement).toHaveStyle({
      transform: "translate(0px, 0px)",
    });

    rerender(
      <DataGrid
        rows={[rows[1], rows[0]]}
        columns={editable}
        getRowId={getRowId}
        onCellCommit={() => commit}
      />
    );
    await waitFor(() =>
      expect(screen.getByText("pending value").parentElement).toHaveStyle({
        transform: "translate(0px, 32px)",
      })
    );
    await act(async () => resolveCommit());
  });
});

describe("resolved column capabilities", () => {
  it("honors normal opt-outs and fixed action invariants", () => {
    const onSelectionChange = vi.fn();
    const onColumnOrderChange = vi.fn();
    const actionHeader = vi.fn(
      (ctx) => `Action:${ctx.reorderable}:${ctx.resizable}`
    );
    const cols: Column<Row>[] = [
      {
        id: "normal",
        name: "Normal",
        width: 100,
        accessor: (row) => row.value,
        selectable: false,
        reorderable: false,
        resizable: false,
      },
      {
        id: "action",
        name: "Action",
        width: 100,
        accessor: () => "action",
        type: "action",
        selectable: true,
        editable: true,
        reorderable: true,
        resizable: true,
        reorderBarrier: false,
        renderHeader: actionHeader,
      },
    ];
    const { scroller } = renderGrid({
      columns: cols,
      onSelectionChange,
      onColumnOrderChange,
    });
    expect(screen.getByText("Action:false:false")).toBeInTheDocument();
    clickCell(scroller, 50, 48);
    clickCell(scroller, 150, 48);
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(screen.getByText("Normal")).not.toHaveStyle({ cursor: "grab" });
    expect(actionHeader).toHaveBeenCalledWith(
      expect.objectContaining({ reorderable: false, resizable: false })
    );
  });
});
