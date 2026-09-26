# Integrating Data Griddle

Import components and types from `src/data-grid/index.ts` in this source playground. npm is the
first-release distribution target; package delivery is not yet available. Stores, geometry helpers,
and deep internal imports are not supported public APIs. The preview API may change.

## State ownership and defaults

The application owns `rows`, `columns`, `loading` and persistence. Supply immutable replacement
arrays/objects when data or schema changes. The grid owns transient focus, ranges, drafts and gesture
state. A row checkbox selection is independent of cell focus and ranges.

| State group   | Controlled value | Initial uncontrolled value | Change callback          |
| ------------- | ---------------- | -------------------------- | ------------------------ |
| Selected rows | `selectedRowIds` | `defaultSelectedRowIds`    | `onSelectedRowIdsChange` |
| Column order  | `columnOrder`    | `defaultColumnOrder`       | `onColumnOrderChange`    |
| Column widths | `columnWidths`   | `defaultColumnWidths`      | `onColumnWidthsChange`   |

Omit the controlled value to let the grid maintain that state. A default is read once on mount;
changing it later does not reset state. A change callback is optional in uncontrolled mode and
observes user changes. With a controlled value, the callback requests the next complete set, order
array or width map; the application must supply it back to accept it. The grid does not optimistically
replace controlled values. A controlled value without its matching callback is read-only and disables
that group's controls. Keep each group in one mode for the lifetime of a grid.

