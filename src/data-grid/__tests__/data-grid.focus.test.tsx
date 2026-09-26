import { StrictMode, createRef, useLayoutEffect, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataGrid } from "../index";

import type {
  Column,
  DataGridHandle,
  DataGridProps,
  FocusCellResult,
} from "../index";

interface Row {
  id: number;
  value: string;
}
const rows = Array.from({ length: 100 }, (_, id) => ({
  id,
  value: `Row ${id}`,
}));
const columns: Column<Row>[] = [
  {
    id: "left",
    name: "Left",
    width: 100,
    frozen: "left",
    accessor: (row) => row.value,
    editable: true,
  },
  ...Array.from({ length: 15 }, (_, id): Column<Row> => ({
    id: `c${id}`,
    name: `C${id}`,
    width: 100,
    accessor: (row) => row.value,
  })),
  {
    id: "right",
    name: "Right",
    width: 100,
    frozen: "right",
    accessor: (row) => row.value,
  },
  { id: "action", name: "Action", type: "action", accessor: () => "Action" },
  {
    id: "disabled",
    name: "Disabled",
    selectable: false,
    accessor: () => "Disabled",
  },
];
const base = { rows, columns, getRowId: (row: Row) => row.id };
function setup(props: Partial<DataGridProps<Row>> = {}) {
  const ref = createRef<DataGridHandle>();
  const onSelectionChange = vi.fn();
  const merged = { ...base, onSelectionChange, ...props };
  const view = render(<DataGrid {...merged} ref={ref} />);
  const scroller = view.container.querySelector<HTMLElement>(
    "[data-grid-scroller]"
  )!;
  const focus = (rowId: number, columnId: string): FocusCellResult => {
    let result!: FocusCellResult;
    act(() => {
      result = ref.current!.focusCell({ rowId, columnId });
    });
    return result;
  };
  return {
    ...view,
    ref,
    scroller,
    focus,
    onSelectionChange,
    update: (next: Partial<DataGridProps<Row>>) =>
      view.rerender(<DataGrid {...merged} {...next} ref={ref} />),
  };
}
function pointer(scroller: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(scroller, {
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
  });
}

