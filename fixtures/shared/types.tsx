import { createRef } from "react";
import { DataGrid } from "data-griddle";
// @ts-expect-error Internal modules are intentionally not exported.
import { createGridStore } from "data-griddle/core/store/grid-store";

import type { Column, DataGridHandle, FocusCellResult } from "data-griddle";

const ref = createRef<DataGridHandle>();
const columns: Column<{ id: number; name: string }>[] = [
  { id: "name", name: "Name", accessor: (row) => row.name },
];
export const grid = (
  <DataGrid
    ref={ref}
    rows={[{ id: 1, name: "Ada" }]}
    columns={columns}
    getRowId={(row) => row.id}
    onCellCommit={(update) => {
      const name: string = update.row.name;
      void name;
    }}
  />
);
export const result: FocusCellResult | undefined = ref.current?.focusCell({
  rowId: 1,
  columnId: "name",
});

void createGridStore;
