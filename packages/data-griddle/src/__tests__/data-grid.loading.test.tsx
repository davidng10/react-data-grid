import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataGrid } from "../data-grid";

import type { CellEditContext, Column, DataGridProps } from "../core/types";

type Row = { id: number; value: string };
const ROWS: Row[] = [
  { id: 1, value: "one" },
  { id: 2, value: "two" },
];
const columns: Column<Row>[] = [
  {
    id: "value",
    name: "Value",
    width: 100,
    accessor: (r) => r.value,
    editable: true,
  },
  { id: "other", name: "Other", width: 100, accessor: (r) => r.id },
];
const getRowId = (r: Row) => r.id;

function setup(initial: Partial<DataGridProps<Row>> = {}) {
  let props = { rows: ROWS, columns, getRowId, ...initial };
  const result = render(<DataGrid {...props} />);
  const scroller =
    result.container.querySelector<HTMLElement>('[tabindex="0"]')!;
  return {
    ...result,
    scroller,
    update(next: Partial<DataGridProps<Row>>) {
      props = { ...props, ...next };
      result.rerender(<DataGrid {...props} />);
    },
  };
}

function pointer(
  el: HTMLElement,
  type: "down" | "move" | "up",
  x: number,
  y: number
) {
  const event = { clientX: x, clientY: y, button: 0, pointerId: 1 };
  if (type === "down") fireEvent.pointerDown(el, event);
  if (type === "move") fireEvent.pointerMove(el, event);
  if (type === "up") fireEvent.pointerUp(el, event);
}

function edit(scroller: HTMLElement) {
  pointer(scroller, "down", 50, 48);
  pointer(scroller, "up", 50, 48);
  fireEvent.keyDown(scroller, { key: "Enter" });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
}

