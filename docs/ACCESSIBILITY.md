# Accessibility and interaction

Data Griddle's source implementation includes grid semantics, keyboard navigation and touch tap/scroll handling. Browser,
physical-device and screen-reader compatibility is **not yet verified**. The first release remains
blocked on the manual matrix below. Automated tests and a browser accessibility tree do not establish
screen-reader usability.

## Semantics and virtualization

Give each grid an `aria-label` or `aria-labelledby`. The default name is “Data grid”. The scroller
has `role="grid"`, full supplied row/column counts, and multiselection semantics. Counts include one
header row and, when enabled, one row-selection column. The grid does not know server-side totals:
counts describe the supplied `rows` array. Cell and row indices use one-based positions in that
complete dataset and the resolved visual column order, including virtual-window gaps.

Logical ARIA rows own the real rendered header/cell elements across the gutter and frozen zones
using `aria-owns`. Custom content is not duplicated. Row `aria-selected` describes checkbox selection;
cell `aria-selected` describes the rectangular range. Active-cell focus is separate from selection.
`aria-readonly` reflects each cell's editing capability. The active descendant references a real,
mounted cell. Manually scrolling that cell out of the virtual window removes the reference; returning
it to the window restores it. Keyboard entry/navigation scrolls the active cell into view.

This ownership model needs manual testing for header association, row order and active-descendant
announcements on every chosen AT combination. If an engine/AT fails to follow ownership, a different
DOM layout is required before claiming support. The grid does not provide a complete, nonvirtualized
browse-mode table or export. Applications needing one must supply a separate view.

## Keyboard and focus

| Input                | Behavior                                                                   |
| -------------------- | -------------------------------------------------------------------------- |
| Tab / Shift+Tab      | Follow browser tab order through grid, controls and page                   |
| Arrows               | Move among selectable data cells; action/nonselectable columns are skipped |
| Shift+Arrows         | Extend the range                                                           |
| Ctrl/Meta+Arrows     | Move to an edge                                                            |
| Home / End           | First/last selectable column in the current row                            |
| Ctrl/Meta+Home / End | First/last selectable cell in the supplied dataset                         |
| PageUp / PageDown    | Move by the visible body row count                                         |
| Enter / F2           | Edit the active editable cell                                              |
| Printable character  | Replace the active editable cell's draft                                   |
| Escape               | Clear range and cancel an active pointer gesture                           |

The grid container is a tab stop for cell navigation. Rendered checkboxes and custom controls keep
normal browser tab order and their native keys; the grid does not rewrite `tabindex`, provide an
interaction mode, or handle F6. Tab/Shift+Tab pass through these controls before leaving the grid.
The cell-navigation shortcuts above apply when the grid container has focus, not inside a control.

Only mounted controls exist. Their tab sequence follows DOM order across frozen zones, which can
have more stops and differ from visual row order. This is a minimal native-tab implementation, not
the single-tab-stop composite-grid pattern. Custom content owns focusability, accessible names and
visible focus; avoid positive tabindex. There is no grid-level copy/paste, sorting or filtering shortcut.

The active cell border supplies the focus indicator. A keyboard-focused grid without a logical
active cell (for example, an empty grid) uses a container outline as a fallback. Scrolling a focused
cell outside the virtual window removes its ARIA reference, but does not enable the container
outline. Keyboard navigation brings the active cell back into view.

Keyboard-accessible column resizing/reordering remains pending. The grid does not render a built-in
actions panel. Mouse header resizing/reordering remains available within capability and zone bounds.

## Editing, validation and errors

Built-in editors are named “Column name, row N”. Text-editor Enter saves and moves down;
Shift+Enter inserts a newline; Tab/Shift+Tab save and move right/left; Escape cancels. Commit/cancel
keys are ignored during composition (including the key-code 229 fallback). Save edit and Cancel edit
buttons provide explicit touch actions. Native select changes retain their immediate-save behavior.

Explicit validation failures keep the editor open, associate the error with its input, and announce
it. Leaving the default editor host implicitly commits according to the existing validation policy:
an invalid implicit draft is discarded. Moving among its input and action buttons does not save.
Explicit save/cancel restores grid focus; leaving for an outside control does not steal that focus.

