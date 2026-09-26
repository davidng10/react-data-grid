import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataGrid } from "../index";

import type { DataGridProps, SelectionCheckboxProps } from "../index";

const rows = [{ id: 1 }, { id: 2 }];
const columns = [
  {
    id: "id",
    name: "ID",
    accessor: (row: { id: number }) => row.id,
    editable: true,
  },
];
const base = {
  rows,
  columns,
  getRowId: (row: { id: number }) => row.id,
  enableRowSelection: true,
};
function control(props: SelectionCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-label={props["aria-label"]}
      aria-checked={props.indeterminate ? "mixed" : props.checked}
      aria-readonly={props.readOnly}
      disabled={props.disabled}
      onClick={props.onChange}
    >
      {props.kind === "row" ? props.rowId : "All"}
    </button>
  );
}
function setup(props: Partial<DataGridProps<{ id: number }>> = {}) {
  return render(
    <DataGrid {...base} renderSelectionCheckbox={control} {...props} />
  );
}

describe("replaceable selection controls", () => {
  it("supplies row identity, mixed state and grid-owned mixed-header clearing", () => {
    setup({ defaultSelectedRowIds: new Set([1]) });
    const all = screen.getByRole("checkbox", { name: "Select all rows" });
    expect(all).toHaveAttribute("aria-checked", "mixed");
    expect(
      screen.getByRole("checkbox", { name: "Select row 1" })
    ).toHaveTextContent("1");
    fireEvent.click(all);
    expect(all).toHaveAttribute("aria-checked", "false");
    fireEvent.click(all);
    expect(all).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row 2" }));
    expect(all).toHaveAttribute("aria-checked", "mixed");
  });

  it("emits controlled requests without changing authoritative checks", () => {
    const onSelectedRowIdsChange = vi.fn();
    setup({ selectedRowIds: new Set([1]), onSelectedRowIdsChange });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select row 2" }));
    expect(onSelectedRowIdsChange).toHaveBeenLastCalledWith(new Set([1, 2]));
    expect(
      screen.getByRole("checkbox", { name: "Select row 2" })
    ).toHaveAttribute("aria-checked", "false");
  });

  it("guards retained callbacks using current state, loading, read-only and removed rows", () => {
    let retained: (() => void) | undefined;
    const renderSelectionCheckbox = (props: SelectionCheckboxProps) => {
      if (props.kind === "row" && props.rowId === 2)
        retained ??= props.onChange;
      return control(props);
    };
    const onSelectedRowIdsChange = vi.fn();
    const props = { ...base, renderSelectionCheckbox, onSelectedRowIdsChange };
    const { rerender } = render(<DataGrid {...props} />);
    expect(retained).toBeTypeOf("function");
    act(() => retained!());
    act(() => retained!());
    expect(onSelectedRowIdsChange).toHaveBeenLastCalledWith(new Set());
    onSelectedRowIdsChange.mockClear();
    rerender(<DataGrid {...props} loading />);
    act(() => retained!());
    expect(onSelectedRowIdsChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", { name: "Select row 2", hidden: true })
    ).toBeDisabled();
    rerender(
      <DataGrid
        {...props}
        selectedRowIds={new Set([1])}
        onSelectedRowIdsChange={undefined}
      />
    );
    act(() => retained!());
    expect(
      screen.getByRole("checkbox", { name: "Select row 2" })
    ).toHaveAttribute("aria-readonly", "true");
    rerender(<DataGrid {...props} rows={[rows[0]]} />);
    act(() => retained!());
    expect(onSelectedRowIdsChange).not.toHaveBeenCalled();
  });

  it("keeps control keys out of cell navigation and editing", () => {
    const onSelectionChange = vi.fn();
    const { container } = setup({ onSelectionChange });
    const scroller = container.querySelector("[data-grid-scroller]")!;
    fireEvent.keyDown(scroller, { key: "ArrowDown" });
    onSelectionChange.mockClear();
    const checkbox = screen.getByRole("checkbox", { name: "Select row 1" });
    fireEvent.keyDown(checkbox, { key: "ArrowDown" });
    fireEvent.keyDown(checkbox, { key: " " });
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("retains the native default and disables an empty select-all", () => {
    const { rerender } = render(
      <DataGrid {...base} defaultSelectedRowIds={new Set([1])} />
    );
    expect(
      screen.getByRole("checkbox", { name: "Select all rows" })
    ).toBePartiallyChecked();
    rerender(<DataGrid {...base} rows={[]} />);
    expect(
      screen.getByRole("checkbox", { name: "Select all rows" })
    ).toBeDisabled();
  });
});
