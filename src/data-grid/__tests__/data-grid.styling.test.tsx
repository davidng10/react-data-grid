import { expect, it, vi } from "vitest";

import type {
  CellRenderContext,
  Column,
  HeaderRenderContext,
} from "../core/types";

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, waitFor } from "@testing-library/react";

import { DataGrid } from "../data-grid";

it("preserves user identity and exposes stable parts in all zones", () => {
  const { container } = render(
    <DataGrid
      id="people"
      className="consumer-theme"
      rows={[{ id: 1, name: "Ada" }]}
      columns={[
        { id: "left", name: "Left", frozen: "left", accessor: (r) => r.name },
        { id: "name", name: "Name", accessor: (r) => r.name },
        {
          id: "right",
          name: "Right",
          frozen: "right",
          accessor: (r) => r.name,
        },
      ]}
      getRowId={(r) => r.id}
      enableRowSelection
    />
  );
  const frame = container.querySelector("#people");
  expect(frame).toHaveClass("dgr-root", "consumer-theme");
  expect(frame).toHaveAttribute("data-grid-frame");
  expect(frame?.querySelector(".dgr-header-cell")).toHaveTextContent("Left");
  expect(frame?.querySelector(".dgr-cell")).toHaveTextContent("Ada");
  expect(frame?.querySelector(".dgr-row-gutter")).toBeInTheDocument();
  for (const zone of ["left", "center", "right"])
    expect(
      frame?.querySelector(`.dgr-zone[data-zone="${zone}"]`)
    ).toBeInTheDocument();
});

it("resolves classes from shared renderer contexts and updates with row data", () => {
  const accessor = vi.fn((r: Row) => r.value);
  const cellClassName = vi.fn((ctx: CellRenderContext<Row>) =>
    (ctx.value as number) < 0 ? "negative" : undefined
  );
  const headerClassName = vi.fn((ctx: HeaderRenderContext<Row>) =>
    ctx.columnId === "amount" ? "money-heading" : undefined
  );
  const renderCell = vi.fn((ctx: CellRenderContext<Row>) => String(ctx.value));
  const columns: Column<Row>[] = [
    {
      id: "amount",
      name: "Amount",
      width: 120,
      accessor,
      cellClassName,
      headerClassName,
      renderCell,
    },
  ];
  const getRowId = (r: Row) => r.id;
  const { container, rerender } = render(
    <DataGrid
      rowHeight={40}
      rows={[{ id: 7, value: -3 }]}
      getRowId={getRowId}
      columns={columns}
    />
  );
  expect(container.querySelector(".dgr-cell")).toHaveClass("negative");
  expect(container.querySelector(".dgr-header-cell")).toHaveClass(
    "money-heading"
  );
  expect(cellClassName).toHaveBeenLastCalledWith(
    expect.objectContaining({
      rowId: 7,
      rowIndex: 0,
      value: -3,
      width: 120,
      height: 40,
      column: columns[0],
    })
  );
  expect(headerClassName).toHaveBeenLastCalledWith(
    expect.objectContaining({
      columnId: "amount",
      columnIndex: 0,
      width: 120,
      resizable: true,
      reorderable: true,
    })
  );
  expect(accessor.mock.calls.length).toBe(renderCell.mock.calls.length);
  expect(cellClassName.mock.calls.at(-1)?.[0]).toBe(
    renderCell.mock.calls.at(-1)?.[0]
  );
  const counts = [
    cellClassName.mock.calls.length,
    headerClassName.mock.calls.length,
    renderCell.mock.calls.length,
  ];
  const scroller = container.querySelector<HTMLElement>(
    "[data-grid-scroller]"
  )!;
  fireEvent.pointerDown(scroller, {
    clientX: 50,
    clientY: 55,
    button: 0,
    pointerId: 1,
  });
  fireEvent.pointerMove(scroller, { clientX: 90, clientY: 65, pointerId: 1 });
  fireEvent.pointerUp(scroller, { clientX: 90, clientY: 65, pointerId: 1 });
  expect(container.querySelector(".dgr-focus-ring")).toBeInTheDocument();
  expect([
    cellClassName.mock.calls.length,
    headerClassName.mock.calls.length,
    renderCell.mock.calls.length,
  ]).toEqual(counts);
  rerender(
    <DataGrid
      rowHeight={40}
      rows={[{ id: 7, value: 3 }]}
      getRowId={getRowId}
      columns={columns}
    />
  );
  expect(container.querySelector(".dgr-cell")).not.toHaveClass("negative");
  expect(container.querySelector(".dgr-cell")).toHaveTextContent("3");
});

it("accepts constant classes and undefined callback results", () => {
  const { container } = render(
    <DataGrid
      rows={[{ id: 1, value: 2 }]}
      getRowId={(r) => r.id}
      columns={[
        {
          id: "a",
          name: "A",
          accessor: (r) => r.value,
          cellClassName: "constant-cell",
          headerClassName: "constant-header",
        },
        {
          id: "b",
          name: "B",
          accessor: (r) => r.value,
          cellClassName: () => undefined,
          headerClassName: () => undefined,
        },
      ]}
    />
  );
  expect(container.querySelector(".dgr-cell")).toHaveClass("constant-cell");
  expect(container.querySelector(".dgr-header-cell")).toHaveClass(
    "constant-header"
  );
  expect(container.querySelectorAll(".dgr-cell")[1].className).toBe("dgr-cell");
  expect(container.querySelectorAll(".dgr-header-cell")[1].className).toBe(
    "dgr-header-cell"
  );
});

interface Row {
  id: number;
  value: number;
}

it("remeasures the built-in editor after initial and live portal typography changes", async () => {
  // jsdom has no text layout: represent the browser's measured height at each applied font.
  const measured = vi
    .spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
    .mockImplementation(function (this: HTMLTextAreaElement) {
      return this.parentElement?.style.fontSize === "17px"
        ? 80
        : this.style.minWidth === "240px"
          ? 48
          : 32;
    });
  const columns: Column<Row>[] = [
    {
      id: "value",
      name: "Value",
      width: 120,
      accessor: (r) => r.value,
      editable: true,
    },
  ];
  const props = {
    rows: [{ id: 1, value: 5 }],
    columns,
    getRowId: (r: Row) => r.id,
  };
  const { container, rerender } = render(
    <DataGrid {...props} style={{ fontSize: 17 }} />
  );
  const scroller = container.querySelector<HTMLElement>(
    "[data-grid-scroller]"
  )!;
  fireEvent.pointerDown(scroller, {
    clientX: 50,
    clientY: 48,
    button: 0,
    pointerId: 1,
  });
  fireEvent.pointerUp(scroller, { clientX: 50, clientY: 48, pointerId: 1 });
  fireEvent.keyDown(scroller, { key: "Enter" });
  const textarea = document.querySelector("textarea")!;
  expect(textarea.style.height).toBe("80px");
  rerender(<DataGrid {...props} style={{ fontSize: 13 }} />);
  await waitFor(() => expect(textarea.style.height).toBe("32px"));
  rerender(
    <DataGrid
      {...props}
      columns={[{ ...columns[0], width: 240 }]}
      style={{ fontSize: 13 }}
    />
  );
  expect(textarea.style.height).toBe("48px");
  measured.mockRestore();
});
