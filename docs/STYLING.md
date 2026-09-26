# Styling Data Griddle

The experimental styling interface consists of scoped default CSS, `--dgr-*` variables,
part/state selectors, and column class callbacks. Importing `DataGrid` from this repository's
source entry imports both grid and loading CSS. There is no separately published stylesheet
entry yet; package exports and Next.js stylesheet integration remain release work.

Set tokens on the grid's `className`, inline `style` (cast custom properties to `CSSProperties`
in TypeScript), or an ancestor. Defaults use fallbacks at their use sites, so ancestor tokens
remain inherited. `id`, `className`, and `style` belong to the stationary `.dgr-root` frame.
`[data-grid-scroller]` is the inner scrolling/focus element. The grid fills its parent; give
that parent a definite height.

```css
.accounts {
  --dgr-background: #111827;
  --dgr-text-color: #f3f4f6;
  --dgr-header-background: #1f2937;
  --dgr-cell-border-color: #374151;
  --dgr-header-border-color: #4b5563;
  --dgr-frozen-divider-color: #64748b;
  --dgr-focus-color: #93c5fd;
  --dgr-skeleton-bar-color: #374151;
  --dgr-empty-color: #d1d5db;
}
```

## Tokens and defaults

Color values accept ordinary CSS colors. Typography, lengths, and shadows accept the CSS values
appropriate to their property. A fallback to another token is resolved independently at each
surface. Keep body, header, skeleton backing, and pending surfaces opaque, especially with frozen
columns. Tokens do not calculate contrast automatically.

| Token                              | Default                                                      | Purpose                                                         |
| ---------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `--dgr-background`                 | `#fff`                                                       | Frame, body, cells, pending values                              |
| `--dgr-text-color`                 | `#1c1917`                                                    | Text; draft notice fallback is `#44403c`                        |
| `--dgr-font-family`                | `system-ui, sans-serif`                                      | Grid and editor typography                                      |
| `--dgr-font-size`                  | `13px`                                                       | Grid and editor type size                                       |
| `--dgr-cell-padding-inline`        | `10px`                                                       | Cell/header/pending horizontal padding                          |
| `--dgr-cell-border-color`          | `#f0efee`                                                    | Body cell/pending grid lines; discard-button fallback `#d6d3d1` |
| `--dgr-header-background`          | `#f5f5f4`                                                    | Headers and discard button                                      |
| `--dgr-header-font-weight`         | `600`                                                        | Column header weight                                            |
| `--dgr-header-border-color`        | `#e7e5e4`                                                    | Header/gutter right borders, pending spinner track              |
| `--dgr-frozen-divider-color`       | `#d6d3d1`                                                    | Frozen dividers, header-row bottom edge, draft notice border    |
| `--dgr-selection-background`       | `rgb(37 99 235 / 12%)`                                       | Range fill                                                      |
| `--dgr-selection-border-color`     | `rgb(37 99 235 / 55%)`                                       | Range outline                                                   |
| `--dgr-focus-color`                | `#2563eb`                                                    | Focus ring and editor border                                    |
| `--dgr-resize-indicator-color`     | `#2563eb`                                                    | Resize guide                                                    |
| `--dgr-reorder-indicator-color`    | `#2563eb`                                                    | Column drop guide                                               |
| `--dgr-skeleton-background`        | `--dgr-background`, then `#fff`                              | Opaque skeleton backing                                         |
| `--dgr-skeleton-bar-color`         | `#f5f5f4`                                                    | Masked skeleton bars                                            |
| `--dgr-pending-color`              | Text `#78716c`; spinner arc `#2563eb`                        | Saving value and activity                                       |
| `--dgr-error-color`                | `#dc2626`; error-footer divider `#fecaca`                    | Editor/commit error border and text                             |
| `--dgr-error-background`           | Commit flash `rgb(220 38 38 / 10%)`; editor footer `#fef2f2` | Error fill                                                      |
| `--dgr-editor-background`          | `--dgr-background`, then `#fff`                              | Portal panel and native options                                 |
| `--dgr-editor-radius`              | `4px`                                                        | Panel corners                                                   |
| `--dgr-editor-shadow`              | `0 2px 12px rgb(0 0 0 / 12%)`                                | Panel shadow                                                    |
| `--dgr-editor-padding`             | Text `5px 9px`; select `4px 6px`                             | Built-in editor content padding                                 |
| `--dgr-loading-overlay-background` | `rgb(255 255 255 / 65%)`                                     | Retained-result refresh overlay                                 |
| `--dgr-loading-indicator-color`    | `#57534e`                                                    | Default refresh spinner                                         |
| `--dgr-empty-color`                | `#78716c`                                                    | Empty-result content                                            |

## Parts and states

Default selectors have low specificity and use only grid-owned classes. Built-in control resets
use class specificity to beat ordinary host element rules. There is no global reset.
Use your own root class to scope custom read-mode styles. A body's editor is outside that root;
use tokens for portable editor styling, or `.dgr-editor-host` for common editor rules.

