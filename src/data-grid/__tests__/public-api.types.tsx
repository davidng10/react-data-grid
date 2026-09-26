// Compiled by tsc: keep generic row inference and the ref boundary checked at consumer call sites.
import { createRef } from "react";
import { expectTypeOf } from "vitest";

import { DataGrid } from "../index";

import type {
  DataGridHandle,
  FocusCellResult,
  RowId,
  SelectionCheckboxProps,
} from "../index";

const ref = createRef<DataGridHandle>();
const rows = [{ id: 1, name: "Ada" }];
export const inferred = (
  <DataGrid
    ref={ref}
    rows={rows}
    columns={[
      {
        id: "name",
        name: "Name",
        accessor: (row) => {
          expectTypeOf(row).toEqualTypeOf<{ id: number; name: string }>();
          // @ts-expect-error Row inference must not widen to any.
          void row.missing;
          return row.name;
        },
      },
    ]}
    getRowId={(row) => {
      expectTypeOf(row.id).toEqualTypeOf<number>();
      return row.id;
    }}
    onCellCommit={(update) => {
      expectTypeOf(update.row.name).toEqualTypeOf<string>();
    }}
    renderSelectionCheckbox={(props) => {
      expectTypeOf(props).toEqualTypeOf<SelectionCheckboxProps>();
      if (props.kind === "row") {
        expectTypeOf(props.rowId).toEqualTypeOf<RowId>();
        expectTypeOf(props.rowIndex).toEqualTypeOf<number>();
      } else {
        // @ts-expect-error Select-all has no row identity.
        void props.rowId;
      }
      return null;
    }}
  />
);

export const callbackRef = (
  <DataGrid
    rows={rows}
    columns={[]}
    getRowId={(row) => row.id}
    ref={(handle) => {
      expectTypeOf(handle).toEqualTypeOf<DataGridHandle | null>();
      if (handle) {
        const result = handle.focusCell({ rowId: 1, columnId: "name" });
        expectTypeOf(result).toEqualTypeOf<FocusCellResult>();
        if (result.ok === false)
          expectTypeOf(result.reason).toEqualTypeOf<
            "row-not-found" | "column-not-found" | "not-selectable" | "busy"
          >();
        // @ts-expect-error Stores are not exposed on the public handle.
        void handle.store;
        // @ts-expect-error Programmatic range selection remains deferred.
        handle.selectRange({});
        // @ts-expect-error Focus targets stable row IDs, not row indices.
        handle.focusCell({ rowIndex: 0, columnId: "name" });
      }
    }}
  />
);

export const wrongRef = (
  <DataGrid
    rows={rows}
    columns={[]}
    getRowId={(row) => row.id}
    // @ts-expect-error A DOM ref cannot receive the public handle.
    ref={createRef<HTMLDivElement>()}
  />
);
