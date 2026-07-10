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
left/right walk the **visual column order** (`[...left, ...center, ...right]`), **skipping
non-selectable columns** (`placement.selectable === false`, i.e. `type: 'action'`) so focus never
lands on an action cell. `toEdge` (Cmd / Ctrl + arrow, R6) jumps to the edge-most *selectable*
row/column.
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
selection. `hitTest` also returns `null` for an **`type: 'action'`** column, so a click on a
row-action cell never focuses/drags it (and never starts auto-scroll) — the button inside owns the
click.

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

Three subtleties:

- The horizontal edges are **inset by the pinned bands** (`leftLimit = rect.left + leftBand`,
`rightLimit = rect.left + clientWidth − right.total`), so auto-scroll triggers at the *scrolling*
region's edge, not under the frozen columns.
- **It only scrolls once a drag has actually crossed a cell** (`movedRef`). The pinned frozen zones
*sit inside* the edge bands, so without this gate a plain **click** on a frozen cell counts as "past
the edge" and would scroll the table every frame until pointer-up. Auto-scroll is a drag feature; a
stationary click must not trigger it. (A real drag has already crossed cells by the time it reaches
an edge, so the gate never blocks legitimate auto-scroll.)
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
| **Edit: open / keystroke** | only the `EditorPortal` leaf               | Draft lives in the edit store; `DataGrid` never subscribes. The portal repositions on scroll *imperatively* (ref transform), so even scrolling-while-editing doesn't re-render the body (§11). |
| **Commit: saving / success / error** | only the `PendingOverlay` leaves   | The editor closes on commit; the optimistic value + spinner / red-flash live in the pending store, drawn by the per-zone overlay. Body untouched (§11). |
| **Resize: dragging** | only the `ResizeOverlay` leaf | The guide line lives in the resize store; `DataGrid` never subscribes, so each pointermove redraws one line — the body is untouched (§12). |
| **Resize: commit (release)** | `DataGrid` body, once | One relayout on pointerup (re-derive + `colVirtualizer.measure()`); only cells **at/right** of the resized column repaint, the rest skip the `Cell` memo. Off the per-move path (§12). |


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
src/data-grid/                          ← the shippable grid (one self-contained folder, AntD-free)
  index.ts                              public barrel: `import { DataGrid, type Column } from ".../data-grid"`
  data-grid.tsx                         shell, layout, virtualization, interaction, edit orchestration
  core/store/grid-store.ts              selection store (+ grid-store.test.ts)
  core/store/edit-store.ts              edit state machine store — the open editor (+ edit-store.test.ts)
  core/store/pending-store.ts           optimistic async-commit store (+ pending-store.test.ts)
  core/selection/geometry.ts            stepCoord / rangeToZoneRects / cellToZoneRect / cellViewportRect (+ geometry.test.ts)
  core/types/                           Column, CellCoord, GridSelection, EditState, CellCommit, ids
  editors/EditorPortal.tsx              the edit overlay: a body portal that mounts the active editor (§11)
  editors/FloatingTextEditor.tsx        zero-dep default editors (floating textarea + native select)
  editors/PendingOverlay.tsx            per-zone saving/error overlay: optimistic value + spinner / red flash
