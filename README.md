# Data Griddle - A performant React Data Grid

A virtualized, DOM-based data grid for React. The component supports large datasets while keeping
selection, editing, and pointer interactions off the main cell-rendering path.

## Features

- Virtualized rows and center columns
- Left and right frozen columns
- Cell focus, range selection, and checkbox row selection
- Keyboard navigation and type-to-edit
- Custom cell, header, editor, and selection-checkbox renderers
- Stable-ID imperative cell focus
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

## Loading and empty results

Pass application-owned request activity through `loading` (default `false`). The required `rows`
prop accepts `null` and `undefined` for an unavailable result; an empty array means a completed
result with no rows. Preserve that distinction instead of replacing missing data with `[]`.

```tsx
<DataGrid
  rows={data}
  loading={isFetching}
  columns={columns}
  getRowId={(row) => row.id}
  aria-label="People"
  loadingLabel="Updating people"
  emptyContent={<span>No matching people</span>}
/>
```

Here `data` and `isFetching` come from your application. The grid does not fetch or cache data.

| Rows                 | Loading | Display                                                                      |
| -------------------- | ------- | ---------------------------------------------------------------------------- |
| `null` / `undefined` | `true`  | Headers and skeleton rows, without a spinner                                 |
| `null` / `undefined` | `false` | Headers and a blank body; the app handles errors or instructions             |
| Any array            | `true`  | Retained result beneath an overlay covering headers and body, with a spinner |
| `[]`                 | `false` | Empty content, defaulting to “No rows”                                       |
| Populated array      | `false` | Normal grid                                                                  |

Keep supplying previous rows during sorting, filtering, or pagination requests to retain them under
the overlay. Passing missing rows removes that result and shows the initial skeleton while loading.
Initial skeleton bars gently pulse to show activity. The existing skeleton fallback for virtualized
rendering gaps stays static and works independently of `loading`.

`loadingIndicator` replaces only the refresh indicator; the grid owns overlay placement and behavior.
`emptyContent` replaces empty-result content. Explicit `null` hides either visual. Keep custom
indicators noninteractive; `loadingLabel` supplies the accessible announcement independently.
The default spinner always rotates, including when reduced motion is enabled. Custom indicators
control their own animation behavior.

Loading blocks pointer and keyboard interactions inside the grid, including custom cell/header
controls and the editor portal. Outside controls remain usable. Active resize/reorder gestures are
cancelled without committing, selection stops at its current range, and pending saves finish normally.
An active editor is paused with its draft intact and resumes against the same row ID. If the edited
row or column disappears, a notice preserves the draft until its target returns or you explicitly
discard it. Focus is restored after a background refresh unless you moved it to another control.
As usual, an outside click before loading begins may commit an edit.

`id`, `className`, and `style` apply to the stationary outer frame; accessible naming applies to the
focusable inner scroller. Code that previously used the root element as the scroll container must
account for this new wrapper. Loading styles are imported with the component. Customize their
colors through CSS variables on the frame:

```css
.my-grid {
  --dgr-loading-overlay-background: rgb(255 255 255 / 65%);
  --dgr-loading-indicator-color: #57534e;
  --dgr-empty-color: #78716c;
}
```

Run the playground and open `/loading` to exercise initial load, refresh, empty results, custom
indicators, and a delayed background refresh while editing.

## Column behavior

Explicit column widths are preserved, even when they leave unused space. The last column in visual
order without a `width` or a width override fills the remaining viewport width; earlier unspecified
columns use the 140px default. The available space excludes the checkbox gutter and all other
columns, including frozen columns. Automatic sizing respects `minWidth` (48px by default) and
`maxWidth`: insufficient room causes horizontal scrolling, while a maximum can leave unused space.

Manually resizing an automatic column gives it an explicit width for the session. The last remaining
unspecified column then fills the space, if there is one. Controlled `columnWidths` and
`defaultColumnWidths` also count as explicit widths. Removing a controlled override restores the
column's eligibility for automatic sizing when its schema has no `width`. Container-driven sizing
does not emit `onColumnWidthsChange`.

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

## Styling and themes

Default styles are scoped to grid-owned classes and import with the source component. Set
`--dgr-*` variables on the frame or an ancestor; active body-mounted editors copy their originating
grid's theme. Columns accept `cellClassName` and `headerClassName` as strings or context callbacks.
Use `rowHeight` and column widths for geometry; CSS controls appearance.

See the [styling contract](./docs/STYLING.md) for tokens, defaults, parts, callback contexts, and
portal synchronization limits. `/styling` demonstrates two independent themes; `/styling-check.html`
runs the same examples without the playground reset.

## Integration APIs

See the [integration guide](./docs/INTEGRATION.md) for controlled/uncontrolled/read-only state,
stable identity, editing and persistence, custom selection controls, and the `DataGridHandle.focusCell`
command. Run `pnpm dev` and open `/integration` for focused examples using only the public entry.

npm is the first-release distribution target; this repository currently demonstrates source usage.
Stores and geometry helpers remain private. React 18/19 and Next.js are compatibility targets;
React 18 and Next.js have not yet been verified.
