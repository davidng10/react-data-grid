# Better React Grid - A performant React Data Grid

A virtualized, DOM-based data grid for React. The component supports large datasets while keeping
selection, editing, and pointer interactions off the main cell-rendering path.

## Features

- Virtualized rows and center columns
- Left and right frozen columns
- Cell focus, range selection, and checkbox row selection
- Keyboard navigation and type-to-edit
- Custom read and edit renderers
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
- `editable` enables editing; `renderEdit` can provide a custom editor.
- `parseValue` converts a draft before validation and commit.
- `validate` returns an error message to reject a value.
- `onCommit` overrides the grid-level `onCellCommit` for one column.
- `frozen` pins a column to the left or right zone.
- `resizable: false` disables resizing for one column.
- `type: 'action'` makes a column non-selectable, non-editable, and non-resizable.

Column order is controlled through `columnOrder` and `onColumnOrderChange`. Resized widths are kept
for the current mount; use `onColumnResize` to persist them and provide the saved value as the
column's next initial `width`.

## Development

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

See [INTERNALS.md](./INTERNALS.md) for the rendering model and performance constraints.