src/playground/                         demo harness: the 100k×1k fixture, FPS overlay, AntD edit demo (not shipped)
src/app/                                demo harness: router (not shipped)
DECISIONS.md                            what was decided and why (D0–D10, R1–R7, the roadmap)
```

Run the tests with `npm test`; the prod build (the only valid perf target) with
`npm run build && npm run preview`.

---

## 11. The edit engine (P6, D10)

Editing is **the same trick as selection, applied again**: plain-TS stores + memo'd overlay leaves,
so the windowed body is never on the edit render path. The async lifecycle is deliberately split
from the editor — committing closes the editor *immediately* and the saving/error state is handed
to a separate store + overlay (the **optimistic** model, D10). Four pieces:

**The edit store** (`core/store/edit-store.ts`) — a sibling of the selection store, holding the
single open editor as an `EditState`. In the default (optimistic) flow it only ever cycles
`idle ⇄ editing` (`begin / setDraft / succeed=close / cancel`); the `submitting / error` variants
remain in the type for a custom editor that wants the alternative "stay open until resolve" model.
Zero-React, immutable-snapshot. **`DataGrid` never subscribes to it** — only `EditorPortal` does —
so opening an editor and every keystroke into the draft re-render **only that one leaf**, never the
~500 windowed cells.

**`EditorPortal`** (`editors/EditorPortal.tsx`) — the editing counterpart of `SelectionOverlay`,
with one crucial difference: it renders through `createPortal` to `document.body`, not inside a zone
container. That decision buys two of the deferred risks outright:

- **R5 (survives unmount).** Because the editor is a body portal and *not* a body cell, column/row
  virtualization can never unmount it mid-edit. Scroll the edited row far away and back — the draft
  and the caret are still there.
- **R7 (escape the clip).** A body portal isn't clipped by the grid's `overflow`/`transform`, so the
  floating editor can grow past the cell and past the grid edges. This is the first real R7 solve;
  the demo's AntD `Select` dropdown (its own portal, opened inside the floating editor) is the canary.

The price of a body portal is that it does **not** ride the grid's compositor scroll (the whole
point of §2's sticky zones). So the portal **repositions itself imperatively**: a layout effect
computes the cell's *viewport* rect via the new pure `cellViewportRect` (§4's formulas run forwards:
`y = rowHeight + row*rowHeight − scrollTop`; `x` adds `scrollLeft` only in the center) and writes
`host.style.transform` directly. A `scroll`+`resize` listener (rAF-throttled) rewrites that transform
on every scroll — **never setState**, so scrolling-while-editing still doesn't touch the body. The
editor stays **"frozen" and visible**: as the edited cell scrolls toward an edge, the host position
is **clamped to the usable (un-pinned) viewport** so it sticks at that edge rather than tucking under
the header/frozen bands or scrolling away. (It never unmounts — R5 — and now never even hides.)

**The editor panel is the host, not the editor.** The `EditorPortal` host carries the visual frame
(border / shadow / background / radius) and is the single styling surface (D7): `editorClassName` /
`editorStyle` on `GridProps` are applied to it, over a sensible default frame, and it always emits
`data-editing=""` for plain CSS. **Every** editor — the built-ins *and* a custom `renderEdit` —
renders **transparently to fill that one frame** (the default editors are borderless/transparent; a
custom AntD `Select` uses `variant="borderless"`). This is the fix for "every third-party component
clashes": the grid owns the cell-matching chrome; the component supplies only the input.

**The editors** (`editors/FloatingTextEditor.tsx`) — the only built-ins, both **zero-dependency**,
both bare/transparent (the host frames them):
- the **floating text editor**, a `<textarea>` that auto-grows to fit its content (the Glide-style
  "expandable" overlay) — min size = the cell, grows downward, capped width;
- a bare native **`<select>`** for `type: 'select'` columns.

Any column can replace them: if `column.renderEdit(ctx)` is defined, `EditorPortal` mounts that
instead, inside the same floating host. `ctx` is the `CellEditContext` — `draft / setDraft / commit
/ cancel / status / error` plus the cell's `width / height` (so a custom editor can fill the cell,
e.g. `style={{ width: ctx.width }}`) — which is all an editor needs; the integrator brings the
component (AntD, etc.). **The grid imports no UI library.**

**Outside-click-to-close is the grid's job, not each editor's.** `EditorPortal` registers a
capture-phase `pointerdown` listener on `document` while editing: a press anywhere outside the host
commits the active edit, so *every* editor (default or custom) dismisses without wiring its own
blur. The capture phase means it runs before the grid's own pointer handlers, which then re-select
the clicked cell. **Integrator contract for popup editors:** a custom editor whose popup renders
elsewhere (e.g. an AntD `Select` dropdown, which portals to `document.body` by default) must render
that popup *inside the host* — `getPopupContainer={(node) => node.parentElement}` — so (a) a click
on the popup counts as "inside" and doesn't dismiss the editor, and (b) the popup rides the host's
scroll-reposition instead of floating free. The grid can't do this for them: it has no knowledge of
a third-party library's portal.

**The pending store + `PendingOverlay`** (`core/store/pending-store.ts`, `editors/PendingOverlay.tsx`)
— the optimistic async layer, a third store drawn by a fourth per-zone overlay (sibling of
`SelectionOverlay`, same zone-local positioning so it scrolls/pins with the cells). The store is a
`Map<coordKey, {cell, value, status}>`; the overlay draws, per entry in its zone: **pending** → an
opaque box over the cell showing the optimistic value + a right-edge SVG spinner (and the cell is
non-editable — `beginEdit` refuses a pending cell); **error** → a transparent red-bordered box that
fades over ~2s (Web Animations), letting the reverted old value show through from the body cell.
Only this leaf subscribes to the pending store; commits are rare discrete events, so this is off the
scroll/drag/keystroke hot path.

**The commit lifecycle** lives in `DataGrid` (it owns the prop handlers). The key move (D10): commit
**closes the editor and immediately hands off to the pending overlay** — it never `await`s in the
editor, so nothing lingers:

```
begin (click focused cell / Enter / F2 / printable) → editStore.begin(cell, value | typedChar)
type                                        → editStore.setDraft   (only EditorPortal re-renders)
commit (Enter↓ / Tab→ / blur / select-pick) → editStore.succeed()  // editor closes NOW
   parseValue; skip if unchanged; then →      pendingStore.setPending(cell, nextValue)  // optimistic
   handler = column.onCommit ?? props.onCellCommit  (fire-and-forget):
        resolve → pendingStore.clear(cell)            // persisted value flows back via accessor
        reject  → pendingStore.setError(cell); onCellCommitError?.({ update, error });
                  setTimeout(clear, ERROR_FLASH_MS)                       // revert + red flash
