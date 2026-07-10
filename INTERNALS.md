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
scroll container
└── flex body
    ├── row gutter       sticky left
    ├── left zone        sticky left
    ├── center zone      horizontally virtualized
    └── right zone       sticky right
```

Each zone owns a sticky header. Frozen zones remain opaque and render above the center zone so
scrolling cells cannot show through them.

Rows have a uniform height and are vertically virtualized. Only center columns are horizontally
virtualized; frozen columns are expected to remain a small set and are always rendered for each
visible row. Cells are absolutely positioned with transforms inside their zone.

## Coordinate spaces

Interactions convert between four coordinate spaces:

| Space | Origin | Used by |
| --- | --- | --- |
| Viewport | Visible scroll box | Pointer events and sticky regions |
| Scroll content | Full scrollable body | Conceptual grid layout |
| Zone local | Start of one column zone | Cell and overlay transforms |
| Cell address | `{ rowIndex, columnId }` | Selection, editing, and keyboard state |

The center zone includes `scrollLeft` when converting a viewport point to zone-local x. Frozen
zones do not because they remain pinned. Vertical hit testing subtracts the sticky header before
applying `scrollTop`.

Keep conversions in `useGridGeometryHelpers.ts` or the pure geometry module. Duplicating this math
inside gestures makes frozen-zone boundary bugs likely.

## State and overlays

Interaction state lives in small observable stores:

| Store | Subscriber | Purpose |
| --- | --- | --- |
| Grid store | Selection overlays and row gutter | Focus, range, and selected rows |
| Edit store | Editor portal | Active cell, draft, and validation error |
| Pending store | Pending overlays | Optimistic values and commit failures |
| Drag store | Drag overlays | Column source and drop indicator |
| Resize store | Resize overlays | Active resize guide |

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

## Performance constraints

- Keep scroll, hover, and pointer-move state off the cell rendering path.
- Subscribe at the smallest overlay or control that needs the state.
- Keep geometry functions pure and DOM-free where possible.
- Pass primitive cell props when possible so memoization remains effective.
- Reset virtualizer measurements when row heights or resolved column widths change.
- Keep frozen column counts small because frozen zones are not horizontally virtualized.

Run `npm test`, `npm run lint`, and `npm run build` after changes. Geometry and store behavior should
remain covered by DOM-free unit tests.
