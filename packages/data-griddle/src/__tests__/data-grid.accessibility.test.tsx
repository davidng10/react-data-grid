import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataGrid } from "../index";

import type { Column } from "../index";

const rows = Array.from({ length: 100 }, (_, id) => ({
  id,
  value: `Value ${id}`,
}));
const columns: Column<(typeof rows)[number]>[] = [
  {
    id: "left",
    name: "Left",
    frozen: "left",
    width: 100,
    accessor: (r) => r.value,
    editable: true,
  },
  { id: "center", name: "Center", width: 100, accessor: (r) => r.value },
  {
    id: "right",
    name: "Right",
    frozen: "right",
    width: 100,
    accessor: (r) => r.value,
  },
];
function setup(extra = {}) {
  const view = render(
    <DataGrid
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      aria-label="People"
      {...extra}
    />
  );
  const grid = screen.getByRole("grid", { name: "People" });
  return { ...view, grid };
}
function focus(grid: HTMLElement) {
  act(() => grid.focus());
}

describe("grid accessibility", () => {
  it("owns real cells in logical rows across frozen zones and exposes complete counts", () => {
    const { grid } = setup({ enableRowSelection: true });
    expect(grid).toHaveAttribute("aria-rowcount", "101");
    expect(grid).toHaveAttribute("aria-colcount", "4");
    const row = grid.querySelector('[role="row"][aria-rowindex="2"]')!;
    const cells = row
      .getAttribute("aria-owns")!
      .split(" ")
      .map((id) => document.getElementById(id)!);
    expect(cells.map((c) => c.getAttribute("aria-colindex"))).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(cells[1]).toHaveTextContent("Value 0");
    expect(grid.querySelectorAll('[role="row"]').length).toBeLessThan(101);
  });
  it("exposes mounted active cell and selection without rerendering custom content", () => {
    const renderCell = vi.fn(() => "Cell");
    const { grid } = setup({
      columns: columns.map((c) => ({ ...c, renderCell })),
    });
    const count = renderCell.mock.calls.length;
    focus(grid);
    fireEvent.keyDown(grid, { key: "ArrowRight", shiftKey: true });
    const active = document.getElementById(
      grid.getAttribute("aria-activedescendant")!
    );
    expect(active).toHaveAttribute("aria-colindex", "2");
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(renderCell).toHaveBeenCalledTimes(count);
  });
  it("supports Home End and page navigation and ignores composing keys", () => {
    const onSelectionChange = vi.fn();
    const { grid } = setup({ onSelectionChange });
    focus(grid);
    fireEvent.keyDown(grid, { key: "End" });
    expect(onSelectionChange.mock.lastCall![0].focusedCell.columnId).toBe(
      "right"
    );
    fireEvent.keyDown(grid, { key: "Home", ctrlKey: true });
    expect(onSelectionChange.mock.lastCall![0].focusedCell).toEqual({
      rowIndex: 0,
      columnId: "left",
    });
    fireEvent.keyDown(grid, { key: "PageDown" });
    expect(
      onSelectionChange.mock.lastCall![0].focusedCell.rowIndex
    ).toBeGreaterThan(1);
    fireEvent.keyDown(grid, { key: "Enter", isComposing: true });
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("never invents an active cell in an empty grid", () => {
    const onSelectionChange = vi.fn();
    const { grid } = setup({ rows: [], onSelectionChange });
    focus(grid);
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(grid).not.toHaveAttribute("aria-activedescendant");
    expect(onSelectionChange).not.toHaveBeenCalled();
  });
  it("names default editors and does not save during composition", () => {
    const onCellCommit = vi.fn();
    const { grid } = setup({ onCellCommit });
    focus(grid);
    fireEvent.keyDown(grid, { key: "Enter" });
    const input = screen.getByRole("textbox", { name: "Left, row 1" });
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onCellCommit).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(grid).toHaveFocus();
  });
  it("delegates asynchronous failure feedback to the application", async () => {
    const error = new Error("offline");
    const onCellCommitError = vi.fn();
    const { grid } = setup({
      onCellCommit: () => Promise.reject(error),
      onCellCommitError,
    });
    focus(grid);
    fireEvent.keyDown(grid, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "new" } });
    await act(async () =>
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })
    );
    expect(onCellCommitError).toHaveBeenCalledTimes(1);
    expect(onCellCommitError).toHaveBeenCalledWith({
      error,
      update: expect.objectContaining({ rowId: 0, columnId: "left" }),
    });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

const pointer = (
  grid: HTMLElement,
  kind: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel",
  x: number,
  y: number,
  extra = {}
) =>
  fireEvent[kind](grid, {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: y,
    ...extra,
  });

describe("touch scrolling and taps", () => {
  it("touch scrolling never selects a range or starts an editor", () => {
    const onSelectionChange = vi.fn();
    const { grid } = setup({ onSelectionChange });
    pointer(grid, "pointerDown", 40, 48);
    pointer(grid, "pointerMove", 160, 140);
    pointer(grid, "pointerUp", 160, 140);
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("two touch taps only select; editing is explicit", () => {
    const { grid } = setup();
    for (let i = 0; i < 2; i++) {
      pointer(grid, "pointerDown", 40, 48);
      pointer(grid, "pointerUp", 40, 48);
    }
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(screen.getByRole("textbox")).toHaveAccessibleName("Left, row 1");
  });
  it("does not resize from a normal touch header drag", () => {
    const onColumnWidthsChange = vi.fn();
    const { grid } = setup({ onColumnWidthsChange });
    pointer(grid, "pointerDown", 100, 16);
    pointer(grid, "pointerMove", 160, 16);
    pointer(grid, "pointerUp", 160, 16);
    expect(onColumnWidthsChange).not.toHaveBeenCalled();
  });
  it("aborts resize on cancel or lost capture without committing", () => {
    const onColumnWidthsChange = vi.fn();
    const { grid } = setup({ onColumnWidthsChange });
    for (const event of ["pointerCancel", "lostPointerCapture"] as const) {
      pointer(grid, "pointerDown", 100, 16, { pointerType: "mouse" });
      pointer(grid, "pointerMove", 160, 16, { pointerType: "mouse" });
      fireEvent[event](grid, { pointerId: 1 });
      pointer(grid, "pointerUp", 160, 16, { pointerType: "mouse" });
    }
    expect(onColumnWidthsChange).not.toHaveBeenCalled();
  });
  it("cancels on a second pointer and ignores both trailing releases", () => {
    const onSelectionChange = vi.fn();
    const { grid } = setup({ onSelectionChange });
    pointer(grid, "pointerDown", 40, 48);
    pointer(grid, "pointerDown", 180, 48, { pointerId: 2, isPrimary: false });
    pointer(grid, "pointerUp", 40, 48);
    pointer(grid, "pointerUp", 180, 48, { pointerId: 2, isPrimary: false });
    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});

describe("interruption and focus regressions", () => {
  it("cancels pending taps when row identity changes before release", () => {
    const onSelectionChange = vi.fn();
    const { grid, rerender } = setup({ onSelectionChange });
    pointer(grid, "pointerDown", 40, 48);
    rerender(
      <DataGrid
        rows={[...rows].reverse()}
        columns={columns}
        getRowId={(r) => r.id}
        onSelectionChange={onSelectionChange}
        aria-label="People"
      />
    );
    pointer(grid, "pointerUp", 40, 48);
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(grid).not.toHaveAttribute("aria-activedescendant");
  });

  it("implicitly saves when focus leaves an editor action button without stealing outside focus", () => {
    const onCellCommit = vi.fn();
    const { grid } = setup({ onCellCommit });
    focus(grid);
    fireEvent.keyDown(grid, { key: "Enter" });
    const input = screen.getByRole("textbox");
    const save = screen.getByRole("button", { name: "Save edit" });
    fireEvent.change(input, { target: { value: "Changed" } });
    act(() => save.focus());
    expect(input).toBeInTheDocument();
    render(<button>Outside grid</button>);
    act(() => screen.getByRole("button", { name: "Outside grid" }).focus());
    expect(onCellCommit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(grid).not.toHaveFocus();
  });
  it("preserves native tab order when custom content mounts its own control", async () => {
    let show!: () => void;
    function Content() {
      const [visible, setVisible] = useState(false);
      show = () => setVisible(true);
      return visible ? <button>Late action</button> : null;
    }
    const { grid } = setup({
      rows: rows.slice(0, 1),
      columns: [{ ...columns[0], renderCell: () => <Content /> }],
    });
    focus(grid);
    await act(async () => show());
    const action = screen.getByRole("button", { name: "Late action" });
    expect(action).not.toHaveAttribute("tabindex");
    expect(action.tabIndex).toBe(0);
    expect(fireEvent.keyDown(grid, { key: "F6" })).toBe(true);
    expect(grid).toHaveFocus();
  });
  it("keeps checkboxes natively focusable and leaves their keys alone", () => {
    const { grid } = setup({ enableRowSelection: true });
    focus(grid);
    const all = screen.getByRole("checkbox", { name: "Select all rows" });
    expect(all).not.toHaveAttribute("tabindex");
    expect(all.tabIndex).toBe(0);
    act(() => all.focus());
    fireEvent.click(all);
    expect(all).toBeChecked();
    fireEvent.keyDown(all, { key: "Escape" });
    expect(all).toHaveFocus();
    expect(all).not.toHaveAttribute("tabindex");
  });
  it("uses independent IDs across grid instances", () => {
    const view = render(
      <>
        <DataGrid rows={rows} columns={columns} getRowId={(r) => r.id} />
        <DataGrid rows={rows} columns={columns} getRowId={(r) => r.id} />
      </>
    );
    const ids = [...view.container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

it("clears dangling active descendants when the focused row is virtualized out", () => {
  const { grid } = setup();
  expect(grid).not.toHaveAttribute("data-has-focused-cell");
  focus(grid);
  expect(grid).toHaveAttribute("aria-activedescendant");
  expect(grid).toHaveAttribute("data-has-focused-cell");
  grid.scrollTop = 2500;
  fireEvent.scroll(grid);
  const activeId = grid.getAttribute("aria-activedescendant");
  expect(activeId === null || document.getElementById(activeId) !== null).toBe(
    true
  );
  expect(grid.querySelector('[role="row"][aria-rowindex="2"]')).toBeNull();
  // Losing the DOM target must not reactivate the scroller's fallback outline.
  expect(grid).toHaveAttribute("data-has-focused-cell");
});

it("retains the container focus fallback when there are no cells to focus", () => {
  const { grid } = setup({ rows: [] });
  focus(grid);
  expect(grid).toHaveFocus();
  expect(grid).not.toHaveAttribute("data-has-focused-cell");
  expect(grid).not.toHaveAttribute("aria-activedescendant");
});

it("reports asynchronous failures to the application even while loading", async () => {
  const onCellCommitError = vi.fn();
  let reject!: (error: Error) => void;
  const onCellCommit = () =>
    new Promise<void>((_, fail) => {
      reject = fail;
    });
  const { grid, rerender } = setup({ onCellCommit, onCellCommitError });
  focus(grid);
  fireEvent.keyDown(grid, { key: "Enter" });
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Changed" },
  });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  rerender(
    <DataGrid
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      loading
      onCellCommit={onCellCommit}
      onCellCommitError={onCellCommitError}
    />
  );
  await act(async () => reject(new Error("offline")));
  expect(onCellCommitError).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reports action cells read-only even when an editable predicate is supplied", () => {
  const editable = vi.fn(() => true);
  const { grid } = setup({
    columns: [{ ...columns[0], type: "action", editable }],
  });
  expect(grid.querySelector('[role="gridcell"]')).toHaveAttribute(
    "aria-readonly",
    "true"
  );
  expect(editable).not.toHaveBeenCalled();
});