| Part or state                                                                            | Contract                                                   |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `.dgr-root[data-grid-frame]`                                                             | Stationary outer frame                                     |
| `[data-grid-scroller]`                                                                   | Native scroller; `aria-busy` tracks loading                |
| `.dgr-zone[data-zone="left\|center\|right"]`                                             | Column zone; match one value at a time                     |
| `.dgr-cell`, `.dgr-header-cell`                                                          | Rendered read-mode cell/header                             |
| `[data-frozen="left\|right"]`                                                            | Frozen cell/header; absent for center                      |
| `[data-resize-handle="left\|right"]`                                                     | Header hit-area affordance; geometry is grid-owned         |
| `.dgr-header-row`, `.dgr-body`                                                           | Zone header and opaque body surfaces                       |
| `.dgr-row-gutter`, `.dgr-gutter-header`, `.dgr-gutter-cell`, `.dgr-checkbox`             | Built-in row-selection parts                               |
| `.dgr-row-gutter[data-divider]`                                                          | Strong gutter divider when no left frozen zone supplies it |
| `.dgr-selection-range`, `.dgr-focus-ring`                                                | Store-driven selection/focus overlays                      |
| `.dgr-resize-indicator`, `.dgr-reorder-indicator`                                        | Gesture guides                                             |
| `.dgr-pending-cell`, `.dgr-pending-spinner`, `.dgr-pending-track`, `.dgr-pending-stroke` | Optimistic value and saving indicator                      |
| `.dgr-error-cell`                                                                        | Failed commit flash                                        |
| `.dgr-editor-host[data-editing]`, `.dgr-editor-host[data-invalid]`                       | Active portal and validation-error state                   |
| `.dgr-editor-input`, `.dgr-editor-error`                                                 | Built-in textarea/select and validation footer             |
| `.dgr-draft-notice`, `.dgr-draft-discard`                                                | Preserved draft with temporarily missing target            |
| `.dgr-skeleton`, `.dgr-skeleton-bars`                                                    | Opaque backing and constant-node tiled alpha mask          |
| `.dgr-loading-layer[data-grid-state="initial-loading"]`                                  | Initial skeleton presentation                              |
| `.dgr-loading-layer[data-grid-state="refreshing"]`                                       | Retained-result overlay                                    |
| `.dgr-loading-body`, `.dgr-loading-indicator`, `.dgr-loading-spinner`                    | Loading layout and default indicator                       |
| `.dgr-empty-content`, `.dgr-status-text`                                                 | Empty result and visually hidden accessible announcement   |

Selection states live on overlays, not every cell. Do not reveal `.dgr-status-text` or override
interaction blocking. Loading's existing reduced-motion choice is unchanged: initial bars pulse
and the spinner rotates even when reduced motion is requested; scrolling fallback bars stay static.

## Conditional classes

```tsx
const columns: Column<Entry>[] = [
  {
    id: "balance",
    name: "Balance",
    accessor: (row) => row.balance,
    cellClassName: (ctx) => (Number(ctx.value) < 0 ? "negative" : undefined),
    headerClassName: "numeric-heading",
  },
];
```

```ts
cellClassName?: string | ((ctx: CellRenderContext<T>) => string | undefined);
headerClassName?: string | ((ctx: HeaderRenderContext<T>) => string | undefined);
```

Cell context contains `row`, `rowId`, `rowIndex`, `column`, `columnId`, `value`, `width`, and
`height`. The accessor result and context are shared with `renderCell`. Header context contains
`column`, `columnId`, `columnIndex`, `frozen`, `width`, `resizable`, and `reorderable`.
Callbacks run during ordinary rendering; they must be pure and inexpensive. They update when
supplied data changes and are not selection subscriptions. Returned classes supplement stable
part classes; `undefined` adds nothing.

Use classes for text color, weight, decorations, and opaque cell backgrounds. Do not override
position, transforms, width/height, box sizing, scrolling, pointer hit areas, or border thickness.
Static layout lives in grid CSS; calculated geometry remains inline. Moving layout into CSS does
not make it a supported customization surface. The `dgr-scroller`, `dgr-content`, `dgr-overlay`,
and `dgr-pending-value` helper classes are internal, not additional public styling hooks.
Use `rowHeight` for density and column width configuration for horizontal geometry. Font size and
padding do not increase row height automatically; choose a row height that fits your content.

## Editor themes

An active editor lives under `document.body`. Its leaf copies the originating frame's resolved
allowlisted tokens plus computed font family, font size, text color, and direction. Each grid has
its own snapshot; closing a grid's editor does not change another grid's theme.

Synchronization runs on mount/remount, root or ancestor `class`, `style`, or `data-theme`
mutations, viewport resize, and `prefers-color-scheme` changes. Notifications are coalesced into
one animation frame; there is no continuous polling or grid-body subscription. Removed tokens
are removed from the host too. Built-in text editors remeasure after theme or column-width changes.
Loading preserves the draft and pauses theme observation while the host is hidden. Resuming or
remounting reads a fresh snapshot and remeasures the built-in editor while it is visible.

Arbitrary CSSOM stylesheet edits, stylesheet load events, other attribute selectors, and DOM
reparenting outside React are not automatically observed. Use the supported theme triggers when
updating themes while editing. Root-scoped selectors and arbitrary custom properties do not copy
to the body portal; use documented tokens or explicit classes on custom editor content. Direction
copying preserves editor typography; it does not establish RTL grid-layout support.

The grid owns the editor frame. `--dgr-editor-padding` styles built-in controls; custom editors
own their content padding, controls, focus handling, and contrast. Keep popups inside the editor
host to avoid outside-click commits. A custom control can use inherited tokens and `font: inherit`.

## Examples

Run `pnpm dev` and visit `/styling` for independent day/night grids, conditional frozen and center
cells, density/type controls, initial/refresh/empty states, delayed or failed saves, a custom Status
editor, and timed theme/override changes during editing. `/styling-check.html` imports no playground
reset and includes ordinary controls outside the grid. This is a source-development fixture, not
proof of npm packaging.

React 18, Next.js, package delivery, accessibility, and physical mobile support remain unverified
release targets.

Selection controls can also be replaced through `renderSelectionCheckbox`; see the
[integration guide](./INTEGRATION.md#replaceable-selection-checkboxes). `.dgr-checkbox` styles the
native default only. Replacement controls own their visuals and focus indicator while the gutter
retains its dimensions and selection semantics.