describe("imperative focus", () => {
  it.each([false, true])(
    "supports storing a callback-ref handle in state (StrictMode: %s)",
    (strict) => {
      const onSelectionChange = vi.fn();
      const onFocusResult = vi.fn();
      function Parent({ data, loading }: { data: Row[]; loading: boolean }) {
        const [handle, setHandle] = useState<DataGridHandle | null>(null);
        return (
          <>
            <button
              disabled={!handle}
              onClick={() =>
                onFocusResult(handle!.focusCell({ rowId: 2, columnId: "left" }))
              }
            >
              Focus row 2
            </button>
            <DataGrid
              {...base}
              ref={setHandle}
              rows={data}
              loading={loading}
              onSelectionChange={onSelectionChange}
            />
          </>
        );
      }
      const view = (data: Row[], loading = false) => {
        const parent = <Parent data={data} loading={loading} />;
        return strict ? <StrictMode>{parent}</StrictMode> : parent;
      };
      const { rerender, container } = render(view(rows));
      const button = screen.getByRole("button", { name: "Focus row 2" });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      expect(onFocusResult).toHaveBeenLastCalledWith({ ok: true });
      expect(onSelectionChange.mock.calls.at(-1)![0].focusedCell).toEqual({
        rowIndex: 2,
        columnId: "left",
      });
      expect(container.querySelector("[data-grid-scroller]")).toHaveFocus();

      const reordered = [rows[2], rows[0], rows[1]];
      rerender(view(reordered, true));
      fireEvent.click(button);
      expect(onFocusResult).toHaveBeenLastCalledWith({
        ok: false,
        reason: "busy",
      });
      rerender(view(reordered));
      fireEvent.click(button);
      expect(onFocusResult).toHaveBeenLastCalledWith({ ok: true });
      expect(onSelectionChange.mock.calls.at(-1)![0].focusedCell).toEqual({
        rowIndex: 0,
        columnId: "left",
      });
    }
  );

  it("accepts an offscreen cell, clears range, preserves row selection and requests scroll without rerendering cells", () => {
    const renderCell = vi.fn((ctx) => String(ctx.value));
    const { focus, scroller, onSelectionChange } = setup({
      columns: columns.map((col) => ({ ...col, renderCell })),
      defaultSelectedRowIds: new Set([2]),
    });
    fireEvent.keyDown(scroller, { key: "ArrowDown" });
    fireEvent.keyDown(scroller, { key: "ArrowDown", shiftKey: true });
    const renders = renderCell.mock.calls.length;
    expect(focus(90, "c14")).toEqual({ ok: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      focusedCell: { rowIndex: 90, columnId: "c14" },
      range: null,
      selectedRows: new Set([2]),
    });
    expect(scroller).toHaveFocus();
    expect(scroller.scrollTop).toBe(2344);
    expect(scroller.scrollLeft).toBeGreaterThan(0);
    expect(renderCell).toHaveBeenCalledTimes(renders);
  });

  it.each(["left", "right"])(
    "focuses the %s frozen column without horizontal scrolling",
    (columnId) => {
      const { focus, scroller } = setup();
      scroller.scrollLeft = 300;
      expect(focus(90, columnId)).toEqual({ ok: true });
      expect(scroller.scrollLeft).toBe(300);
      expect(scroller.scrollTop).toBe(2344);
    }
  );

  it("validates row, column, selectability, then busy without any failure side effects", () => {
    const { focus, scroller, onSelectionChange, update } = setup();
    focus(2, "left");
    fireEvent.keyDown(scroller, { key: "ArrowDown", shiftKey: true });
    const selection = onSelectionChange.mock.calls.at(-1)![0];
    update({ loading: true });
    onSelectionChange.mockClear();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    scroller.scrollTop = 42;
    scroller.scrollLeft = 123;
    expect(focus(-1, "missing")).toEqual({
      ok: false,
      reason: "row-not-found",
    });
    expect(focus(1, "missing")).toEqual({
      ok: false,
      reason: "column-not-found",
    });
    expect(focus(1, "action")).toEqual({ ok: false, reason: "not-selectable" });
    expect(focus(1, "disabled")).toEqual({
      ok: false,
      reason: "not-selectable",
    });
    expect(focus(1, "left")).toEqual({ ok: false, reason: "busy" });
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(42);
    expect(scroller.scrollLeft).toBe(123);
    expect(outside).toHaveFocus();
    update({ loading: false });
    fireEvent.keyDown(scroller, { key: "ArrowDown", shiftKey: true });
    expect(onSelectionChange.mock.calls.at(-1)![0].range.anchor).toEqual(
      selection.range.anchor
    );
    outside.remove();
  });

  it("uses current rows and columns, including commands in a parent's layout effect", () => {
    const ref = createRef<DataGridHandle>();
    const onSelectionChange = vi.fn();
    function Parent({ data }: { data: Row[] }) {
      useLayoutEffect(() => {
        ref.current!.focusCell({ rowId: 2, columnId: "left" });
      }, [data]);
      return (
        <DataGrid
          {...base}
          rows={data}
          ref={ref}
          onSelectionChange={onSelectionChange}
        />
      );
    }
    const { rerender } = render(<Parent data={rows} />);
    rerender(<Parent data={[rows[2], rows[0], rows[1]]} />);
    // A passive reconciliation must not reinterpret the new command's row index as an old index.
    expect(onSelectionChange.mock.calls.at(-1)![0].focusedCell).toEqual({
      rowIndex: 0,
      columnId: "left",
    });
  });

  it("honors changed selectability and newly supplied columns", () => {
    const { focus, update } = setup();
    expect(focus(0, "left")).toEqual({ ok: true });
    update({ columns: [{ ...columns[0], selectable: false }] });
    expect(focus(0, "left")).toEqual({ ok: false, reason: "not-selectable" });
    update({ columns: [{ ...columns[0], id: "new", frozen: "right" }] });
    expect(focus(0, "new")).toEqual({ ok: true });
  });

  it("updates ref validation after data/column changes and clears the ref on unmount", () => {
    const { focus, update, unmount, ref } = setup();
    update({ rows: [rows[2]], columns: [columns[2]] });
    expect(focus(1, "left")).toEqual({ ok: false, reason: "row-not-found" });
    expect(focus(2, "left")).toEqual({ ok: false, reason: "column-not-found" });
    expect(focus(2, "c1")).toEqual({ ok: true });
    update({ rows: null });
    expect(focus(2, "c1")).toEqual({ ok: false, reason: "row-not-found" });
    unmount();
    expect(ref.current).toBeNull();
  });

  it("preserves an active draft, validation errors and missing-target drafts", () => {
    const onCellCommit = vi.fn();
    const { focus, scroller, update } = setup({
      onCellCommit,
      columns: columns.map((col) => ({ ...col, validate: () => "Invalid" })),
    });
    focus(0, "left");
    fireEvent.keyDown(scroller, { key: "Enter" });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Draft" } });
    expect(focus(1, "left")).toEqual({ ok: false, reason: "busy" });
    expect(input).toHaveValue("Draft");
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(focus(1, "left")).toEqual({ ok: false, reason: "busy" });
    expect(screen.getByText("Invalid")).toBeInTheDocument();
    update({ rows: rows.slice(1) });
    expect(focus(1, "left")).toEqual({ ok: false, reason: "busy" });
    expect(screen.getByText(/Your draft is preserved/)).toBeInTheDocument();
    expect(onCellCommit).not.toHaveBeenCalled();
  });

  it("allows focus while an accepted save is pending, without settling it", async () => {
    let resolve!: () => void;
    const save = new Promise<void>((done) => {
      resolve = done;
    });
    const { focus, scroller } = setup({ onCellCommit: () => save });
    focus(0, "left");
    fireEvent.keyDown(scroller, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Saving" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(focus(0, "left")).toEqual({ ok: true });
    expect(screen.getByText("Saving")).toBeInTheDocument();
    await act(async () => resolve());
    expect(screen.queryByText("Saving")).not.toBeInTheDocument();
  });

  it.each([
    [50, 48, "selection"],
    [100, 16, "resize"],
    [50, 16, "pre-threshold reorder"],
  ])(
    "blocks an active %s/%s %s gesture and recovers after capture loss",
    (x, y) => {
      const { focus, scroller, onSelectionChange } = setup();
      pointer(scroller, Number(x), Number(y));
      onSelectionChange.mockClear();
      expect(focus(90, "c14")).toEqual({ ok: false, reason: "busy" });
      expect(onSelectionChange).not.toHaveBeenCalled();
      expect(scroller.scrollTop).toBe(0);
      fireEvent.lostPointerCapture(scroller, { pointerId: 1 });
      expect(focus(90, "c14")).toEqual({ ok: true });
    }
  );

  it("recovers from gesture cancellation by loading and ignores non-gesture presses", () => {
    const { focus, scroller, update } = setup({ enableRowSelection: true });
    pointer(scroller, 90, 16);
    fireEvent.pointerMove(scroller, {
      clientX: 130,
      clientY: 16,
      pointerId: 1,
    });
    expect(focus(1, "left")).toEqual({ ok: false, reason: "busy" });
    update({ loading: true });
    update({ loading: false });
    expect(focus(1, "left")).toEqual({ ok: true });
    pointer(scroller, 20, 48);
    expect(focus(2, "left")).toEqual({ ok: true });
  });
});