Asynchronous failures clear the pending display, briefly mark the failed cell and call
`onCellCommitError({ update, error })`. The editor has already closed; application rows are never
mutated or rolled back by the grid. **The application owns accessible save-error feedback**:
provide a visible message and an appropriate live region through that callback, outside any loading
or inert subtree. The grid does not announce save failures automatically. See the
[integration example](./INTEGRATION.md#application-owned-save-error-feedback).
Pending visual values are hidden from the accessibility tree to avoid duplicate cells;
authoritative row content remains exposed until the application updates.

The body-mounted editor follows ancestor scrolling, window/container resize and visual viewport
changes. Built-in editor frames clamp to the visible viewport and scroll internally when needed.
Custom popups remain inside their editor host and retain overflow behavior. Custom editors own
input labels, validation associations, composition handling, keyboard exit, popup sizing, explicit
save/cancel controls and focus. Test them independently, including with the on-screen keyboard.

## Touch and narrow layouts

Normal touch on cells and headers preserves browser scrolling and pinch zoom. A release within 8px
without scroll movement selects a cell; repeated taps do not implicitly edit. Native/custom selection
controls retain normal tap activation. Pending taps are cancelled on additional contacts, cancellation,
loading and identity/geometry changes. Mouse drag selection and header manipulation remain available.

**Implementation gaps (2026-09-27):** the built-in actions panel was removed at the user's request.
Touch entry into editing, deliberate touch range selection, and touch column resizing/reordering
need replacement interactions. These remain required preview features, not completed verification
items. Normal touch header dragging does not resize/reorder, and normal swipes never select a range.

Default checkboxes are 24px controls inside labels covering their gutter cell (40px wide); choose
`rowHeight` 44 or larger for taller row targets. Replacement controls must provide usable targets.

Keep frozen widths plus gutter below container width, leaving useful center space. The grid never
silently unpins consumer columns. Use container-aware column props for narrow layouts/orientation.
The `/integration` example uses 44px rows; below 640px it narrows Name to 120px and unpins Status.
Test both frozen bands at wider widths and transitions with an active editor/selection.

**Pen scope:** pen-driven grid drag manipulation is excluded from the current preview implementation
and is not a support claim. Native controls can receive pen activation. Decide and verify dedicated
pen gestures separately; do not infer them from mouse or touch results.

## Manual release matrix

Record date, commit, browser/OS/device versions, AT version/settings, input method, exact scenario,
observed result and pass/fail for each entry. No minimum supported versions are established yet.

| Environment             | Required checks                                    | Current status (2026-09-27)                           |
| ----------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Desktop Chrome          | All desktop steps; NVDA on Windows                 | Unverified; Brave smoke checks are not Chrome support |
| Desktop Edge            | All desktop steps; Narrator and/or NVDA on Windows | Unverified                                            |
| Desktop Firefox         | All desktop steps; NVDA on Windows                 | Unverified                                            |
| Desktop Safari          | All desktop steps; VoiceOver on macOS              | Unverified                                            |
| Physical iOS Safari     | All mobile steps; VoiceOver                        | Unverified                                            |
| Physical Android Chrome | All mobile steps; TalkBack                         | Unverified                                            |
| Windows forced colors   | Focus, selection, controls, errors and editing     | CSS implemented; manual verification pending          |

Desktop steps (use `/integration`, `/styling` and `/loading`):

1. Tab from outside into/out of the grid in both directions. Check visible focus before any cell
   selection. Exercise every key above, empty data, all-nonselectable columns, first/last cells,
   offscreen rows/columns, multiple grids, and row reversal/removal. Verify active references never
   point to missing elements. Tab/Shift+Tab through default/custom controls and out to the page;
   confirm native keys work and focus remains visible as controls enter the virtual window.
2. With each AT, confirm grid name/counts; one logical row spanning both frozen bands; column header
   association; current cell value/position/read-only state; range and row selection. Scroll both
   axes through virtual-window gaps and navigate offscreen. Confirm no duplicate rows or content.
   Manually scroll the active cell away and back; confirm navigation remains understandable.
3. Test default **and custom** checkboxes: no selection, one row (mixed header), all rows, mixed→clear,
   Space/Enter as appropriate, Tab/Shift+Tab, read-only and loading. AT must announce name, checked/mixed,
   disabled/read-only state. Confirm one activation produces one selection update.
4. Edit text and native select values; cancel, unchanged save, invalid explicit save, corrected save,
   implicit invalid discard, rejected async save (including while loading) and row disappearance.
   Confirm field/error names, visible errors and correct focus destination. For async rejection,
   wire application feedback through `onCellCommitError` and verify its announcement, including while
   loading. Default editor validation announcements are separate and remain grid-provided.
   Open custom Status suggestions, choose Away, save/cancel; internal popup input must not commit early.
5. Resize from both sides of a seam; reorder in each frozen/center zone, including barriers and
   read-only columns. Keyboard equivalents are blocked on replacement interaction design. Verify sticky headers/bands during both
   scroll axes, capture outside grid, Escape, lost capture, loading, resize and unmount interruptions.
6. Use actual browser zoom at 200% and 400% plus OS text scaling; confirm no lost controls, readable
   errors and reachable horizontal overflow. Check default and custom light/dark themes and Windows
   forced colors: focus/ranges/errors must remain distinguishable without background color alone.
   Inspect long/multiline editor content and popup placement while page and nested ancestors scroll.

Physical mobile steps (desktop viewport emulation does not satisfy these):

1. On named iOS/Android devices, scroll the page, grid vertically and horizontally, start swipes in
   cells/headers/gutter, pinch zoom, tap and double-tap. No swipe should create a range or open an
   editor. Verify native/custom checkbox targets, mixed and read-only states with touch and AT.
2. **Blocked until touch edit entry is implemented:** open an editor by touch and type with the
   on-screen keyboard. Test opening/closing/changing
   keyboard, predictive text, Japanese/Chinese/Korean IME candidates, dictation, emoji, select picker,
   native copy/paste, Save and Cancel. Candidate-confirmation Enter must not save prematurely.
3. **Blocked until deliberate touch range interaction is implemented:** enter range selection,
   drag across zones and beyond all edges; verify edge scrolling and range. Release
   and immediately pan normally. Repeat with pointercancel, lost capture, a second finger both inside
   and outside the grid, app switch, loading, data changes and orientation changes. No stuck capture,
   continuing scroll loop, accidental editor or resize/reorder commit is acceptable.
4. **Blocked until touch column actions are implemented:** resize/move to limits/barriers and cancel
   mid-interaction without committing. Move an offscreen center column through repeated actions;
   confirm it scrolls into view. Repeat with controlled read-only state and action columns.
5. Test 320–430px portrait widths, landscape, device rotation, large fonts, both frozen bands and
   responsive unpinning. With AT active, use touch exploration and gesture navigation to complete
   selection, editing and column actions. Record usability findings, not only attribute inspection.

Implementation references: [ARIA grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/),
[virtual grid indices](https://www.w3.org/WAI/ARIA/apg/practices/grid-and-table-properties/),
[touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action),
[visual viewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport).
