# Better React Grid - A performant React Data Grid

A virtualized, DOM-based data grid for React. The component supports large datasets while keeping
selection, editing, and pointer interactions off the main cell-rendering path.

## Features

- Virtualized rows and center columns
- Left and right frozen columns
- Cell focus, range selection, and checkbox row selection
- Keyboard navigation and type-to-edit
- Custom cell, header, and editor renderers
- Synchronous validation and asynchronous commits
- Within-zone column reordering
- Column resizing with optional persistence callbacks

## Usage

The component is self-contained in `src/data-grid` and is exported from
`src/data-grid/index.ts`.

```tsx
import { useState } from "react";

import { DataGrid } from "./data-grid";

import type { CellCommit, Column } from "./data-grid";

type Person = {
  id: number;
  name: string;
  role: string;
};

const columns: Column<Person>[] = [
  {
    id: "name",
    name: "Name",
    width: 220,
    frozen: "left",
    accessor: (row) => row.name,
    editable: true,
  },
  {
    id: "role",
    name: "Role",
    width: 180,
    accessor: (row) => row.role,
    editable: true,
  },
];

export function PeopleGrid() {
  const [rows, setRows] = useState<Person[]>([
    { id: 1, name: "Ada", role: "Engineer" },
  ]);
  const [columnOrder, setColumnOrder] = useState(
    columns.map((column) => column.id)
  );

  const commit = ({ rowId, columnId, nextValue }: CellCommit<Person>) => {
    setRows((current) =>
      current.map((row) =>
        row.id === rowId ? { ...row, [columnId]: nextValue } : row
      )
    );
  };

  return (
    <div style={{ height: 480 }}>
      <DataGrid
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        columnOrder={columnOrder}
        onColumnOrderChange={setColumnOrder}
        onCellCommit={commit}
        enableRowSelection
      />
    </div>
  );
}
```

The grid fills its parent, so its container must have a defined height. Row data remains owned by
the caller; commit handlers must update `rows` with accepted values.

## Column behavior

- `accessor` reads the displayed value from a row.
- `editable` enables editing; `renderEditor` can provide a custom editor.
- `renderCell` and `renderHeader` customize read-mode cells and headers.
- `parseValue` converts a draft before validation and commit.
- `validate` returns an error message to reject a value.
- `onCommit` overrides the grid-level `onCellCommit` for one column.
- `frozen` pins a column to the left or right zone.
- `selectable`, `resizable`, `reorderable`, and `reorderBarrier` customize normal-column behavior.
- `type: 'action'` is always non-selectable, non-editable, non-resizable, non-reorderable, and a
  reorder barrier; explicit capability props cannot override those invariants.

Row selection, column order, and column widths support controlled and uncontrolled use through
`value`/`defaultValue`/`onChange`-style prop groups. Reordering and resizing work internally by
default. A controlled value without its change callback is read-only and its matching affordances
are disabled.

Frozen columns are always rendered rather than horizontally virtualized. Keep the number frozen on
each side small for large grids.

## Development

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

See [INTERNALS.md](./INTERNALS.md) for the rendering model and performance constraints.
