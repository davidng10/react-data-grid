# Architecture Decisions

> **Status: Phase 6 (editing engine) implemented — code complete; interactive + FPS verification
> pending.** The headless **edit engine** is built and is **AntD-free** (the grid ships no UI-lib
> dependency — `grep antd src/data-grid` is empty; AntD lives only in the playground as a
> `devDependency`). It mirrors the selection layer: a plain-TS **edit store**
> (`core/store/edit-store.ts`, 12 unit tests) holds the `EditState` machine, and a single
> **`EditorPortal`** leaf subscribes to it — `DataGrid`/the windowed body **never** subscribe, so
> opening an editor, typing a draft, and submit/error transitions never re-render the body. The
> default editor is a **zero-dep floating, auto-expanding portal** `<textarea>` (Glide-style); a
> column's `renderEdit(ctx)` overrides it with anything (the demo uses an AntD `Select`). Because
> the editor is a `createPortal`-to-`body` overlay it **escapes the grid's clip (R7 pulled forward)**
> and **survives the underlying cell virtualizing out (R5) for free**; it repositions on
> scroll/resize **imperatively** (a ref transform, never setState). Async model: **optimistic** —
> committing **closes the editor immediately** and the saving lifecycle moves to a third store +
> overlay (`core/store/pending-store.ts`, 8 tests, + per-zone `PendingOverlay`): the cell shows the
> new value with a right-edge spinner; on success the persisted value flows back via the consumer
> (R4 — the grid never mutates row data) and the spinner clears; on failure the cell **reverts to
> the old value and flashes red** (the draft is discarded). The body never re-renders on the edit
> path (only the
> overlay leaf does). Triggers: double-click / Enter / F2 / type-to-replace; Enter
> commits + moves down, Tab commits + moves right, Esc cancels. Positioning math is a new pure,
> unit-tested `cellViewportRect` (`core/selection/geometry.ts`, 6 tests). **Verified:** `npm test`
> (41 tests), `tsc -b`, and the prod build all pass; the grid is AntD-free by `grep`. **Pending
> (manual):** the interactive UX walkthrough + the P6 FPS gate (≥60 FPS with an editor mounted) in
> `vite preview`, per the harness. **Earlier (P5, complete & verified in the prod build):**
> cell focus + range selection drawn as per-zone **overlay rectangles** (D6 — never per-cell
> flags); click/drag select including cross-zone splits (left↔center↔right, both directions,
> confirmed by DOM measurement); keyboard arrows, Shift+arrow extend (anchor held), Cmd/Ctrl+arrow
> jump-to-edge (R6) with scroll-into-view (verified to row 99,999), Esc clears range/keeps focus.
> Selection state lives in a plain-TS store (`src/data-grid/core/store/grid-store.ts` — first use
> of the D1 store); pure geometry in `src/data-grid/core/selection/geometry.ts` (**23 unit tests,
> `npm test`** via a
> dedicated `vitest.config.ts`). **Overlay-only by construction:** `DataGrid` never subscribes to
> the store — only the `SelectionOverlay` leaves do (`useSyncExternalStore`) — so a 1,000-column
> drag never re-renders the windowed body. Also done & verified: a shell-owned row-checkbox
> **frozen-left gutter** with select-all (Gmail-style partial→clear; covers all 100k rows, isolated
> from cell focus, pinned left, tracks scroll); **drag auto-scroll** at the viewport edges (extends
> the range while scrolling); **frozen-aware scroll-into-view** (a focused center column lands at
> the frozen-band edge, never tucked under the gutter/frozen columns). **The P5 FPS-under-drag gate
> was confirmed manually** (overlay-only selection holds frame rate during a viewport-spanning
> drag — the body never re-renders). The
> P3/P4 4× CPU-throttle confirmation remains a separate pending manual check. See `**INTERNALS.md`**
> for a mechanism-by-mechanism walkthrough of how the grid works (coordinate systems,
> virtualization, sticky zones, the selection store + overlay, and the interaction plumbing —
> `hitTest` / `scrollCellIntoView` / `autoScrollTick`). **Earlier phases:** P4 frozen zones
> (flex row; left/right `position: sticky`; center windowed with `scrollMargin: leftWidth`; zero JS
> scroll-sync) and P3 perf gate (60 FPS unthrottled) both passed. Shell `DataGrid` at
> `src/data-grid/data-grid.tsx`; types in `src/data-grid/core/types/`. The whole shippable grid is
> the self-contained `src/data-grid/` folder (shadcn-registry style — consumers copy it and own it);
> `src/playground/` + `src/app/` are the demo harness and are not part of the distributable.