describe("loading display", () => {
  it.each([null, undefined])(
    "distinguishes missing %s from a completed empty result",
    (rows) => {
      const read = vi.fn((r: Row) => r.value);
      const identify = vi.fn(getRowId);
      const { container, update } = setup({
        rows,
        getRowId: identify,
        columns: [{ ...columns[0], accessor: read }],
      });
      expect(screen.getByText("Value")).toBeInTheDocument();
      expect(screen.queryByText("No rows")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      update({ loading: true });
      expect(screen.getByRole("status")).toHaveTextContent("Loading data");
      expect(
        container.querySelector('[data-grid-state="initial-loading"]')
      ).toBeInTheDocument();
      expect(
        container.querySelector(".dgr-loading-spinner")
      ).not.toBeInTheDocument();
      expect(identify).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      update({ rows: [], loading: false });
      expect(screen.getByText("No rows")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      update({ rows: ROWS });
      expect(screen.getByText("one")).toBeInTheDocument();
      expect(screen.queryByText("No rows")).not.toBeInTheDocument();
    }
  );

  it("refreshes both empty and populated results with an overlay", () => {
    const { container, update, scroller } = setup({
      loading: true,
      "aria-label": "People",
    });
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(scroller).toHaveAttribute("aria-busy", "true");
    expect(scroller).toHaveAttribute("aria-label", "People");
    expect(
      container.querySelector('[data-grid-state="refreshing"]')
    ).toBeInTheDocument();
    expect(container.querySelector(".dgr-loading-spinner")).toBeInTheDocument();
    update({ rows: [] });
    expect(screen.getByText("No rows")).toBeInTheDocument();
    expect(
      container.querySelector('[data-grid-state="refreshing"]')
    ).toBeInTheDocument();
    update({ loading: false });
    expect(scroller).toHaveAttribute("aria-busy", "false");
    expect(
      container.querySelector('[data-grid-state="refreshing"]')
    ).not.toBeInTheDocument();
  });

  it("replaces only indicator and empty content and keeps accessible loading status", () => {
    const { update, container } = setup({
      rows: [],
      loading: true,
      loadingIndicator: <b>Fetching</b>,
      emptyContent: <p>Nothing matches</p>,
      loadingLabel: "Updating people",
    });
    expect(screen.getByText("Fetching")).toBeInTheDocument();
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Updating people");
    expect(
      container.querySelector(".dgr-loading-spinner")
    ).not.toBeInTheDocument();
    update({ loadingIndicator: null, emptyContent: null });
    expect(screen.queryByText("Fetching")).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing matches")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Updating people");
  });
});

describe("loading interactions", () => {
  it("parses a resumed draft only once when committing and moving to the next cell", () => {
    const parse = vi.fn((value: unknown) => String(value).toUpperCase());
    const commit = vi.fn();
    const { scroller, update } = setup({
      columns: [{ ...columns[0], parseValue: parse }],
      onCellCommit: commit,
    });
    edit(scroller);
    update({ loading: true });
    update({ loading: false, rows: [ROWS[1], ROWS[0]] });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ rowId: 1, nextValue: "DRAFT" })
    );
  });

  it("stops selection auto-scroll and preserves the reached range when loading starts", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    try {
      const selection = vi.fn();
      const { scroller, update } = setup({
        rows: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          value: String(i),
        })),
        onSelectionChange: selection,
      });
      Object.defineProperty(scroller, "scrollHeight", {
        configurable: true,
        value: 3200,
      });
      pointer(scroller, "down", 50, 48);
      pointer(scroller, "move", 150, 590);
      const range = selection.mock.calls.at(-1)?.[0].range;
      expect(range).toBeTruthy();
      const scrollBefore = scroller.scrollTop;
      update({ loading: true });
      const queued = [...frames.values()];
      frames.clear();
      act(() => queued.forEach((callback) => callback(0)));
      pointer(scroller, "move", 50, 300);
      expect(scroller.scrollTop).toBe(scrollBefore);
      expect(selection.mock.calls.at(-1)?.[0].range).toEqual(range);
      update({ loading: false });
      pointer(scroller, "move", 50, 400);
      expect(selection.mock.calls.at(-1)?.[0].range).toEqual(range);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not block a second grid when the first is loading", () => {
    render(
      <>
        <DataGrid
          rows={ROWS}
          loading
          columns={columns}
          getRowId={getRowId}
          aria-label="Busy"
        />
        <DataGrid
          rows={ROWS}
          columns={columns}
          getRowId={getRowId}
          aria-label="Ready"
        />
      </>
    );
    const ready = screen.getByLabelText("Ready");
    edit(ready);
    expect(screen.getByRole("textbox")).toHaveValue("draft");
    expect(screen.getByLabelText("Busy")).toHaveAttribute("inert");
    expect(ready).not.toHaveAttribute("inert");
  });

  it("restores paused editor focus unless the user has focused an outside control", () => {
    const { scroller, update } = setup();
    edit(scroller);
    const input = screen.getByRole("textbox");
    expect(input).toHaveFocus();
    update({ loading: true });
    // jsdom does not implement the browser's blur when a focused node becomes display:none.
    act(() => input.blur());
    update({ loading: false });
    expect(input).toHaveFocus();
    update({ loading: true });
    act(() => input.blur());
    const external = document.createElement("button");
    document.body.append(external);
    act(() => external.focus());
    update({ loading: false });
    expect(external).toHaveFocus();
    external.remove();
  });

  it("uses current rows and handlers when a custom editor retains its original commit callback", () => {
    let retained: CellEditContext<Row> | undefined;
    const oldCommit = vi.fn();
    const newCommit = vi.fn();
    const customColumns: Column<Row>[] = [
      {
        ...columns[0],
        renderEditor: (ctx) => {
          retained ??= ctx;
          return (
            <input
              aria-label="Custom editor"
              value={String(ctx.draft)}
              onChange={(e) => ctx.setDraft(e.target.value)}
            />
          );
        },
      },
    ];
    const { scroller, update } = setup({
      columns: customColumns,
      onCellCommit: oldCommit,
    });
    edit(scroller);
    const original = retained!;
    update({ loading: true });
    act(() => original.commit());
    expect(oldCommit).not.toHaveBeenCalled();
    update({ rows: [ROWS[1]], loading: false, onCellCommit: newCommit });
    act(() => original.commit());
    expect(oldCommit).not.toHaveBeenCalled();
    expect(newCommit).not.toHaveBeenCalled();
    update({ rows: [ROWS[1], { id: 1, value: "updated on server" }] });
    act(() => original.commit());
    expect(newCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: 1,
        previousValue: "updated on server",
        nextValue: "draft",
      })
    );
  });

  it("blocks selection, keyboard editing, checkboxes and custom header/cell actions", () => {
    const action = vi.fn();
    const selection = vi.fn();
    const { scroller, update } = setup({
      loading: true,
      enableRowSelection: true,
      onSelectedRowIdsChange: selection,
      columns: [
        {
          ...columns[0],
          renderHeader: () => <button onClick={action}>Header action</button>,
          renderCell: () => <button onClick={action}>Row action</button>,
        },
      ],
    });
    pointer(scroller, "down", 90, 48);
    pointer(scroller, "up", 90, 48);
    fireEvent.keyDown(scroller, { key: "Enter" });
    fireEvent.click(screen.getByText("Header action"));
    fireEvent.click(screen.getAllByText("Row action")[0]);
    fireEvent.click(screen.getByLabelText("Select all rows"));
    expect(action).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    update({ loading: false });
    fireEvent.click(screen.getByText("Header action"));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it.each(["resize", "reorder"])(
    "aborts an active %s without committing on release or lost capture",
    (gesture) => {
      const resize = vi.fn();
      const reorder = vi.fn();
      const { scroller, update } = setup({
        onColumnWidthsChange: resize,
        onColumnOrderChange: reorder,
      });
      pointer(scroller, "down", gesture === "resize" ? 100 : 50, 16);
      pointer(scroller, "move", 175, 16);
      update({ loading: true });
      pointer(scroller, "up", 175, 16);
      update({ loading: false });
      pointer(scroller, "up", 175, 16);
      fireEvent.lostPointerCapture(scroller);
      expect(resize).not.toHaveBeenCalled();
      expect(reorder).not.toHaveBeenCalled();
      expect(scroller.style.cursor).toBe("");
    }
  );

  it("suspends the editor without committing and resumes the draft on its stable row", () => {
    const commit = vi.fn();
    const { scroller, update } = setup({ onCellCommit: commit });
    edit(scroller);
    update({ loading: true });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(scroller, { key: "Enter" });
    expect(commit).not.toHaveBeenCalled();
    update({ rows: [ROWS[1], ROWS[0]], loading: false });
    expect(screen.getByRole("textbox")).toHaveValue("draft");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: 1,
        previousValue: "one",
        nextValue: "draft",
      })
    );
  });

  it("preserves an unavailable draft until its row returns or the user discards it", () => {
    const commit = vi.fn();
    const { scroller, update } = setup({ onCellCommit: commit });
    edit(scroller);
    update({ rows: null, loading: true });
    update({ rows: [ROWS[1]], loading: false });
    expect(screen.getByText(/Your draft is preserved/)).toBeInTheDocument();
    fireEvent.keyDown(scroller, { key: "Enter" });
    fireEvent.pointerDown(document.body);
    expect(commit).not.toHaveBeenCalled();
    update({ rows: ROWS });
    expect(screen.getByRole("textbox")).toHaveValue("draft");
    update({ rows: null });
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    update({ rows: ROWS });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(commit).not.toHaveBeenCalled();
  });

  it("lets a pending save settle while refreshing", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const commit = vi.fn(() => pending);
    const { scroller, update } = setup({ onCellCommit: commit });
    edit(scroller);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    update({ loading: true });
    expect(screen.getByText("draft")).toBeInTheDocument();
    await act(async () => finish());
    expect(screen.queryByText("draft")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

it("remounts a suspended draft with its current grid theme", () => {
  const { scroller, update } = setup({
    style: { "--dgr-background": "black" } as React.CSSProperties,
  });
  edit(scroller);
  expect(
    document
      .querySelector<HTMLElement>(".dgr-editor-host")
      ?.style.getPropertyValue("--dgr-background")
  ).toBe("black");
  update({ rows: null, loading: true });
  expect(document.querySelector(".dgr-editor-host")).toBeNull();
  update({
    rows: ROWS,
    loading: false,
    style: { "--dgr-background": "navy" } as React.CSSProperties,
  });
  expect(screen.getByRole("textbox")).toHaveValue("draft");
  expect(
    document
      .querySelector<HTMLElement>(".dgr-editor-host")
      ?.style.getPropertyValue("--dgr-background")
  ).toBe("navy");
});

it.each([13, 17])(
  "remeasures a long draft when a %ipx theme resumes from a hidden refresh",
  async (fontSize) => {
    const measured = vi
      .spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLTextAreaElement) {
        if (this.parentElement?.style.display === "none") return 0;
        return this.parentElement?.style.fontSize === "17px" ? 80 : 64;
      });
    try {
      const { scroller, update } = setup({ style: { fontSize: 13 } });
      edit(scroller);
      const textarea = screen.getByRole("textbox");
      update({ loading: true, rowHeight: 44, style: { fontSize } });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      update({ loading: false });
      expect(textarea).toHaveValue("draft");
      expect(textarea.style.height).toBe(fontSize === 17 ? "80px" : "64px");
    } finally {
      measured.mockRestore();
    }
  }
);
