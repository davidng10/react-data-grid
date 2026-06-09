# How the data grid works

This is the **mechanism** guide — how the pieces fit.

The entire shippable grid is the self-contained `**src/data-grid/`** folder (organized shadcn-
registry style — consumers copy the folder and own the code; see the file map in §10). `src/playground/` and
`src/app/` are the demo harness and are **not** part of the distributable.

```
src/data-grid/data-grid.tsx              the React shell: layout, virtualization, interaction plumbing
src/data-grid/core/store/grid-store.ts   plain-TS observable store: the selection state (D1)
src/data-grid/core/selection/geometry.ts pure functions: keyboard stepping + overlay rectangle math (D6)
src/data-grid/core/types/*               the schema (Column, CellCoord, GridSelection, …)
```

---

## 1. Overview

- It's a **DOM grid** (not canvas), because cells will eventually host real components.
- We never fully render 100k×1k cells. **Virtualization** keeps only ~500 cells mounted; everything is  
absolutely positioned with `transform: translate.`
- There is **one native scroll container**. The header, the frozen columns, and the checkbox
gutter are all `position: sticky` *inside* it, so they ride the browser's own compositor scroll  
— **zero JavaScript scroll-syncing.**
- Columns are split into **three zones** — left / center / right — laid out as a flex row. Only
the **center** zone scrolls horizontally and only it is column-virtualized.
- **Selection is drawn as overlay rectangles**, fed by a tiny store. Cells never carry a
`selected` flag, so a drag-select never re-renders the body. This is the single most  
important performance idea in the grid.

Please  understand **coordinate systems** (§4) first to understand `hitTest`, `scrollCellIntoView`, and
`autoScrollTick`. They are all just conversions between those systems.

---

## 2. The DOM skeleton

```
<div scrollRef>                         ← THE scroll container (overflow:auto). tabIndex=0 for keys.
  <div bodyFlex>                        ← display:flex, width = totalWidth, height = rowHeight+totalHeight
    │
    ├─ RowGutter        sticky; left:0            (optional checkbox column)
    │    ├─ header   sticky; top:0                ← select-all checkbox (a corner: pinned both axes)
    │    └─ body     (checkboxes per visible row)
    │
    ├─ left zone        sticky; left:gutterW      (frozen-left columns; always rendered)
    │    ├─ header   sticky; top:0                ← frozen corner
    │    ├─ body     (cells)
    │    └─ SelectionOverlay zone="left"
    │
    ├─ center zone      (relative; the ONLY horizontally-windowed zone)
    │    ├─ header   sticky; top:0
    │    ├─ body     (windowed cells)
    │    └─ SelectionOverlay zone="center"
    │
    └─ right zone       sticky; right:0           (frozen-right columns; always rendered)
         ├─ header   sticky; top:0                ← frozen corner
         ├─ body     (cells)
         └─ SelectionOverlay zone="right"
```

Two independent sticky axes do all the freezing:

- **Vertical freeze (the header):** each zone's header row is `sticky; top:0`. As you scroll down,
it pins to the top of the scroll container. The body slides under it.
- **Horizontal freeze (frozen columns + gutter):** the gutter and the left/right zones are
`sticky; left:0 / left:gutterW / right:0`. As you scroll right, they pin to the viewport edges.

A frozen **corner** (e.g. the gutter's select-all box, or a frozen column's header) is sticky on
*both* axes simply because it's a `sticky-top` header inside a `sticky-left` zone. No special code.

**Why flex?** `position: sticky; right:0` only pins correctly if the element's *natural* position
is already at the content's right edge. Flexbox lays the right zone there for free. (A block layout
would stack the zones or misplace the right one.)

**Why opaque frozen bodies?** Frozen zones paint *above* the scrolling center (z-index below). If a
frozen cell were transparent, the center cells sliding underneath would bleed through. So frozen
bodies get a solid background. (This is read-mode only; AntD edit cells needing transparency is a
P6/P9 concern.)

