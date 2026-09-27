# Data grid internals

This guide covers the constraints that are easy to miss when changing `src/data-grid`. Public usage
belongs in `README.md`; implementation history does not belong in either document.

## Structure

```text
src/data-grid/data-grid.tsx              React shell and interaction composition
src/data-grid/components/                headers, cells, zones, and overlays
src/data-grid/hooks/                     layout, editing, keyboard, and pointer gestures
src/data-grid/core/store/                plain TypeScript observable stores
src/data-grid/core/selection/geometry.ts pure navigation and overlay geometry
src/data-grid/core/types/                public data and column contracts
src/data-grid/editors/                   portal host and built-in editors
src/data-grid/internal/                  shared layout, styling, and utility code
```

`src/playground` is a demo harness and is not part of the component.

## Rendering model

The grid uses one native scroll container. A flex row contains the optional checkbox gutter and
three column zones:

```text
stationary frame
├── scroll container    isolated stacking context
│   └── flex body
│       ├── row gutter       sticky left
│       ├── left zone        sticky left
│       ├── center zone      horizontally virtualized
│       └── right zone       sticky right
└── status layers       empty content / initial skeleton / refresh overlay
```

Each zone owns a sticky header. Frozen zones remain opaque and render above the center zone so
scrolling cells cannot show through them.

Rows have a uniform height and are vertically virtualized. Only center columns are horizontally
virtualized; frozen columns are expected to remain a small set and are always rendered for each
visible row. Cells are absolutely positioned with transforms inside their zone.

The frame owns public id/className/style and stable viewport presentation. The inner scroller owns
scrollRef, accessible naming, and keyboard focus. A refresh overlay covers headers and frozen zones
without entering their scroll coordinates. Initial skeletons fill the visible body without adding
fake rows. `DataGrid` records whether supplied rows are available, then normalizes null/undefined to
a shared empty array; internal hooks and row renderers retain their array/nonnullable-row contracts.

Loading uses inert content plus capture guards, including React events bubbling from the body
editor portal. A layout effect cancels gestures and releases pointer capture. Resize cancellation and lost capture
both discard the guide; only a clean pointer-up commits.
Keep network loading independent of `EmptyRowsLayer` behind virtualized cells.

## Coordinate spaces

Interactions convert between four coordinate spaces:

| Space          | Origin                   | Used by                                |
| -------------- | ------------------------ | -------------------------------------- |
| Viewport       | Visible scroll box       | Pointer events and sticky regions      |
| Scroll content | Full scrollable body     | Conceptual grid layout                 |
| Zone local     | Start of one column zone | Cell and overlay transforms            |
| Cell address   | `{ rowIndex, columnId }` | Selection, editing, and keyboard state |

The center zone includes `scrollLeft` when converting a viewport point to zone-local x. Frozen
zones do not because they remain pinned. Vertical hit testing subtracts the sticky header before
applying `scrollTop`.

Keep conversions in `useGridGeometryHelpers.ts` or the pure geometry module. Duplicating this math
inside gestures makes frozen-zone boundary bugs likely.

## State and overlays

Interaction state lives in small observable stores:

| Store         | Subscriber                        | Purpose                                  |
| ------------- | --------------------------------- | ---------------------------------------- |
| Grid store    | Selection overlays and row gutter | Focus, range, and selected rows          |
| Edit store    | Editor portal                     | Active cell, draft, and validation error |
| Pending store | Pending overlays                  | Optimistic values and commit failures    |
| Drag store    | Drag overlays                     | Column source and drop indicator         |
| Resize store  | Resize overlays                   | Active resize guide                      |

`DataGrid` mutates these stores but does not subscribe to them. This keeps pointer movement, draft
changes, and overlay updates from re-rendering the windowed cells.

Selection is stored as an anchor and focus coordinate, then drawn as at most one rectangle per
zone. Do not add a `selected` prop to every cell; doing so would put drag selection on the cell
rendering path.

## Gesture ordering

Pointer gestures overlap in the header, so they are composed in this order:

1. Column resize claims the narrow boundary hit area.
2. Column reorder claims the rest of eligible headers.
3. Cell selection handles the body.

Each handler reports whether it consumed the event. Preserve this priority when adding or changing
gestures.

Column reorder stays within the source zone and cannot cross an action column. Only center-zone
drags use horizontal edge auto-scroll. Column resize updates a guide during movement and commits the
width once on release.

## Editing and commits

The active editor renders through a `document.body` portal. This prevents cell virtualization from
unmounting it and avoids clipping by the scroll container. Because the portal does not move with the
grid, `EditorPortal` repositions its host imperatively during scroll and resize.

The commit sequence is:

1. Parse the draft with `parseValue` when provided.
2. Validate changed values synchronously.
3. Keep the editor open after an explicit validation failure, or discard an invalid implicit edit.
4. Close the editor and show the accepted value in the pending overlay.
5. Call the column or grid commit handler.
6. Clear the overlay on success, or revert and flash the cell on failure.