cancel (Esc)                                → editStore.cancel()   // abandon, no commit
```

Parent stays authoritative (R4): the grid **never mutates `rows`**. The consumer persists
`nextValue` and feeds it back in — the playground demo keeps a sparse `Map<CellKey, value>` override
that the editable columns' `accessor` reads, so a commit is O(1), not a 100k-row copy. `commitAndMove`
advances the focused cell (Enter→down, Tab→right) *without waiting* for the async and returns DOM
focus to the scroll container so keyboard nav resumes; a later failure reverts + flashes that cell.

> On failure the cell reverts and the typed draft is **discarded** (preserving it and silently
> repopulating the cell on next open read as a bug — not worth it without a dedicated affordance).
> The red-flash animation and the store-clear delay share one constant (`ERROR_FLASH_MS`) so they
> can't drift — a mismatch makes the flash snap back and "flash twice".
>
> `renderRead` (D4) IS wired into the body cell (`readContent`): a column with `renderRead` renders
> custom read-mode UI (e.g. a frozen actions-button column); such cells re-render with the body on
> scroll (only string-valued cells keep the D9 memo — fine, custom columns are few). An interactive
> control inside a cell should `stopPropagation` on pointerdown (so the click doesn't trip cell
> focus/edit) and `preventDefault` on mousedown (so it doesn't steal keyboard focus from the grid).
> Still deferred: the full D7 `data-*` styling surface (P9).

---

## 12. Column resize (D12)

Resize is **§7's reorder gesture rotated 90°** — the same plain-TS store + memo'd overlay leaf, so
the windowed body is never on the per-move path. Four pieces, all mirroring the drag-reorder ones:

**The resize store** (`core/store/resize-store.ts`) — the fifth D1 store, a sibling of the drag
store. It holds only the in-flight guide-line position (`{ status: 'resizing', columnId, zone,
indicatorX }`), with the same same-value dedup on `setIndicator` so an unchanged move doesn't
re-render the overlay. **`DataGrid` never subscribes** — only `ResizeOverlay` does.

**`ResizeOverlay`** (`components/ResizeOverlay.tsx`) — the resize counterpart of `DragOverlay`, one
leaf per zone. Unlike the reorder indicator (header-only), it draws a **full-height** vertical guide
line (header + body) so you see where the new right edge lands across every row. It's mounted **inside
the zone container** (a sibling of the header strip + body), positioned at **zone-local x** — the same
coordinate space as the cells (§4) — so it pins/scrolls with its zone for free, and a zone only paints
while *its* column is the one resizing.

**`headerResizeHitTest`** (`hooks/useGridGeometryHelpers.ts`) — the inverse-layout reader, mirroring
`headerHitTest`'s zone banding (only the center adds `scrollLeft`). It matches a pointer within
`RESIZE_HANDLE_WIDTH` of a column **right boundary**; a boundary belongs to the column on its **left**
(the one a drag resizes). `type: 'action'` / `resizable: false` columns return `null` (inert, like
reorder).

**`useColumnResize`** (`hooks/useColumnResize.ts`) — the gesture. **Commit-on-release:** pointerdown
on a handle starts the store + captures the pointer (forcing `cursor: col-resize` on the capture
target); each move computes `width = clamp(startWidth + dx, min, max)` and updates *only* the guide
line; pointerup **commits once** via `onCommit(id, width)` (skipped if the width didn't change — a bare
click is a no-op). The column's left edge is fixed for the whole gesture, so the guide sits at
`colOffset + width`. Like the other gestures it returns a **"consumed" flag** so the shell composes it
**first** in the pointer chain (`colResize → colDrag → dragSelect`): the handle strip is a subset of
the header, so resize must claim the edge before reorder claims the rest.

**Width is uncontrolled (D12), and it flows through `widthOf`.** `DataGrid` owns an `internalWidths`
map; `commitResize` writes it (and fires the optional `onColumnResize`). That map is handed to
`useGridLayout` as `widthOverrides`, where the `widthOf` resolver computes each column's effective
width — `clamp(widthOverrides[id] ?? column.width ?? DEFAULT, minWidth, maxWidth)` — and feeds it to
`zoneLayout`. Because **everything downstream derives from the zone layouts** — `offsets`,
`placementMap`, `geom`, the column virtualizer's `estimateSize`, the selection/pending overlay rects,
and the editor's `cellViewportRect` — a committed width re-flows the entire grid correctly from one
place. The commit is **one relayout** (the `colVirtualizer.measure()` effect re-fires on the changed
`center.widths`); the body repaints, but only cells **at/right** of the resized column actually
re-render — those to the left keep the same `content`/`x`/`width`, so the `Cell` memo skips them (§9).

> `enableColumnResize` (default **on**) is the global gate; per-column `resizable: false` and
> `type: 'action'` opt out. `column.width` is the **base/initial** width — the grid layers in-session
> resizes over it, so resize works with zero wiring; `onColumnResize` is there purely to persist.
> **Controlled widths + reset** (a `columnWidths` prop where reset = `setColumnWidths({})`) are
> deferred (see D12): reset needs an override layer distinct from the defaults, which the uncontrolled
> single-`column.width` model can't express — revisit with controlled row selection. A **`:hover`**
> affordance on the handle also waits on the D7 stylesheet (inline styles can't do pseudo-states).