**z-index ladder** (so the right things cover the right things):

```
center body cells        0   (auto)
center header            1   ← covers center body on vertical scroll
left / right zones       2   ← cover center on horizontal scroll (whole zone is atomic)
checkbox gutter          3   ← leftmost, always on top
```

Within a frozen zone the header is `z:1` *locally*, so the frozen corner sits above its own body.

---

## 3. Virtualization (TanStack Virtual, D8/D9)

Two virtualizers, both reading the same scroll container:

- `**rowVirtualizer*`* — vertical. Rows are a **uniform height** (D8), so row math is pure
arithmetic: a row's top is just `rowIndex * rowHeight`. No prefix-sum, no measuring.
- `**colVirtualizer`** — horizontal, **center zone only**. Left/right frozen columns are few and
always rendered, so only the center is windowed.

`vRows = rowVirtualizer.getVirtualItems()` and `vCols = colVirtualizer.getVirtualItems()` are the
~30 rows × ~15 columns currently on screen. The body renders `vRows × vCols` cells, each positioned
with `transform: translate(x, y)`.

### Why `scrollMargin` on the column virtualizer

The center content does **not** start at scroll-x 0 — it starts after the gutter + the left frozen
zone, i.e. at `leftBand = gutterW + left.total`. But the column virtualizer measures visibility
against the scroll container's `scrollLeft`, which is 0-based. Without help it would window the
*wrong* columns (off by `leftBand`).

`scrollMargin: leftBand` tells the virtualizer "my content begins `leftBand` into the scroll
element." After that, `vc.start` is in **scroll-content coordinates** (it *includes* the margin), so
to position a center cell inside its zone we subtract it back out: `x = vc.start - leftBand`. This
is the canonical TanStack pattern.

> The row side has a similar 1-row offset (the body sits below the sticky header), which is simply
> absorbed by `overscanRows`. We didn't bother with a vertical `scrollMargin` because the header is
> exactly one row tall and overscan already renders a few extra rows.

---

## 4. Coordinate systems — the key to everything

There are **four** coordinate spaces. Every interaction function is a conversion between them. Get
this table and the rest is mechanical.


| Space              | Origin                                                                           | Used by                         |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------- |
| **Viewport**       | top-left of the visible scroll box (`clientX - rect.left`, `clientY - rect.top`) | mouse events, sticky pins       |
| **Scroll-content** | top-left of the full scrollable `bodyFlex` (`viewport + scrollLeft/Top`)         | the conceptual full grid        |
| **Zone-local**     | top-left of one zone container; x is 0-based within that zone                    | cell `transform`, overlay rects |
| **Cell address**   | `{ rowIndex, columnId }` (D2)                                                    | the store, selection, keyboard  |


Key constants (computed each render in `DataGrid`):

```
gutterW            = enableRowSelection ? 40 : 0
leftBand           = gutterW + left.total          // where the center begins
centerScrollMargin = leftBand                       // fed to the column virtualizer
totalWidth         = leftBand + center.total + right.total
```

### The conversion formulas

Vertical (header occupies the top `rowHeight` of the viewport):

```
cell row r  →  scroll-content y = rowHeight + r*rowHeight   →  viewport y = that − scrollTop
viewport y  →  row r = floor( (viewportY − rowHeight + scrollTop) / rowHeight )
```

Horizontal, **center** zone (it scrolls; offset by leftBand):

```
center col, zone-local offset o  →  scroll-content x = leftBand + o  →  viewport x = leftBand + o − scrollLeft
viewport x  →  zone-local o = viewportX − leftBand + scrollLeft
```

Horizontal, **frozen** zones (pinned — `scrollLeft` does NOT appear):

```
left  zone:  viewport x = gutterW + o           ⇒  o = viewportX − gutterW
right zone:  viewport x = clientWidth − right.total + o
             ⇒  o = viewportX − (clientWidth − right.total)
```