The grid never mutates row data. Consumers persist accepted commits and pass updated rows back to
the component.

Custom editor popups must render inside the editor host. A popup mounted elsewhere is treated as an
outside click and implicitly commits the edit.

Active edit snapshots retain stable row identity. Resolvers use the current row-index map so a fetch
or reorder cannot redirect a draft to a different row. Callbacks exposed to custom editors delegate
through the latest committed editing API, including callbacks retained across a refresh. Loading
hides and disables the portal without clearing its draft or starting a commit; pending commits
continue independently. Missing targets retain the draft with an explicit discard notice. Focus
restoration respects any intervening move to an outside control.

## Performance constraints

- Keep scroll, hover, and pointer-move state off the cell rendering path.
- Subscribe at the smallest overlay or control that needs the state.
- Keep geometry functions pure and DOM-free where possible.
- Pass primitive cell props when possible so memoization remains effective.
- Reset virtualizer measurements when row heights or resolved column widths change.
- Keep frozen column counts small because frozen zones are not horizontally virtualized.

Run `npm test`, `npm run lint`, and `npm run build` after changes. Geometry and store behavior should
remain covered by DOM-free unit tests.

## Styling boundaries

`internal/grid.css` and `internal/loading.css` own static layout and visual defaults on grid-owned
classes. Structural rules use normal class specificity; visual defaults use `:where()` where possible.
Inline styles retain calculated positions, dimensions, shared hit-area widths, generated mask geometry,
and runtime state. The root also keeps position, isolation, and box sizing inline after consumer styles
to preserve its mandatory overrides. Explicit box sizing protects measured cells and headers without
a host reset. Frozen divider shadows cost no layout width. Skeletons repeat three alpha-mask tiles
over a CSS-colored backing, with constant
DOM size regardless of row count; SVG data URLs cannot inherit page CSS variables.

`GridZone` builds one cell context/accessor result for both the class callback and renderer. Only
resolved class strings reach memoized cell leaves. Selection and focus remain overlay subscriptions.

`useEditorTheme` runs only in the editor leaf. It copies the allowlist in `internal/theme.ts`, plus
computed base typography/direction, from a separate outer-frame ref. It observes root/ancestor theme
attributes and listens for resize/system-color-scheme changes, coalescing reads without polling.
Cleanup cancels queued work and releases listeners. Keep the allowlist and public token table in
[docs/STYLING.md](./docs/STYLING.md) aligned. Hidden loading editors pause their subscription;
resumed/remounted editors read a fresh snapshot and remeasure without discarding drafts.

## Public customization and commands

`DataGrid` uses a generic-preserving `forwardRef` boundary. Its `useImperativeHandle` exposes only
`focusCell`: resolve stable row ID, resolve column, validate selectability, then check loading,
edit state and each gesture's `isActive` query before changing anything. Reorder's query includes
its pre-threshold source. Success uses the same store and scrolling helper as keyboard navigation.
Reconcile selection in a layout effect before exposing the current handle so a parent's layout-effect
command cannot be remapped later against old row indices. No cell subscribes to the handle.

`RowGutter` owns checkbox replacement rendering and native defaults. Retained control callbacks
resolve through a layout-effect-updated dispatcher and the latest store snapshot. The dispatcher
checks loading/read-only and current IDs; the gutter contains keyboard and pointer-down events so
checkbox activation does not start cell navigation or editing. Selection semantics remain grid-owned.
Public consumer responsibilities are in [docs/INTEGRATION.md](./docs/INTEGRATION.md).

## Accessibility and input ownership

`GridAccessibility` supplies logical ARIA row owners referencing the real mounted cells across
zones. It updates active-descendant/selection attributes directly from the store, writing changed
cell selection attributes without rerendering cells. IDs are instance-scoped and retain stable row
identity. Controls retain native tabindex; there is no control-mode observer, tab-stop cache or F6
handler. The semantic nodes have no layout dimensions and never duplicate content. Actual AT
ownership support remains a release gate.

Async save-error feedback belongs to the application through `onCellCommitError`; the grid has no
commit-announcement subscription or live region. Default editor validation still exposes its own
associated error. Pending visual content is aria-hidden so it cannot duplicate semantic cells.

The outer frame contains the scroller and its sibling status layer; no toolbar layout wrapper is needed.
Pointer movement, selection and resize/reorder guides stay in stores. Normal touch only records a
tap candidate and preserves native scrolling. The shell owns the pointer ID, cancels on additional
contacts and invalidates gestures when source identity/geometry changes. No built-in actions panel
is rendered. Deliberate touch ranges, touch edit entry and keyboard/touch column actions require
replacement interactions; touch header dragging is currently absent.