This is the living decision log for the data grid. It records **what was decided, why, and
what is deferred**, so we don't re-litigate settled questions.

Decided via LLM council (2026-06-09) + follow-up planning. Headline outcome:
**DOM rendering, plain-TS headless core, AntD confined to edit/expand.**

---

## D0. Rendering model: DOM (not canvas)

**Decision.** Build a DOM-rendered grid. We evaluated Glide Data Grid, which is a canvas-based grid
and decided to drop it.

**Why.** One of the requirement is to support Ant Design components in custom cells (for author's own use case). Canvas paints pixels and cannot host arbitrary React subtrees (focus, portals, popovers, ARIA, lifecycle).
Canvas can never satisfy an AntD-in-cells requirement without re-implementing every component as draw calls. Canvas however has a few strengths that we may want to consider in the future:

- Stable frame time with many simple cells.
- Fewer DOM nodes.
- Easy to paint large range-selection visuals.

**Consequence.** In actuality, Canvas was never the real threat to the 60 FPS target — **heavy components
are.** With proper row + col virtualization we only ever mount ~450–1,200 cells regardless of dataset size.
So the renderer choice and the performance target are largely independent problems.

---

## D1. State lives in a plain-TS core; React subscribes

**Decision.** The headless core is **plain TypeScript** — pure geometry/reducer functions
plus a tiny observable store. **Zero React imports in the core.** React shells subscribe via
`useSyncExternalStore`.

**The hard rule:** scroll position, range-selection drag, and hover **never trigger a React
re-render**. They update the store; the shell repaints only the affected cells/overlays.
Committed row data, the visible window, and edit mode may be ordinary React state.

**Why.** This is the single decision that makes or breaks 60 FPS. It also keeps the core
unit-testable without a DOM and portable to a canvas shell later. Chose plain-TS over a
React-hooks core for testability and learning value.

**Deferred.** Exact store API (signals vs emitter vs `useSyncExternalStore` snapshot). Start
with the simplest snapshot store; optimize hot paths only if the FPS harness demands it.

**Relaxation (see D9).** Adopting TanStack Virtual softens "scroll never re-renders React" to
"scroll re-renders only the virtualized body, whose cells are memoized." Selection-drag,
hover, and edit drafts still stay off the per-cell render path via the store.

---

## D2. Identity & coordinate model

**Decision.**

- Rows have a stable id via `getRowId(row) -> RowId`. Columns are keyed by `columnId: string`.
- **Virtualization math uses indices; persistence uses stable ids.** Selection, edits, and
expansion are keyed by `RowId`/`columnId`, never by row index.
- Canonical cell address: `CellCoord = { rowIndex: number; columnId: string }`.

**Why.** Row index is not stable identity once rows sort/filter/insert. Column *order*
changes but column *identity* does not, so columns key by id while rows index for layout.

---

## D3. Data access: push (not pull)

**Decision.** The grid receives `rows: T[]` (push) and reads cell values via
`column.accessor(row)`. No `getCellValue(col,row)` pull API.

**Why.** Pull's payoff is canvas / enormous datasets, which we dropped. Push is far more
natural for React memoization and AntD cells. Revisit only if 100k rows in memory hurts.

---

## D4. Cell contract: read-mode / edit-mode split

**Decision.** Every cell type exposes **two render paths**:

- `renderRead(value) -> cheap static markup` (a div / formatted string). This is what renders
for the thousands of resting cells.
- `renderEdit(value, api) -> the heavy AntD component`, mounted **only** when that one cell is
the active editor.

This is a **hard rule encoded in the type**, not a convention. Expanded-row content follows
the same rule (AntD is fine there — only one is mounted at a time).

**Why.** This is what lets a DOM grid be both fast and AntD-powered. "AntD in cells" and
"60 FPS at 100k×1k" have different physics; the split keeps them separate.

**Third interaction — overflow popover.** Read-mode cells truncate with ellipsis. When
content overflows, a click affordance opens a **popover** showing the full value. Overflow is
detected **on demand** (`scrollWidth > clientWidth` at interaction time), never measured for
every cell. So a cell has three read states: `read (fits)` → `read (overflowing, popover on click)` → `edit`. The popover is the first encounter with R7 (portals escaping the clipped,
transformed viewport) — treat it as an early canary.

---

## D5. Layout primitive + frozen-zone structure

**Decision.**

- Cells are **absolutely positioned with** `transform: translate`.
- **Three column zones:** left / center / right. Only the **center** zone scrolls
horizontally. One shared vertical scroll container wraps all three zones, so vertical
scrolling is "free" and only horizontal scroll needs syncing.
- **Column drag-reorder is per-zone (P7), and allowed in *every* zone — including the frozen
ones.** Within a single zone it's actually *simpler* than the center: the zone is pinned, so
there's no `scrollLeft` term in the pointer→column math; all of a frozen zone's columns are
rendered (not windowed), so the drop-index is a scan over 1–3 boundaries with no
"target column not mounted" gap; and there's no drag-near-edge auto-scroll. The drop-indicator
lives inside the zone container, so it inherits the sticky pinning.
- **Cross-zone drag is NOT supported in v1.** Dragging a header *across* a freeze boundary is the
edge-case swamp (shifting zone widths mid-drag, the dragged item crossing a sticky edge,
ambiguous "does dropping here mean unfreeze?"). The cheap guard that keeps within-zone reorder
easy: reject any drop outside the originating zone. Moving a column *between* zones — i.e.
freeze / unfreeze — is a separate **non-drag** operation (a column picker / modal that sets the
`frozen` flag), designed at its own phase, not by dragging.

**Why.** Absolute positioning gives easier variable-width virtualization and frozen
alignment with fewer layout recalcs than asking CSS Grid to manage a huge conceptual grid.

**Realization (P4).** The body is a **flex row of three zone containers** (left/center/right);
empty zones are not rendered. Flex matters: it lays the right zone at the content's *right*
edge, which is exactly where `position: sticky; right:0` needs the element to sit — so both
frozen zones pin with pure CSS, zero JS scroll-sync (the sticky header's vertical trick,
rotated). Each zone owns its own `sticky; top:0` header row, so the frozen **corners** are
sticky on both axes for free. Only the **center** zone is windowed; the column virtualizer
runs over the center columns with `**scrollMargin = leftWidth`** so its window aligns with the
center content (which begins `leftWidth` into the scroll container) — cells then position at
`vc.start - leftWidth`. **z-order:** center body (0) < center header (1) < frozen zones (2), so
frozen content correctly covers the scrolling center at the pinned edges and each corner sits
above its own body. Frozen body cells get an **opaque background** (they overlay the scrolling
center); the freeze divider is a `**box-shadow`** line, not a border, so it costs zero layout
width. The `frozen` flag (per-column) is the entire zoning model — cross-zone reorder is out
(see below). Cells/headers emit `data-frozen="left|right"` (D7).

---

## D6. Selection rendering: overlay rectangles (not per-cell flags)

**Decision.** Store selection as range coordinates `{ anchor, focus }` and draw it as **1–4
overlay rectangles** over the grid. Do **not** set a `selected` flag on each cell. A
1,000 × 100,000 selection must remain a single object. Cells compute "am I on the selection
border" only when needed.

**Why.** Marking every selected cell re-renders the window on every mousemove — the
difference between smooth and unusable during drag-select.

**P5 realization**

- **Overlay-only, no per-cell selection attributes.** Selection is *purely* the overlay
rectangles in P5 — cells carry no `data-selected`, because a per-cell flag is exactly the
mousemove re-render storm this decision exists to avoid. The D7 `data-*` styling surface is
deferred to **P9**; at most we expose `data-focused` on the *single* focused cell (one cell
re-rendering is cheap), with range styling staying overlay-only or opt-in.
- **Per-zone overlay.** The overlay is drawn *inside each zone container* (D5), so the center
slice scrolls and the frozen slices pin, reusing P4's sticky structure. The "1–4 rectangles"
is up to one slice per zone the range spans; vertical extent is pure arithmetic (uniform row
height, D8).
- **Store-driven (first use of the D1 store).** A plain-TS observable store holds the
`GridSelection`; only the overlay and checkboxes subscribe (`useSyncExternalStore`), never the
windowed body. The grid **emits `onSelectionChange`**; full controlled mode
(`GridProps.selection`) is wired at a later phase.
- **Row checkbox = shell-owned frozen-left gutter**, so it stays visible regardless of
horizontal scroll (not a consumer-declared column).

---

## D7. Headless & unstyled (react-aria / Radix style)

**Decision.** The grid ships **behavior + accessible structure + zero cosmetic styling.**
Consumers control all visuals via three surfaces:

- `className` / `style` per part — grid root, header cell, row, body cell (columns already
carry these; extend to the other parts).
- **Render props** for cell content — the consumer returns the JSX (where AntD lives).
- `**data-*` state attributes** on every part — `data-selected`, `data-focused`,
`data-editing`, `data-frozen="left|right"`, `data-overflow` — so states are styleable in
plain CSS with no prop drilling.

No theme, no CSS framework, no default colors beyond what layout structurally requires. An  
optional `starter.css` may be shipped separately as an opt-in example, never imported by core.

**Why.** Matches the "headless grid" premise. The grid chrome stays unstyled and
consumer-owned; cell *content* is where AntD (or anything) goes. No conflict between "headless
grid" and "AntD cells" — they live at different layers.

---

## D8. Uniform fixed row height (base rows)

**Decision.** All base rows share one fixed height. Expandable rows are a **separate entity**
(D-R1) handled by a sparse override, not by per-row measured heights.

**Why / payoff.** Uniform height collapses **row** virtualization to arithmetic
(`startIndex = floor(scrollTop / rowHeight)`) — no prefix-sum or binary search for rows. Only
**columns** (variable widths) and the **sparse expanded-row offsets** need prefix-sum +
binary search. This materially shrinks the P2 virtualization core.

---

## D9. Windowing via TanStack Virtual; NOT TanStack Table

**Decision.** Use `**@tanstack/react-virtual`** (`useVirtualizer`) for row + column windowing.
Do **not** use TanStack Table — the column model, row/range selection, editing, frozen zones,
and expansion are all built on our own plain-TS core (D1).

**This softens D1.** `useVirtualizer` re-renders the body on scroll, so the rule relaxes from
*"scroll never touches React"* to *"scroll re-renders only the virtualized body, whose cells
are memoized."* Selection-drag, hover, and edit drafts still route through the store and stay
off the per-cell render path (D6). This is the trade most production grids make; it hits the
60 FPS bar with cheap read-mode cells.

**Why not TanStack Table.** It solves the *easy* parts (column order/pin/size, a selection
`Set`, expansion — ~an afternoon each in our core) and none of the *hard* ones (cell range
selection, edit state machine, frozen-zone DOM + scroll sync, 60 FPS). Worse, its unstable
`table` instance and `row.getVisibleCells()` rebuild ~1,000 cell wrappers per row at 1k
columns, churning references on the scroll hot path and fighting memo at 100k×1k — the exact
cost we want to avoid. It also pulls state toward React-state-driven, away from D1's store.

**Memo discipline (the mitigation).** Memoize cells on **primitive values** (`rowId`,
`columnId`, the derived value string), never on object identity. Key each virtual row by
stable `rowId`. This keeps re-renders of the windowed body cheap.

---

## D10. Editing engine: a floating portal editor (P6 realization of D4/R4/R5/R7)

**Decision.** Editing is a **third overlay**, structurally identical to selection (D6): a plain-TS
**edit store** (`core/store/edit-store.ts`) holds the `EditState` machine; a single **`EditorPortal`**
leaf `useSyncExternalStore`-subscribes to it. **`DataGrid` never subscribes** — so opening an
editor, every draft keystroke, and the submit/error transitions re-render only that leaf, never the
windowed body. This keeps the D1/D6 contract intact through editing.

- **Headless / AntD-free (the hard constraint).** The grid ships **zero UI-lib dependency**. A
  column's `renderEdit(ctx)` returns whatever the integrator wants; `ctx` (`CellEditContext`) hands
  it `draft / setDraft / commit / cancel / status / error`. The only built-ins are **zero-dep**: a
  floating text editor and a bare native `<select>`. AntD appears **only in the playground**, as a
  `devDependency`, to exercise the override path.
- **The editor panel is grid-owned and styleable.** The `EditorPortal` host carries the visual
  frame (border/shadow/bg) and is the single styling surface (D7): `editorClassName`/`editorStyle`
  on `GridProps` apply to it, and it emits `data-editing=""`. Every editor — built-in *or* a custom
  `renderEdit` — renders transparently to fill that one frame (default editors are borderless; a
  custom AntD `Select` uses `variant="borderless"`). This keeps a foreign component from clashing:
  the grid owns the cell-matching chrome, the component supplies only the input. The active editor
  also **suppresses the cell's focus outline** (the editor is the focus indicator), so the outline
  can't peek through a custom editor's rounded/transparent edges.
- **The default text editor is a floating, auto-expanding portal** (Glide-style): a `<textarea>`
  rendered via `createPortal` to `document.body` that grows to fit its content and floats above the
  grid. Two payoffs and one cost:
  - **R7 pulled forward.** A body portal deliberately escapes the grid's `overflow`/`transform`
    clip, so the editor can exceed the cell and the grid edges. P9's portal work is de-risked; the
    AntD `Select` dropdown (its own portal) inside the floating editor is the R7 canary.
  - **R5 for free.** The editor is **not** a body cell, so cell virtualization can never unmount it
    mid-edit; the draft + focus survive scrolling.
  - **Cost:** a body portal does **not** ride the compositor scroll, so the editor **repositions on
    scroll/resize imperatively** — a `transform` write on the host ref, never setState — via the new
    pure `cellViewportRect` (the §4 formulas run forwards into *viewport* coords). A setState here
    would silently re-introduce the per-frame render this whole design avoids. While editing the host
    is **clamped to the usable viewport** so it stays visible and "frozen" at the edge as the cell
    scrolls past — it never hides.
- **Async model — optimistic, with a pending overlay (R4).** *(Revised after seeing the first cut:
  an editor that stayed open in a `submitting` state lingered as a floating popover over a cell the
  user had already clicked away from — buggy. We adopted the optimistic model instead.)* Committing
  (blur / Enter / Tab / select-pick) **closes the editor immediately**; the saving lifecycle moves
  to a third store, `core/store/pending-store.ts` — a `Map<coordKey, {cell, value, status}>` — drawn
  by a per-zone **`PendingOverlay`** (sibling of the selection overlay):
  - *pending* → an opaque box over the cell showing the optimistic value + a right-edge spinner; the
    cell is non-editable until it resolves;
  - *success* → the entry clears; the persisted value flows back through `accessor` (**parent stays
    authoritative** — the grid never mutates `rows`; the demo uses a sparse `Map<CellKey,…>` override,
    not a 100k-row copy);
  - *error* → the entry flips to `error`, the cell **reverts to the old value and flashes red**
    (Web Animations fade over `ERROR_FLASH_MS`, single-sourced with the clear delay so the flash
    can't "reappear"), then clears.
  This is genuinely **multi-pending** (you can edit other cells while one is in flight) and keeps
  the body off the edit render path (only the overlay leaf subscribes). **On failure the typed draft
  is discarded** — the cell simply reverts. (We tried preserving it for restore-on-reopen, but
  silently repopulating a cell with old typing on next open reads as a bug; without a dedicated UI
  affordance it's not worth it. Auto-reopen was rejected too: in this Enter/Tab-moves-on flow a
  delayed failure would yank focus back mid-keystroke.)
- **Triggers / navigation.** A click on the **already-focused** cell (i.e. click to focus, click
  again to edit — resolved on pointer-up so a drag-select from the focused cell still selects),
  Enter, F2, or a printable key (type-to-replace) open the editor; Enter commits + moves down, Tab
  commits + moves right, Esc cancels. **Outside-click closes
  the editor at the grid level** (`EditorPortal` listens for a `document` pointerdown outside the
  host and commits) — so any editor dismisses without wiring its own blur. **Integrator contract:** a
  custom editor with its own popup (e.g. AntD `Select`) must render it *inside* the host via
  `getPopupContainer` so popup clicks count as "inside" and the popup scrolls with the editor — the
  grid can't know about a third-party portal. Auto-advance is default-editor-only in v1; custom
  editors get `commit`/`cancel`.
- **`type: 'action'` columns are non-selectable.** A column declared `type: 'action'` (e.g. a
  frozen row-action button column) has cells the grid skips entirely — `hitTest` returns null (no
  pointer focus/drag/auto-scroll), `stepCoord` skips them (keyboard nav never lands there, via
  `ColumnPlacement.selectable`), and they're never editable. So interactive content inside
  (`renderRead` → a `<Button>`) handles its own clicks with **no** consumer-side
  `stopPropagation`/`preventDefault` wiring.
- **`renderRead` (D4) is wired** into the body `Cell` via `readContent`: a column with `renderRead`
  renders custom read-mode UI (e.g. a frozen "actions" column with an AntD Button); columns without
  it keep the cheap `String(value)` fast path. **Memo caveat:** a `renderRead` cell returns a fresh
  element each render, so it re-renders with the body on scroll (memo only holds for the
  string-valued cells, D9) — fine, since custom-render columns are few. (A custom read cell that
  spawns its own click target should `stopPropagation` on pointerdown so it doesn't trigger cell
  focus/edit — see the demo's actions button.)
- **Not done in P6.** `DataGridProps` ↔ `GridProps` are still not reconciled; P6 only added
  `onCellCommit` + `editorClassName`/`editorStyle`.

---

## Deferred decisions (decide at their phase)


| #   | Decision                                        | Phase | Current lean                                                                                                                                                                                              |
| --- | ----------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Expanded-row offsets                            | P8    | Base height is fixed (D8). Expanded rows use a sparse override (sorted list of {index, extraHeight} + cumulative offset). No measured heights in v1.                                                      |
| R2  | Sizing                                          | P3    | `size: "fluid"` (ResizeObserver) default, or `{width,height}`. Flex remainder when a column width is undefined, else horizontal scroll.                                                                   |
| R3  | Column reorder ownership                        | P7    | Controlled — emit `onColumnOrderChange(ids)`, no internal order state. Drag-reorder is **within-zone only** (incl. frozen zones); cross-zone drag is out, freeze/unfreeze is a separate non-drag op (D5). |
| R4  | Edit update strategy                            | P6 ✓  | **Done (D10):** parent authoritative; editor stays open until commit resolves (single `EditState`). Optimistic multi-pending map deferred to P9.                                                          |
| R5  | Editor survives cell unmount mid-scroll         | P6 ✓  | **Done (D10):** the editor is a `body` portal, not a body cell, so virtualization can't unmount it; it repositions imperatively on scroll.                                                                |
| R6  | Cmd+arrow semantics                             | P5    | Jump to grid edge in v1 (not next-filled-cell).                                                                                                                                                           |
| R7  | AntD portal/popover escaping the clip container | P9    | **Partly solved early (D10):** the default editor is itself a `body` portal escaping the clip. P9 still owns the full sweep (AntD dropdowns/tooltips); the demo's AntD `Select` is the canary.            |


---

## Known frame-budget risks

The frame budget dies from **interaction/async physics**, not steady-state scroll of text  
cells.

- Range-selection re-render storms across 1,000 columns → overlay, not per-cell state (D6).
- Async edit vs virtualization → a cell mid-edit can scroll out and unmount (R5).
- Expandable rows with variable height break uniform prefix-sum windowing (R1).
- AntD portals/popovers escape the clipped, transformed viewport (R7).
- "60 FPS" must be operationally defined (see harness below) or "measure it" is unfalsifiable.
- Accessibility of windowed DOM — the reason to pick DOM — still needs `aria-rowindex` work.

---

## The FPS harness (acceptance test)

"≥60 FPS" is meaningless without fixed conditions. The harness defines them:

- **Build: production only (`vite preview`).** NEVER measure on the dev server — `StrictMode`
double-render + unminified dev React understate FPS 2–4× (measured: dev 44 avg / 15 worst
vs prod 59 avg / 30 worst on the same diagonal scroll).
- **CPU throttle:** Chrome DevTools Performance → 4× CPU slowdown (mid-tier laptop proxy).
- **Workload:** the 100k rows × 1,000 columns stress fixture.
- **Motion:** sustained scroll (wheel + drag-thumb), plus a range-select drag across the
viewport. Measure during motion, not at rest.
- **Metric:** rolling FPS + **rolling minimum** (worst frame matters more than average) and
per-frame ms. An in-app overlay reports these live; cross-check with React Profiler and a
Chrome performance flame chart for the source of any stalls.
- **Pass bar:** rolling-min ≥ 60 FPS during scroll on the dumb-cell grid (P3); ≥ 60 FPS with
one active AntD editor cell mounted (P6).

**P3 result (prod build, sticky header, UNTHROTTLED):** vertical 60 avg / 30 worst / 1.2% < 60;
horizontal 60 / 56 / 0%; diagonal worst-case 59 / 30 / 1.8%. Averages identical to the pre-sticky
build (the native-sticky header removed main-thread work, so zero perf cost). The ~1–2% sub-50
frames are GC-driven single-frame dips under an aggressive synthetic scroll (90px/frame ≈
5400px/s, faster than real use). Clears the gate on full CPU. ⚠ Still TODO: confirm under the
4× CPU throttle (manual DevTools; the browser tools can't set `Emulation.setCPUThrottlingRate`).

---

## Build roadmap

Each phase is demoable; don't advance until the current one renders correctly in the
playground.

- **P0 — Scaffold + harness.** react-router, playground route, 100k×1k fixture generator,
FPS overlay.
- **P1 — Schema & public API.** `Column<T>`, `CellType`, `CellContext`, `GridProps`,
`CellCoord`, selection/edit state types. Encodes D2/D3/D4 as types.
- **P2 — Virtualization via TanStack Virtual (D9).** Wire `useVirtualizer` for rows + cols.
Rows are uniform (D8) so row sizing is constant; columns pass per-index widths. Memoize
cells on primitive values. Expanded-row offsets (R1) handled via the column/row size fns.
- **P3 — Dumb DOM shell. 🚦 GATE.** Absolute-positioned plain-div text cells, row + column
virtualization, no freeze/select/edit. **Prove ≥60 FPS at 100k×1k.** If this fails, stop.
- **P4 — Frozen zones.** Left/center/right, scroll sync (D5).
- **P5 — Selection + keyboard nav.** Focus cell, arrow / Cmd-arrow, range as overlay (D6),
row checkbox.
- **P6 — Editing engine (headless, AntD-free). ✓ code-complete.** Edit store + `EditorPortal`
(D10): floating auto-expanding default editor, `renderEdit` override, async commit with
submitting/error, read/edit split (D4). AntD is demoed via `renderEdit` (devDependency only), not
baked in. ⚠ Interactive UX + FPS re-measure (editor mounted) still a manual `vite preview` check.
- **P7 — Column drag-reorder.** Drop-indicator line only, controlled order (R3).
- **P8 — Expandable rows.** Sparse height override in the virtualizer (R1).
- **P9 — Polish.** Custom-cell API, AntD portal fix (R7), perf write-up, a11y pass.