That last point is the crux: **frozen-zone math has no `scrollLeft` term** because the zone is
pinned. Only the center adds `scrollLeft`. Every one of the functions below is just these formulas
run forwards or backwards.

---

## 5. Selection: the store + the overlay (D1, D6)

### Why a store, and why "overlay-only"

The naive way to show selection is to give each cell a `selected` prop. During a drag across 1,000
columns, that re-renders the whole visible body on **every mousemove** — janky and unusable (D6).

Instead:

- Selection lives in a **plain-TS observable store** (`grid-store.ts`): `{ focusedCell, range, selectedRows }`. No React inside it. Mutators (`focusCell`, `extendTo`, `clearRange`,
`toggleRow`, …) replace the snapshot immutably so `useSyncExternalStore` detects the change.
- The selection is **drawn as rectangles** by `SelectionOverlay`, one instance per zone. Each
overlay `useSyncExternalStore`-subscribes to the store and draws only the slice of the range +
focus that falls in its zone.
- `**DataGrid` itself never subscribes to the store.** Only the (cheap) overlay leaves do. So a
drag updates ~3 rectangles and the windowed body is never touched. This is the whole game.

### Why per-zone overlays

A selection can span all three zones (e.g. from the frozen `#` column across the center to a
frozen-right column). Those zones scroll differently (two are pinned), so the selection is drawn as
**up to 3 rectangles**, one inside each zone container — reusing the same sticky structure as the
cells. Each rectangle is in **zone-local** coordinates, exactly like the cells, so it lines up
without knowing anything about scroll. See `rangeToZoneRects` (§6).

`SelectionOverlay` is wrapped in `memo` so it does **not** re-render when `DataGrid` re-renders on
scroll (its props are stable); it re-renders only when the store changes. The checkbox `RowGutter`
also subscribes to the store (for `selectedRows`) and re-renders on a click — but the body still
doesn't.

---

## 6. The geometry module (pure, unit-tested)

`src/data-grid/core/selection/geometry.ts` is DOM-free and covered by `geometry.test.ts`. Three functions:

- `**stepCoord(focus, dir, geom, toEdge)`** — keyboard navigation. Up/down clamp the row index;
left/right walk the **visual column order** (`[...left, ...center, ...right]`). `toEdge` (Cmd /
Ctrl + arrow, R6) jumps straight to row 0 / last row / first / last column.
- `**rangeToZoneRects(range, geom)`** — turns a `{anchor, focus}` range into the overlay rectangles.
Vertical extent is pure arithmetic (uniform height, D8): `y = minRow*rowHeight`,
`height = (maxRow−minRow+1)*rowHeight`. For x, it walks the selected columns and, **per zone**,
takes `min(offset) … max(offset+width)` — because each zone is a contiguous block of the visual
order, a zone's selected columns are themselves contiguous, so one rectangle each.
- `**cellToZoneRect(cell, geom)`** — the single-cell version, used for the focus outline.

`geom` (`GridGeometry`) is the bridge between the DOM shell and the pure math. `DataGrid` builds it
each render: `rowCount`, `rowHeight`, the `columnOrder`, and a `placement(columnId)` lookup. The
**placement** of a column is `{ zone, offset, width, visualIndex, localIndex }`:

- `offset` — zone-local x (matches the cell's `translateX`)
- `visualIndex` — position in the visual order (for range spanning + stepping)
- `localIndex` — index within its zone (the center virtualizer's index; used by scroll-into-view)

---

## 7. The interaction plumbing (the parts that looked mysterious)

All of these live in `DataGrid` and are just the §4 formulas applied. None of them touch React
state directly — they read events / the DOM and call **store mutators**, which feed the overlay.

### `hitTest(clientX, clientY) → CellCoord | null`  — "what cell is under this pixel?"

The inverse of layout. We have a mouse pixel; we need a cell address. A naive `floor(x / colWidth)`
is wrong here, because pinned regions (gutter, frozen columns, sticky header) are layered over the
scrolling content, so the *same* viewport pixel maps to different content depending on which band
it's over and the current scroll. `hitTest`:

1. `vpY = clientY − rect.top`. If `vpY < rowHeight` → over the sticky header → `null`.
2. `rowIndex = clamp(floor((vpY − rowHeight + scrollTop) / rowHeight), 0, rowCount−1)`. (Clamp, so a
  drag *past* the bottom still resolves to the last row.)
3. `localX = clientX − rect.left`. If `localX < gutterW` → over the checkbox gutter → `null` (the
  gutter isn't a selectable cell; its checkboxes handle their own clicks).
4. **Pick the zone by viewport band**, then convert to that zone's local x using the §4 formulas
  (only the center adds `scrollLeft`). Binary-search the zone's `offsets` for the column.

Returning `null` for the header/gutter is what makes clicking a checkbox *not* start a cell
selection.

### The drag lifecycle — `onPointerDown / Move / Up` + `extendDrag`

- `**onPointerDown`**: `hitTest` the point. If it's a cell, `focusCell` it (or `extendTo` if Shift is
held), set `draggingRef = true`, remember it in `lastHitRef`, `setPointerCapture` (so we keep
getting moves even if the pointer leaves), and start the auto-scroll loop.
- `**onPointerMove**`: while dragging, update `pointerRef` and `extendDrag(hitTest(...))`.
- `**extendDrag(cell)**`: calls `store.extendTo(cell)` — but **only if the cell changed** since
`lastHitRef`. Without this dedup the store would fire on every sub-pixel mousemove and re-render
the overlay needlessly.
- `**onPointerUp`**: stop dragging, cancel the auto-scroll loop, release capture.

### `autoScrollTick()` — "drag past the edge"

A drag-select that stops at the viewport edge can't reach rows/columns beyond what's visible. So
while dragging, a `**requestAnimationFrame` loop** runs: if the pointer is within `EDGE_ZONE` (48px)
of an edge, it nudges `scrollTop` / `scrollLeft` by `EDGE_SPEED` (22px) and re-runs
`extendDrag(hitTest(pointer))` to keep growing the selection.

Two subtleties:

- The horizontal edges are **inset by the pinned bands** (`leftLimit = rect.left + leftBand`,
`rightLimit = rect.left + clientWidth − right.total`), so auto-scroll triggers at the *scrolling*
region's edge, not under the frozen columns.
- It uses rAF (not `setInterval`) so it's frame-synced and stops cleanly on pointer-up; a cleanup
effect cancels it on unmount.

> Note: `requestAnimationFrame` is **paused in background tabs**. This is why automated FPS / auto-
> scroll measurements are unreliable and the FPS gate is a manual check (see `DECISIONS.md`).

### `scrollCellIntoView(cell)` — keyboard nav's "bring it on screen"

When an arrow key moves focus off-screen, we must scroll it back into view. We deliberately do **not**
use the virtualizer's `scrollToIndex`, because the virtualizer doesn't know about the **pinned
chrome**: it would happily park the focused cell *under* the sticky header or *under* a frozen
column. Instead we compute scroll positions against the **usable (un-pinned) viewport**:

```
vertical:   usable viewport = [scrollTop + rowHeight, scrollTop + clientHeight]   (header steals the top row)
horizontal: usable viewport = [scrollLeft + leftBand,  scrollLeft + clientWidth − right.total]
```

If the cell is left of / above the usable region we scroll so it lands exactly at that edge; if it's
right of / below, we scroll so it lands at the far edge. The payoff you can see: arrow to a low-index
center column while scrolled right, and it stops **flush against the frozen band** (`viewportLeft == leftBand`) instead of disappearing under it. Setting `scrollTop/scrollLeft` directly drives the
virtualizer, which re-renders the body — and the overlay follows for free.

### `onKeyDown`

Maps arrow keys to a `Direction`, computes the next cell with `stepCoord` (passing `metaKey||ctrlKey`
as `toEdge`), then `extendTo` (Shift held) or `focusCell`, then `scrollCellIntoView`. `Escape` clears
the range but keeps the focused cell. The first arrow press with no focus lands on the origin cell.

---

## 8. The checkbox gutter (`RowGutter`)

A shell-owned, frozen-left column of checkboxes (enabled by `enableRowSelection`). It:

- subscribes to the store for `selectedRows` (a click re-renders only the gutter, never the body);
- renders a checkbox per **windowed** row (so it re-renders on scroll too — ~30 inputs, negligible);
- has a header **select-all** checkbox showing checked / indeterminate / unchecked, with Gmail-style
semantics (any selection → clicking clears; none → selects all).

Adding the gutter shifts the left base by `gutterW`, which is exactly why `leftBand` (not
`left.total`) appears throughout `hitTest`, `scrollCellIntoView`, and `autoScrollTick`. The left
frozen zone then sticks at `left: gutterW` so it sits just right of the gutter; the gutter sticks at
`left: 0`.

---

## 9. What re-renders when (the performance contract)


| Action                          | What re-renders                          | Why it's cheap                                                                                            |
| ------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Scroll**                      | `DataGrid` body (windowed cells), gutter | Cells are memoized on primitive values (D9); only ~500 mount. `SelectionOverlay` is `memo`'d so it skips. |
| **Drag-select / focus move**    | only the 3 `SelectionOverlay` leaves     | They draw ~3 rectangles. The body is never touched (D6).                                                  |
| **Row checkbox toggle**         | only `RowGutter`                         | Click-driven, ~30 checkboxes.                                                                             |
| **Selection change → consumer** | nothing in `DataGrid`                    | `onSelectionChange` fires from a plain store subscription (an effect), not React state.                   |


The golden rule (D1): **scroll, drag, and hover never set React state on the per-cell render path.**
They update the store (→ overlay) or are absorbed by the virtualizer.

---

## 10. Quick reference

**Key variables in `DataGrid`:**


| Name                                                          | Meaning                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `zones`                                                       | columns partitioned into `{ left, center, right }` by `frozen` (D5)    |
| `left` / `center` / `right`                                   | `zoneLayout` per zone: `{ widths, offsets, total }`                    |
| `gutterW`                                                     | checkbox gutter width (0 if disabled)                                  |
| `leftBand`                                                    | `gutterW + left.total` — where the center begins; the recurring offset |
| `centerScrollMargin`                                          | `= leftBand`; fed to the column virtualizer's `scrollMargin`           |
| `totalWidth`                                                  | full scroll-content width                                              |
| `placementMap` / `columnOrder`                                | column → placement; visual order of column ids                         |
| `geom`                                                        | `GridGeometry` handed to the pure geometry + overlays                  |
| `store`                                                       | the selection store (created once via `useState`)                      |
| `vRows` / `vCols`                                             | the currently windowed rows / center columns                           |
| `draggingRef` / `lastHitRef` / `pointerRef` / `autoScrollRef` | drag/auto-scroll bookkeeping (refs, never state)                       |


**File map:**

```
src/data-grid/                          ← the shippable grid (one self-contained folder)
  index.ts                              public barrel: `import { DataGrid, type Column } from ".../data-grid"`
  data-grid.tsx                         shell, layout, virtualization, interaction
  core/store/grid-store.ts              selection store (+ grid-store.test.ts)
  core/selection/geometry.ts            stepCoord / rangeToZoneRects / cellToZoneRect (+ geometry.test.ts)
  core/types/                           Column, CellCoord, GridSelection, CellRange, ids
src/playground/                         demo harness: the 100k×1k stress fixture + FPS overlay (not shipped)
src/app/                                demo harness: router (not shipped)
DECISIONS.md                            what was decided and why (D0–D9, R1–R7, the roadmap)
```

Run the tests with `npm test`; the prod build (the only valid perf target) with
`npm run build && npm run preview`.