Row selection defaults off (`enableRowSelection={false}`); reordering and resizing default on.
Loading temporarily gates all three. Normal columns are selectable, resizable and reorderable by
default, but editing is opt-in. Action columns always disable these capabilities and form reorder
barriers. `rowHeight` defaults to 32px, overscan to 6 rows and 2 center columns. Column sizing defaults
and constraints are described in the [README](../README.md#column-behavior).

`onSelectionChange` observes snapshots of focus, range and selected rows, including reconciliation.
It does not receive an initial mount notification unless reconciliation changes state. Controlled
row-selection requests also emit a snapshot with the requested row set; it is a proposal until the
application updates `selectedRowIds`. Do not mutate snapshots or their sets. Focus/range coordinates
use `rowIndex`; durable application references and the imperative command use stable `rowId`.
Fully controlled focus/range props and programmatic range selection are deferred.

## Stable identity and reconciliation

`getRowId(row, index)` must return a unique, stable string or number. Use a data key rather than the
index when rows can reorder, filter or paginate. Keep each `column.id` unique and stable across
schema updates. IDs identify logical records/fields; changing an ID creates a different target.
Only currently supplied rows participate; the grid does not fetch, paginate or retain selections
across missing datasets.

On data changes, focus and range endpoints follow row IDs to their new indices. Removing the focused
row or column clears focus; removing either range endpoint clears the range. Selected row IDs absent
from current rows are pruned from the displayed selection. Controlled sets remain application-owned:
reconciliation does not call `onSelectedRowIdsChange` to rewrite them. An ID still present in the
controlled set becomes checked again if its row returns. Uncontrolled pruned IDs are forgotten.
Changing an existing column's capabilities does not itself clear an existing focus; new focus commands
validate current selectability.

Column order ignores removed/duplicate IDs and appends new columns in schema order, while frozen
zones still determine visual placement. Reordering stays within a zone and cannot cross a barrier.
Width overrides are applied by column ID and clamped to current bounds. Overrides for absent columns
are ignored but retained, so a returning column can reuse its width. Reconciliation and automatic
container sizing do not emit order/width change requests.

An active draft and pending save follow the stable row ID. If an edited row or column disappears,
the draft is preserved with a discard notice until the target returns or the user discards it.
Loading suspends the editor and its callbacks without committing; pending saves continue.

## Replaceable selection checkboxes

`renderSelectionCheckbox(props: SelectionCheckboxProps)` replaces both row controls and the header
control. Omitting it retains a native checkbox. The renderer runs in the selection gutter, keeping
selection changes off the cell rendering path. Renderers must be pure; invoke callbacks from events.

```tsx
import type { SelectionCheckboxProps } from "./data-grid";

function SelectionControl(props: SelectionCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-label={props["aria-label"]}
      aria-checked={props.indeterminate ? "mixed" : props.checked}
      aria-readonly={props.readOnly}
      disabled={props.disabled}
      onClick={props.onChange}
      style={{ width: 32, height: 32 }}
    >
      <span aria-hidden="true">
        {props.indeterminate ? "−" : props.checked ? "✓" : ""}
      </span>
    </button>
  );
}

// On your grid (a 40px row fits this control):
// enableRowSelection
// rowHeight={40}
// renderSelectionCheckbox={(props) => <SelectionControl {...props} />}
```

The exported discriminated union supplies:

- `kind: "row"` with `rowId` and current zero-based `rowIndex`, or `kind: "all"` without a row.
- `checked`, `indeterminate`, `disabled`, `readOnly`, and `"aria-label"`.
- `onChange(): void`, requesting the grid's selection toggle. It takes no event or next checked value.

`disabled` includes loading, read-only selection, and an empty select-all target. `readOnly` identifies
a controlled selection without its callback. The row control's `indeterminate` is always false.
Default accessible names are “Select all rows” and “Select row N” (one-based current row position).
Use `rowId` to look up a more descriptive name if needed, retaining a meaningful accessible label.

The header operates on **all currently supplied rows**, including virtualized offscreen rows. An
unchecked header selects all; checked or mixed clears all. Row activation toggles that ID. Callbacks
resolve the latest committed rows/state and ignore loading, read-only and removed targets, even if a
custom control retained an older callback. This guard does not replace forwarding disabled state.

Custom controls must forward every state, expose checkbox semantics and mixed state, preserve a visible
focus indicator, and support keyboard activation (at least Space). Native buttons provide Space and
Enter activation; native checkbox replacements must set the DOM `indeterminate` property. Adapt a
component library's event/value callback to call `props.onChange()` exactly once. Do not compute the
next selected set yourself. The gutter isolates keyboard and pointer-down events from cell gestures.

Keep controls inside the gutter and provide usable pointer/touch targets without changing its 40px
width. The example uses a 32px square in 40px rows; choose row height and target size for your users,
allow spacing, and test zoom, touch and assistive technology. Do not assume a tiny visual checkmark is
an adequate hit target. A disabled/read-only control must not activate. Rendering in another portal
bypasses gutter containment and is unsupported. These responsibilities also apply to custom controls
with their own nested elements. Accessibility-tree state checks are not screen-reader verification.

## Imperative cell focus

```tsx
import { useRef } from "react";

import { DataGrid } from "./data-grid";

import type { Column, DataGridHandle } from "./data-grid";

type Person = { id: string; name: string };
function People({
  rows,
  columns,
}: {
  rows: readonly Person[];
  columns: readonly Column<Person>[];
}) {
  const grid = useRef<DataGridHandle>(null);
  const jump = () => {
    const result = grid.current?.focusCell({
      rowId: "person-42",
      columnId: "name",
    });
    if (result?.ok === false) console.log(result.reason);
  };
  return (
    <>
      <button onClick={jump}>Jump to person 42</button>
      <div style={{ height: 480 }}>
        <DataGrid
          ref={grid}
          rows={rows}
          columns={columns}
          getRowId={getRowId}
        />
      </div>
    </>
  );
}
```

`DataGrid` preserves
row inference with object or callback refs. `forwardRef` and `useImperativeHandle` target React 18/19;
React 18 runtime compatibility still requires verification. Read `ref.current` at command time;
handles may be replaced after a render. An unmounted grid has a null ref.

`focusCell` returns the exported `FocusCellResult`. Validation uses the current supplied rows through
`getRowId`, then current columns, with this deterministic first-failure precedence:

| Order | Result                                      | Condition                                                                        |
| ----- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| 1     | `{ ok: false, reason: "row-not-found" }`    | No currently supplied row has that ID                                            |
| 2     | `{ ok: false, reason: "column-not-found" }` | No current column has that ID                                                    |
| 3     | `{ ok: false, reason: "not-selectable" }`   | Action column or `selectable: false`                                             |
| 4     | `{ ok: false, reason: "busy" }`             | Loading; any active/preserved editor draft; selection, resize or reorder gesture |
| 5     | `{ ok: true }`                              | Accepted                                                                         |

A claimed header press is busy even before crossing the reorder threshold. Pending asynchronous saves
alone do not block focus, including focus of the saving cell; editing that cell remains gated until
the save settles. Validation failures do not change selection, keyboard focus or scroll offsets and
never commit or discard a draft.

Success focuses the grid's keyboard scroller on the target cell, clears the range, preserves checkbox
selection and requests native scrolling into view. It handles offscreen loaded rows and center columns;
frozen columns retain horizontal scroll position. It does not promise that a virtualized cell has
already mounted or become fully visible if the viewport is smaller than the cell/frozen bands. It
never fetches or paginates. Use `onSelectionChange` to observe focus; do not access internal stores.

An outside pointer-down on a toolbar button can implicitly commit an editor **before** that button's
click calls `focusCell`. The command itself never commits. For a shortcut intended to probe focus
while editing, call from the keyboard event without first moving focus outside the editor.

## Editing, validation and persistence

`accessor` reads authoritative row values. `editable: true` or a context predicate enables editing;
action columns remain non-editable. Built-in text editing starts with Enter/F2, typing, or a second
click on a focused cell. `type: "select"` uses `options`; `renderEditor` replaces editor content.

The grid owns the draft exposed as `ctx.draft`; call `ctx.setDraft(next)` to change it. At commit time:

1. `parseValue(draft, ctx)` converts the draft synchronously (if supplied).
2. If the parsed result equals the current accessor value via `Object.is`, the editor closes without
   validation or a commit callback.
3. `validate(parsedValue, ctx)` runs for a changed value. Return a nonempty message to reject; return
   null/undefined (or an empty string) to accept. Parsers/validators should be pure and must not throw;
   convert invalid input into a value your validator can reject. Exceptions there are not async save
   errors and do not invoke `onCellCommitError`.
4. An explicit rejection keeps the draft/editor open and exposes `ctx.error`/`ctx.status`. After an
   error, draft changes revalidate after a 200ms pause. A commit immediately validates the latest draft.
   An implicit rejection discards the invalid draft so outside interaction is not trapped.
5. Acceptance closes the editor immediately and calls column `onCommit`, or grid `onCellCommit` if
   absent. The payload includes stable IDs, the current row, previous value and parsed next value.

Explicit commits include `ctx.commit()`, built-in text Enter/Tab and native-select picks. Built-in
text Enter moves down, Tab moves right, Shift+Enter inserts a newline, and Escape cancels. `ctx.commit()`
saves in place; `ctx.cancel()` discards without saving and restores grid focus. Built-in text blur and
pointer-down outside the editor host are implicit commits. Custom editors own their blur policy;
`ctx.commit()` always has explicit validation semantics.

A returned promise keeps an optimistic value/spinner overlay while saving. Thrown commit-handler errors
and rejected promises clear the pending display, flash the failed cell, and call
`onCellCommitError({ update, error })`. The accepted draft is not reopened. Focus may have moved by then.
The application must show useful failure/retry UI as needed and roll back any optimistic authoritative
row update itself. The grid never mutates or rolls back application rows.

On success, update authoritative `rows` with the persisted value before resolving your commit promise;
otherwise the overlay clears to the old accessor value. With no commit handler, acceptance simply
closes the editor and leaves rows unchanged. Loading does not cancel pending saves.

## Custom editor focus, keyboard and popups

The grid retains a themeable frame positioned in a body portal. See [styling](./STYLING.md#editor-themes)
for tokens and geometry constraints. Custom content receives `CellEditContext<T>` and inherits the
frame's theme. It must:

- Focus an appropriate input on mount, manage focus among its controls, and provide labels, visible
  focus and validation/error announcements using `ctx.status` and `ctx.error`.
- Handle commit/cancel keys deliberately, preserve native input/IME behavior, and prevent default when
  consuming keys. `ctx.commit()` does not implement Tab navigation; decide where Tab goes and avoid
  focus traps. Escape should offer cancellation. The active editor owns the keyboard.
- Keep popups in the editor host's **DOM subtree**, including library popup containers. React parentage
  alone does not suffice: a separate `document.body` popup is outside and triggers an implicit commit.
  A positioned descendant may extend beyond the frame without leaving the subtree.
- Avoid unconditional blur commits when focus moves to an internal popup. Check `relatedTarget`
  containment against a wrapper that contains all your controls, or use explicit Save/Cancel controls.
  The grid's outside-pointer listener already ignores descendants of its host.
- Use context callbacks rather than internal stores. They respect loading and current row identity.
  Keep the draft in `ctx.draft` so a suspended editor or missing target does not lose it.

Run `pnpm dev` and open `/integration` for the [runnable example](../src/playground/pages/IntegrationPlayground.tsx):
custom/native controls, controlled/read-only selection, offscreen and frozen focus, row reversal and a
nested status popup. Unit integration tests exercise popup selection without an accidental commit.
React 18, Next.js, other browser engines, physical mobile devices and assistive technology remain
unverified; this source example is not package compatibility evidence.
