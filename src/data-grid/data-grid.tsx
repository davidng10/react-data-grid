import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualItem } from "@tanstack/react-virtual";
import type {
  CellCommit,
  CellCoord,
  CellEditContext,
  Column,
  ColumnId,
  FrozenZone,
  GridSelection,
  RowId,
} from "./core/types";
import { cellKey } from "./core/types";
import { createGridStore } from "./core/store/grid-store";
import type { GridStore } from "./core/store/grid-store";
import { createEditStore } from "./core/store/edit-store";
import type { EditStore } from "./core/store/edit-store";
import { createPendingStore, ERROR_FLASH_MS } from "./core/store/pending-store";
import { createDragStore } from "./core/store/drag-store";
import type { DragStore } from "./core/store/drag-store";
import {
  cellToZoneRect,
  dragBounds,
  dropIndexAtX,
  rangeToZoneRects,
  reorderWithinZone,
  stepCoord,
} from "./core/selection/geometry";
import type {
  ColumnPlacement,
  Direction,
  GridGeometry,
  Zone,
} from "./core/selection/geometry";
import { EditorPortal } from "./editors/EditorPortal";
import { PendingOverlay } from "./editors/PendingOverlay";

// The grid shell (DOM-rendered). DECISIONS.md D5/D8/D9 + frozen zones (P4) + selection (P5).
//
// Windowing via TanStack Virtual: one vertical row virtualizer (uniform height, D8) + one
// horizontal column virtualizer that windows ONLY the center zone. Cells are absolutely
// positioned with transform (D5) and memoized on primitive values (D9).
//
// Frozen zones (D5): columns split into three zones (left/center/right) laid out as a flex row;
// left/right are `position: sticky` so they ride the body's compositor scroll (zero JS sync),
// and each zone owns its own `sticky; top:0` header so the frozen corners pin on both axes. An
// optional shell-owned checkbox gutter is a fourth sticky element pinned at the very left.
//
// Selection (D6): the focused cell + range live in a plain-TS store (D1), drawn as per-zone
// OVERLAY rectangles — never as per-cell flags. Only the overlay leaves + the checkbox gutter
// subscribe to the store (`useSyncExternalStore`); the windowed body never re-renders on
// focus/drag, so a 1,000-column drag-select stays cheap. Pointer drag (with edge auto-scroll)
// and keyboard nav route through the store + pure geometry.

export interface GridStats {
  rows: number;
  cols: number;
  renderedCells: number;
}

const DEFAULT_ROW_HEIGHT = 32;
const DEFAULT_COL_WIDTH = 140;
const GUTTER_WIDTH = 40;

const HEADER_BG = "#f5f5f4";
const HEADER_BORDER = "1px solid #d6d3d1";
// The freeze line — a 1px divider that reads more clearly than the inter-cell border. Drawn as
// a box-shadow (not a border) so it costs zero layout width: it overlays the scrolling center
// at the boundary instead of widening the zone past the budgeted `totalWidth`.
const FREEZE_DIVIDER_COLOR = "#d6d3d1";
const FREEZE_DIVIDER_LEFT: CSSProperties = {
  boxShadow: `1px 0 0 0 ${FREEZE_DIVIDER_COLOR}`,
};
const FREEZE_DIVIDER_RIGHT: CSSProperties = {
  boxShadow: `-1px 0 0 0 ${FREEZE_DIVIDER_COLOR}`,
};
// Frozen body cells must be opaque so the scrolling center band doesn't show through them as it
// slides underneath (z-ordering puts frozen zones above center). Read-mode only; transparency
// for AntD edit cells is a P6 concern.
const FROZEN_BG = "#ffffff";

// Overlay cosmetics (D6). The dumb shell hard-codes light styling; the D7 theming surface is P9.
const SELECT_FILL = "rgba(37, 99, 235, 0.12)";
const SELECT_BORDER = "1px solid rgba(37, 99, 235, 0.55)";
const FOCUS_BORDER = "1px solid #2563eb";

// Auto-scroll while drag-selecting near a viewport edge.
const EDGE_ZONE = 48;
const EDGE_SPEED = 22;

// Column drag-reorder (P7). The pointer must move this far before a header press becomes a drag
// (so a plain header click isn't swallowed). The drop indicator is a 2px line in the header strip.
const DRAG_THRESHOLD = 4;
const DROP_LINE_COLOR = "#2563eb";

export interface DataGridProps<T> {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T, index: number) => RowId;
  rowHeight?: number;
  overscanRows?: number;
  overscanCols?: number;
  /** Show the shell-owned row-checkbox gutter, pinned at the far left (D6). */
  enableRowSelection?: boolean;
  /** Emitted on any selection change (D6). Full controlled mode (`selection` in) is a later phase. */
  onSelectionChange?: (next: GridSelection) => void;
  /**
   * Column order as a list of column ids (R3) — controlled; the grid holds NO internal order state.
   * When supplied, columns render in this order (still grouped by their `frozen` zone — order only
   * sorts WITHIN each zone). Drag-reorder requires this to be wired: omit it and a header drag fires
   * `onColumnOrderChange` but nothing moves.
   */
  columnOrder?: ColumnId[];
  /** Emitted with the new full id order when a within-zone column drag-reorder completes (P7/D5). */
  onColumnOrderChange?: (order: ColumnId[]) => void;
  /**
   * Commit handler fallback when a column has no own `onCommit` (R4). Receives the parsed
   * `nextValue`; the consumer persists it and feeds it back as new `rows` (the grid never mutates
   * row data). Return a promise to drive the editor's `submitting`/`error` states.
   */
  onCellCommit?: (update: CellCommit<T>) => Promise<void> | void;
  /**
   * Style the floating editor panel — the grid-owned host that frames the active editor (D7). The
   * host also carries `data-editing=""` for plain-CSS targeting. Overrides the default frame; the
   * built-in editors and well-behaved custom `renderEdit`s render transparently to fill it.
   */
  editorClassName?: string;
  editorStyle?: CSSProperties;
  /** Written during render so the perf meter can read counts without scroll-frequency setState. */
  statsRef?: { current: GridStats };
}

const cellBase: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  padding: "0 10px",
  fontSize: 13,
  boxSizing: "border-box",
  borderRight: "1px solid #f0efee",
  borderBottom: "1px solid #f0efee",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

// `content` is usually the value string (memo stays stable across scroll — D9). A column with a
// custom `renderRead` passes a ReactNode instead; that breaks the memo for *those* cells only (a
// fresh element each render), which is fine — custom-render columns are few, the bulk stay cheap.
const Cell = memo(function Cell(props: {
  content: ReactNode;
  x: number;
  y: number;
  width: number;
  height: number;
  frozen?: FrozenZone;
}) {
  const { content, x, y, width, height, frozen } = props;
  return (
    <div
      data-frozen={frozen}
      style={{
        ...cellBase,
        width,
        height,
        lineHeight: `${height}px`,
        transform: `translate(${x}px, ${y}px)`,
      }}
    >
      {content}
    </div>
  );
});

// Read-mode content for a body cell: a column's `renderRead` (D4) if present — where custom cell
// UI like an actions button lives — else the value coerced to a truncated string (the cheap default
// for the thousands of resting cells).
function readContent<T>(
  col: Column<T>,
  row: T,
  rowIndex: number,
  rowId: RowId,
): ReactNode {
  const value = col.accessor(row);
  return col.renderRead
    ? col.renderRead({ row, rowId, rowIndex, column: col, value })
    : String(value ?? "");
}

const HeaderCell = memo(function HeaderCell(props: {
  name: string;
  x: number;
  width: number;
  height: number;
  frozen?: FrozenZone;
  /** Show the grab affordance (column drag-reorder, P7). */
  draggable?: boolean;
}) {
  const { name, x, width, height, frozen, draggable } = props;
  return (
    <div
      data-frozen={frozen}
      style={{
        ...cellBase,
        fontWeight: 600,
        borderRight: "1px solid #e7e5e4",
        background: HEADER_BG,
        width,
        height,
        lineHeight: `${height}px`,
        transform: `translateX(${x}px)`,
        cursor: draggable ? "grab" : undefined,
      }}
    >
      {name}
    </div>
  );
});

// The selection layer for ONE zone. Subscribes to the store (so only this leaf re-renders on a
// focus/drag change, never the body) and draws the slice of the range + focus that falls in its
// zone, in zone-local coords (the same coords the cells use). `memo` keeps it off the scroll hot
// path — props are stable across scroll, so it only re-renders when the selection itself changes.
const SelectionOverlay = memo(function SelectionOverlay(props: {
  zone: Zone;
  store: GridStore;
  editStore: EditStore;
  geom: GridGeometry;
}) {
  const { zone, store, editStore, geom } = props;
  const selection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const edit = useSyncExternalStore(editStore.subscribe, editStore.getSnapshot);

  const rangeRects = selection.range
    ? rangeToZoneRects(selection.range, geom).filter((r) => r.zone === zone)
    : [];
  // While a cell is being edited, the editor IS the focus indicator — suppress the focus outline so
  // it doesn't peek out behind a custom editor's rounded corners / transparent edges.
  const fc = selection.focusedCell;
  const editingCell = edit.status === "idle" ? null : edit.cell;
  const isEditingFocused =
    fc != null &&
    editingCell != null &&
    editingCell.rowIndex === fc.rowIndex &&
    editingCell.columnId === fc.columnId;
  const focusRect = fc && !isEditingFocused ? cellToZoneRect(fc, geom) : null;
  const focus = focusRect && focusRect.zone === zone ? focusRect : null;

  if (rangeRects.length === 0 && !focus) return null;

  // No z-index: rendered after the cells, so it paints above them by tree order while staying
  // below the sticky header (z1) and — for the center — below the frozen zones (z2).
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {rangeRects.map((r, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: r.width,
            height: r.height,
            transform: `translate(${r.x}px, ${r.y}px)`,
            background: SELECT_FILL,
            border: SELECT_BORDER,
            boxSizing: "border-box",
          }}
        />
      ))}
      {focus && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: focus.width,
            height: focus.height,
            transform: `translate(${focus.x}px, ${focus.y}px)`,
            border: FOCUS_BORDER,
            boxSizing: "border-box",
          }}
        />
      )}
    </div>
  );
});

// The drop-indicator for a column drag (P7), one leaf per zone. Mounted INSIDE that zone's sticky
// header strip, so it shares the header cells' coordinate space (zone-local x) and pins/scrolls
// with them. Subscribes to the drag store, so a header drag re-renders only this leaf, never the
// body (D1/D6). Header-only line; reorder stays within the source zone (D5), so a zone only paints
// the indicator while ITS own header is the drag source.
const DragOverlay = memo(function DragOverlay(props: {
  zone: Zone;
  dragStore: DragStore;
  rowHeight: number;
}) {
  const { zone, dragStore, rowHeight } = props;
  const drag = useSyncExternalStore(dragStore.subscribe, dragStore.getSnapshot);
  if (drag.status !== "dragging" || drag.sourceZone !== zone) return null;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 2,
          height: rowHeight,
          transform: `translateX(${drag.indicatorX - 1}px)`,
          background: DROP_LINE_COLOR,
          zIndex: 2,
        }}
      />
    </div>
  );
});

// Shell-owned row-selection gutter, pinned at the far left. Subscribes to the store for the
// selected-row set (a click re-renders only this leaf, never the body). Re-renders on scroll too
// (its windowed rows change), but that's ~30 checkboxes — negligible next to the body.
function RowGutter(props: {
  store: GridStore;
  vRows: VirtualItem[];
  rowIdAt: (index: number) => RowId;
  rowCount: number;
  bodyHeight: number;
  rowHeight: number;
  getAllRowIds: () => RowId[];
  strongDivider: boolean;
}) {
  const {
    store,
    vRows,
    rowIdAt,
    rowCount,
    bodyHeight,
    rowHeight,
    getAllRowIds,
    strongDivider,
  } = props;
  const selection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const selectedCount = selection.selectedRows.size;
  const allChecked = rowCount > 0 && selectedCount >= rowCount;
  const someChecked = selectedCount > 0 && !allChecked;

  const cellStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: GUTTER_WIDTH,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRight: "1px solid #e7e5e4",
    borderBottom: "1px solid #f0efee",
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        flex: `0 0 ${GUTTER_WIDTH}px`,
        position: "sticky",
        left: 0,
        zIndex: 3,
        ...(strongDivider ? FREEZE_DIVIDER_LEFT : null),
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          height: rowHeight,
          background: HEADER_BG,
          borderBottom: HEADER_BORDER,
          borderRight: "1px solid #e7e5e4",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <input
          type="checkbox"
          aria-label="Select all rows"
          checked={allChecked}
          ref={(el) => {
            if (el) el.indeterminate = someChecked;
          }}
          onChange={() =>
            store.setRowsSelected(getAllRowIds(), !(allChecked || someChecked))
          }
        />
      </div>
      <div
        style={{
          position: "relative",
          height: bodyHeight,
          background: FROZEN_BG,
        }}
      >
        {vRows.map((vr) => {
          const rowId = rowIdAt(vr.index);
          return (
            <div
              key={vr.key}
              style={{
                ...cellStyle,
                height: vr.size,
                transform: `translateY(${vr.start}px)`,
              }}
            >
              <input
                type="checkbox"
                aria-label={`Select row ${vr.index + 1}`}
                checked={selection.selectedRows.has(rowId)}
                onChange={() => store.toggleRow(rowId)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ZoneLayout {
  widths: number[];
  /** Cumulative start offset of each column within the zone. */
  offsets: number[];
  total: number;
}

function zoneLayout<T>(cols: Column<T>[]): ZoneLayout {
  const widths = cols.map((c) => c.width ?? DEFAULT_COL_WIDTH);
  const offsets = new Array<number>(widths.length);
  let acc = 0;
  for (let i = 0; i < widths.length; i++) {
    offsets[i] = acc;
    acc += widths[i];
  }
  return { widths, offsets, total: acc };
}

/** Index of the column whose slot contains local x (clamps to the last column past the end). */
function colIndexAtX(offsets: number[], x: number): number {
  if (offsets.length === 0) return -1;
  let lo = 0;
  let hi = offsets.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= x) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

const clampNum = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

const ARROW_DIR: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function DataGrid<T>(props: DataGridProps<T>) {
  const {
    rows,
    columns,
    getRowId,
    rowHeight = DEFAULT_ROW_HEIGHT,
    overscanRows = 6,
    overscanCols = 2,
    enableRowSelection = false,
    onSelectionChange,
    columnOrder: columnOrderProp,
    onColumnOrderChange,
    onCellCommit,
    editorClassName,
    editorStyle,
    statsRef,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [store] = useState(() => createGridStore());
  const [editStore] = useState(() => createEditStore());
  const [pendingStore] = useState(() => createPendingStore());
  const [dragStore] = useState(() => createDragStore());

  const gutterW = enableRowSelection ? GUTTER_WIDTH : 0;
  // Drag-reorder is enabled only when the consumer can persist the result (it's controlled, R3): no
  // handler ⇒ no drag, no grab cursor. Gates both the interaction and the header affordance.
  const reorderable = !!onColumnOrderChange;

  // Apply the controlled `columnOrder` (R3) before zoning: a stable sort by the id's position in
  // the prop (unknown ids keep their original relative order, sorted to the end). `frozen` still
  // drives zone assignment below, so this only orders columns WITHIN each zone — a malformed
  // cross-zone order can't take effect (D5).
  const ordered = useMemo(() => {
    if (!columnOrderProp) return columns;
    const pos = new Map(columnOrderProp.map((id, i) => [id, i]));
    const n = columnOrderProp.length;
    // Finite sort key: listed ids by their position; unlisted ids keep their original relative
    // order, after the listed ones (key `n + originalIndex` — never NaN).
    return columns
      .map((c, i) => ({ c, key: pos.get(c.id) ?? n + i }))
      .sort((a, b) => a.key - b.key)
      .map((x) => x.c);
  }, [columns, columnOrderProp]);

  // Partition columns into the three zones, preserving relative order within each. Cross-zone
  // reorder is disallowed (D5), so grouping by `frozen` is the whole zoning model.
  const zones = useMemo(() => {
    const left: Column<T>[] = [];
    const center: Column<T>[] = [];
    const right: Column<T>[] = [];
    for (const c of ordered) {
      if (c.frozen === "left") left.push(c);
      else if (c.frozen === "right") right.push(c);
      else center.push(c);
    }
    return { left, center, right };
  }, [ordered]);

  const left = useMemo(() => zoneLayout(zones.left), [zones.left]);
  const center = useMemo(() => zoneLayout(zones.center), [zones.center]);
  const right = useMemo(() => zoneLayout(zones.right), [zones.right]);

  // Content x where the left frozen zone begins (after the gutter) and where the center begins
  // (after gutter + left zone). The column virtualizer's window must be offset by the latter.
  const leftBand = gutterW + left.total;
  const centerScrollMargin = leftBand;
  const totalWidth = leftBand + center.total + right.total;

  // Placement of every column in its zone-local coords + the visual column order, both for the
  // overlay geometry and for keyboard stepping / scroll-into-view. `localIndex` is the per-zone
  // index (the center virtualizer's index for center columns).
  type CellPlacement = ColumnPlacement & { localIndex: number };
  const { placementMap, columnOrder } = useMemo(() => {
    const map = new Map<ColumnId, CellPlacement>();
    const order: ColumnId[] = [];
    let visualIndex = 0;
    const add = (cols: Column<T>[], layout: ZoneLayout, zone: Zone) => {
      cols.forEach((c, i) => {
        map.set(c.id, {
          zone,
          offset: layout.offsets[i],
          width: layout.widths[i],
          visualIndex,
          localIndex: i,
          selectable: c.type !== "action",
        });
        order.push(c.id);
        visualIndex++;
      });
    };
    add(zones.left, left, "left");
    add(zones.center, center, "center");
    add(zones.right, right, "right");
    return { placementMap: map, columnOrder: order };
  }, [zones, left, center, right]);

  const geom: GridGeometry = useMemo(
    () => ({
      rowCount: rows.length,
      rowHeight,
      columnOrder,
      placement: (id) => placementMap.get(id),
    }),
    [rows.length, rowHeight, columnOrder, placementMap],
  );

  // False positive lint noise, not using RC
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: overscanRows,
  });

  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: zones.center.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => center.widths[i],
    overscan: overscanCols,
    scrollMargin: centerScrollMargin,
  });

  // TanStack Virtual caches item sizes; a *count* change is picked up automatically, but a change
  // to `estimateSize` (row height, or a column's width) is NOT — without resetting the cache the
  // body keeps rendering stale sizes while the header/overlay use the new ones. Re-measure when
  // the size inputs change.
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, rowHeight]);
  useEffect(() => {
    colVirtualizer.measure();
  }, [colVirtualizer, center.widths]);

  const vRows = rowVirtualizer.getVirtualItems();
  const vCols = colVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();

  if (statsRef) {
    statsRef.current = {
      rows: rows.length,
      cols: columns.length,
      // Center is windowed; the frozen zones are always fully rendered per visible row.
      renderedCells:
        vRows.length * (zones.left.length + vCols.length + zones.right.length),
    };
  }

  // Emit selection changes to the consumer without ever re-rendering this component (the body):
  // a plain store subscription, no setState.
  useEffect(() => {
    if (!onSelectionChange) return;
    return store.subscribe(() => onSelectionChange(store.getSnapshot()));
  }, [store, onSelectionChange]);

  // --- pointer + keyboard → store (D1: never touches the windowed body's render path) ---

  const draggingRef = useRef(false);
  const lastHitRef = useRef<CellCoord | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollRef = useRef<number | null>(null);
  // Separate RAF for the column drag's edge auto-scroll (P7) — horizontal, center-zone only.
  const dragScrollRef = useRef<number | null>(null);
  // Click-to-edit: a press on the ALREADY-focused cell opens its editor — but only on pointer-up
  // and only if the pointer didn't drag (so a drag-select starting on the focused cell still
  // selects a range, never edits). `pendingEditRef` holds that candidate cell; `movedRef` trips the
  // moment the drag crosses into another cell.
  const pendingEditRef = useRef<CellCoord | null>(null);
  const movedRef = useRef(false);
  // Column drag-reorder (P7). The header captured on pointerdown; the drag only starts (and the
  // drag store only flips to `dragging`) once the pointer crosses `DRAG_THRESHOLD`. `bounds` is the
  // insertion range the drag is confined to — it can't cross an `action` barrier column (D10).
  const dragSourceRef = useRef<{
    columnId: ColumnId;
    zone: Zone;
    sourceIndex: number;
    bounds: [number, number];
  } | null>(null);

  // Map a viewport point to a cell. Zone is chosen by screen band (the gutter + frozen zones are
  // pinned to the viewport edges); the header strip and the gutter return null (not selectable).
  // Row/column clamp to the grid edges so a drag past the edge still resolves to the last cell.
  const hitTest = (clientX: number, clientY: number): CellCoord | null => {
    const el = scrollRef.current;
    if (!el || columnOrder.length === 0) return null;
    const rect = el.getBoundingClientRect();

    const vpY = clientY - rect.top;
    if (vpY < rowHeight) return null; // over the sticky header
    const rowIndex = clampNum(
      Math.floor((vpY - rowHeight + el.scrollTop) / rowHeight),
      0,
      rows.length - 1,
    );

    const localX = clientX - rect.left;
    const viewportW = el.clientWidth;
    if (gutterW > 0 && localX < gutterW) return null; // over the checkbox gutter

    let cols: Column<T>[];
    let offsets: number[];
    let zoneX: number;
    if (left.total > 0 && localX < leftBand) {
      cols = zones.left;
      offsets = left.offsets;
      zoneX = localX - gutterW;
    } else if (right.total > 0 && localX >= viewportW - right.total) {
      cols = zones.right;
      offsets = right.offsets;
      zoneX = localX - (viewportW - right.total);
    } else {
      cols = zones.center;
      offsets = center.offsets;
      zoneX = localX - leftBand + el.scrollLeft;
    }
    if (cols.length === 0) return null;
    const i = colIndexAtX(offsets, zoneX);
    if (i < 0) return null;
    const col = cols[i];
    // Action columns are non-selectable — a click there isn't a cell hit (no focus/drag/auto-scroll),
    // so interactive content inside handles its own clicks with no extra wiring.
    if (!col || col.type === "action") return null;
    return { rowIndex, columnId: col.id };
  };

  // Map a viewport point in the HEADER strip to the header it's over (P7). Mirrors `hitTest`'s
  // zone-band detection (for `vpY < rowHeight`, the header strip) AND its `type: 'action'`
  // exclusion: an action column is a pure UI affordance (D10), so the grid skips it for every
  // interaction — drag-reorder included (grabbing a button column to sort it is meaningless).
  const headerHitTest = (
    clientX: number,
    clientY: number,
  ): { columnId: ColumnId; zone: Zone; sourceIndex: number } | null => {
    const el = scrollRef.current;
    if (!el || columnOrder.length === 0) return null;
    const rect = el.getBoundingClientRect();

    const vpY = clientY - rect.top;
    if (vpY < 0 || vpY >= rowHeight) return null; // only the header strip

    const localX = clientX - rect.left;
    const viewportW = el.clientWidth;
    if (gutterW > 0 && localX < gutterW) return null; // over the checkbox gutter

    let cols: Column<T>[];
    let offsets: number[];
    let zoneX: number;
    let zone: Zone;
    if (left.total > 0 && localX < leftBand) {
      cols = zones.left;
      offsets = left.offsets;
      zoneX = localX - gutterW;
      zone = "left";
    } else if (right.total > 0 && localX >= viewportW - right.total) {
      cols = zones.right;
      offsets = right.offsets;
      zoneX = localX - (viewportW - right.total);
      zone = "right";
    } else {
      cols = zones.center;
      offsets = center.offsets;
      zoneX = localX - leftBand + el.scrollLeft;
      zone = "center";
    }
    if (cols.length === 0) return null;
    const i = colIndexAtX(offsets, zoneX);
    const col = cols[i];
    if (!col || col.type === "action") return null;
    return { columnId: col.id, zone, sourceIndex: i };
  };

  // The ZoneLayout for a zone (offsets/widths/total) — drives the drop-index geometry.
  const layoutFor = (zone: Zone) =>
    zone === "left" ? left : zone === "right" ? right : center;

  // The zone's columns (for barrier detection during a drag).
  const zoneColsFor = (zone: Zone) =>
    zone === "left" ? zones.left : zone === "right" ? zones.right : zones.center;

  // A clientX → zone-local x for `zone`, clamped to the zone so a pointer that wanders into another
  // band pins to the source zone's nearest edge (this is what keeps reorder WITHIN-zone, D5).
  const zoneLocalXFor = (zone: Zone, clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const localX = clientX - el.getBoundingClientRect().left;
    const layout = layoutFor(zone);
    if (zone === "left") return clampNum(localX - gutterW, 0, layout.total);
    if (zone === "right")
      return clampNum(
        localX - (el.clientWidth - right.total),
        0,
        layout.total,
      );
    return clampNum(localX - leftBand + el.scrollLeft, 0, layout.total);
  };

  // Scroll a cell fully into view, accounting for the pinned chrome the virtualizer can't see:
  // the sticky header (top `rowHeight`) and the gutter + frozen bands (left/right). Setting
  // scrollTop/scrollLeft drives the virtualizer, which re-renders the windowed body.
  const scrollCellIntoView = (cell: CellCoord) => {
    const el = scrollRef.current;
    if (!el) return;

    const rowTop = rowHeight + cell.rowIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < el.scrollTop + rowHeight) el.scrollTop = rowTop - rowHeight;
    else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowBottom - el.clientHeight;
    }

    const p = placementMap.get(cell.columnId);
    if (p && p.zone === "center") {
      const colLeft = leftBand + p.offset;
      const colRight = colLeft + p.width;
      if (colLeft < el.scrollLeft + leftBand)
        el.scrollLeft = colLeft - leftBand;
      else if (colRight > el.scrollLeft + el.clientWidth - right.total) {
        el.scrollLeft = colRight - el.clientWidth + right.total;
      }
    }
  };

  // --- editing (D4/R4/R5): triggers + commit orchestration → the edit store (→ EditorPortal) ---
  // DataGrid never SUBSCRIBES to the edit store; it only calls mutators. Only EditorPortal reads
  // it, so opening an editor / typing a draft / submit+error never re-render the windowed body.

  const returnFocus = () => scrollRef.current?.focus();
  const findColumn = (id: ColumnId) => columns.find((c) => c.id === id);

  const isEditable = (cell: CellCoord): boolean => {
    const col = findColumn(cell.columnId);
    if (!col || col.type === "action" || !col.editable) return false;
    if (col.editable === true) return true;
    const row = rows[cell.rowIndex];
    return col.editable({
      row,
      rowId: getRowId(row, cell.rowIndex),
      rowIndex: cell.rowIndex,
      column: col,
      value: col.accessor(row),
    });
  };

  // Open the editor on a cell. `initialDraft` overrides the current value (type-to-replace).
  // A cell mid-commit is "disabled" — refuse until its pending overlay resolves.
  const beginEdit = (cell: CellCoord, initialDraft?: unknown): boolean => {
    const col = findColumn(cell.columnId);
    const row = rows[cell.rowIndex];
    if (!col || row == null || !isEditable(cell) || pendingStore.has(cell)) return false;
    store.focusCell(cell);
    scrollCellIntoView(cell);
    editStore.begin(
      cell,
      initialDraft !== undefined ? initialDraft : col.accessor(row),
    );
    return true;
  };

  const cancelEdit = () => {
    editStore.cancel(); // abandon — no commit
    returnFocus();
  };

  // Commit the active edit OPTIMISTICALLY (D10): close the editor immediately, show the new value
  // with a spinner via the pending overlay, and run the consumer's handler in the background.
  // Parent stays authoritative (R4) — we never mutate `rows`. On success the persisted value flows
  // back through `accessor` and the overlay clears; on failure the cell reverts to its old value
  // and flashes red (the draft is discarded). The editor never lingers in a "submitting" state.
  const startCommit = () => {
    const snap = editStore.getSnapshot();
    if (snap.status === "idle") return;
    const { cell, draft } = snap;
    editStore.succeed(); // close the editor NOW (hand off to the pending overlay)

    const col = findColumn(cell.columnId);
    const row = rows[cell.rowIndex];
    if (!col || row == null) return;

    const rowId = getRowId(row, cell.rowIndex);
    const previousValue = col.accessor(row);
    const editCtx: CellEditContext<T> = {
      row,
      rowId,
      rowIndex: cell.rowIndex,
      column: col,
      value: previousValue,
      draft,
      setDraft: editStore.setDraft,
      commit: () => {},
      cancel: () => {},
      status: "editing",
      width: col.width ?? DEFAULT_COL_WIDTH,
      height: rowHeight,
    };
    const nextValue = col.parseValue ? col.parseValue(draft, editCtx) : draft;
    if (Object.is(nextValue, previousValue)) return; // nothing changed — no commit

    const handler = col.onCommit ?? onCellCommit;
    if (!handler) return; // nowhere to persist

    pendingStore.setPending(cell, nextValue); // optimistic
    Promise.resolve(handler({ rowId, row, columnId: col.id, previousValue, nextValue }))
      .then(() => pendingStore.clear(cell)) // persisted → value flows back, overlay clears
      .catch(() => {
        pendingStore.setError(cell); // revert + flash; the draft is discarded
        window.setTimeout(() => pendingStore.clear(cell), ERROR_FLASH_MS);
      });
  };

  const commitCell = () => {
    startCommit();
    returnFocus();
  };

  // Commit (optimistically), then advance the focused cell — Enter→down, Tab→right. We do NOT wait
  // for the async: the user moves on immediately; a later failure reverts + flashes that cell.
  const commitAndMove = (dir: Direction) => {
    const snap = editStore.getSnapshot();
    const fromCell = snap.status === "idle" ? null : snap.cell;
    startCommit();
    returnFocus();
    if (fromCell) {
      const next = stepCoord(fromCell, dir, geom);
      store.focusCell(next);
      scrollCellIntoView(next);
    }
  };

  const extendDrag = (cell: CellCoord | null) => {
    if (!cell) return;
    const last = lastHitRef.current;
    if (
      last &&
      last.rowIndex === cell.rowIndex &&
      last.columnId === cell.columnId
    ) {
      return; // same cell — skip the redundant store update
    }
    lastHitRef.current = cell;
    movedRef.current = true; // crossed into another cell → this is a drag-select, not a click
    store.extendTo(cell);
  };

  // While dragging near a viewport edge, ramp the scroll and keep extending the range. The center
  // edges are inset by the gutter/frozen bands so auto-scroll triggers at the scrolling region's
  // edge, not under the pinned columns.
  //
  // Gated on `movedRef` (a drag has actually crossed a cell): the pinned frozen zones SIT in the
  // edge bands, so a plain click on a frozen cell is "past the edge" and would otherwise scroll the
  // table every frame until pointer-up. Auto-scroll is a drag feature — a stationary click must not
  // trigger it. (By the time a real drag reaches an edge it has already crossed cells, so this never
  // blocks legitimate drag-auto-scroll.)
  const autoScrollTick = () => {
    if (!draggingRef.current) {
      autoScrollRef.current = null;
      return;
    }
    const el = scrollRef.current;
    const pt = pointerRef.current;
    if (el && pt && movedRef.current) {
      const rect = el.getBoundingClientRect();
      const topLimit = rect.top + rowHeight;
      const leftLimit = rect.left + leftBand;
      const rightLimit = rect.left + el.clientWidth - right.total;
      let dx = 0;
      let dy = 0;
      if (pt.y < topLimit + EDGE_ZONE) dy = -EDGE_SPEED;
      else if (pt.y > rect.bottom - EDGE_ZONE) dy = EDGE_SPEED;
      if (pt.x < leftLimit + EDGE_ZONE) dx = -EDGE_SPEED;
      else if (pt.x > rightLimit - EDGE_ZONE) dx = EDGE_SPEED;
      if (dy) el.scrollTop += dy;
      if (dx) el.scrollLeft += dx;
      if (dx || dy) extendDrag(hitTest(pt.x, pt.y));
    }
    autoScrollRef.current = requestAnimationFrame(autoScrollTick);
  };

  // Edge auto-scroll for a CENTER column drag (P7): while the pointer is held near the center band's
  // left/right edge, ramp `scrollLeft` so off-screen columns flow in and become reachable in one
  // gesture. Horizontal only; frozen zones never scroll (all their columns are rendered, D5). Each
  // frame that scrolls also re-derives the drop target — the same pointer maps to a new column once
  // `scrollLeft` moves — so the indicator tracks the columns flowing in. The drop stays clamped to
  // the source's barrier `bounds`, so auto-scroll can't push a column past an `action` column.
  const dragScrollTick = () => {
    const src = dragSourceRef.current;
    const el = scrollRef.current;
    const pt = pointerRef.current;
    if (
      !src ||
      src.zone !== "center" ||
      !el ||
      !pt ||
      dragStore.getSnapshot().status !== "dragging"
    ) {
      dragScrollRef.current = null;
      return;
    }
    const rect = el.getBoundingClientRect();
    const leftLimit = rect.left + leftBand;
    const rightLimit = rect.left + el.clientWidth - right.total;
    let dx = 0;
    if (pt.x < leftLimit + EDGE_ZONE) dx = -EDGE_SPEED;
    else if (pt.x > rightLimit - EDGE_ZONE) dx = EDGE_SPEED;
    if (dx) {
      el.scrollLeft += dx;
      const layout = layoutFor("center");
      const zoneX = zoneLocalXFor("center", pt.x);
      const { index, indicatorX } = dropIndexAtX(
        layout.offsets,
        layout.widths,
        zoneX,
        src.bounds,
      );
      dragStore.updateTarget(index, indicatorX);
    }
    dragScrollRef.current = requestAnimationFrame(dragScrollTick);
  };

  useEffect(
    () => () => {
      if (autoScrollRef.current != null)
        cancelAnimationFrame(autoScrollRef.current);
      if (dragScrollRef.current != null)
        cancelAnimationFrame(dragScrollRef.current);
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Header press → a column drag candidate (P7). Capture the source and the origin, but don't
    // start the drag store yet — wait for the pointer to cross DRAG_THRESHOLD so a plain header
    // click isn't swallowed. Returns before the cell path, so a header drag never touches selection.
    const header = reorderable ? headerHitTest(e.clientX, e.clientY) : null;
    if (header) {
      // Confine the drag so it can't be pushed past an `action` barrier column (D10). Constant for
      // the gesture (source + zone are fixed), so compute it once here.
      const isBarrier = zoneColsFor(header.zone).map((c) => c.type === "action");
      const bounds = dragBounds(isBarrier, header.sourceIndex);
      dragSourceRef.current = { ...header, bounds };
      pointerRef.current = { x: e.clientX, y: e.clientY };
      // While the pointer is captured the cursor follows the CAPTURE TARGET (this container), not the
      // header under it — so the header's `grab` would vanish. Force `grabbing` on the container for
      // the gesture; reset on pointerup. One write covers the whole drag (capture redirects it).
      if (scrollRef.current) scrollRef.current.style.cursor = "grabbing";
      scrollRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    const cell = hitTest(e.clientX, e.clientY);
    if (!cell) return; // header / gutter / outside — let native handlers (e.g. checkboxes) run
    scrollRef.current?.focus();
    // Was this exact cell already the (single) focus before this press? If so, a plain click on it
    // should open the editor (resolved on pointer-up, if the pointer didn't drag).
    const prev = store.getSnapshot();
    const alreadyFocused =
      !e.shiftKey &&
      prev.range == null &&
      prev.focusedCell != null &&
      prev.focusedCell.rowIndex === cell.rowIndex &&
      prev.focusedCell.columnId === cell.columnId;
    pendingEditRef.current = alreadyFocused ? cell : null;
    movedRef.current = false;
    if (e.shiftKey) store.extendTo(cell);
    else store.focusCell(cell);
    draggingRef.current = true;
    lastHitRef.current = cell;
    pointerRef.current = { x: e.clientX, y: e.clientY };
    scrollRef.current?.setPointerCapture(e.pointerId);
    if (autoScrollRef.current == null) {
      autoScrollRef.current = requestAnimationFrame(autoScrollTick);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Header drag (P7): below threshold (and not yet dragging) we wait; once moved we start, then
    // track the drop target. Clamped zone-local x keeps the indicator inside the source zone (D5).
    const src = dragSourceRef.current;
    if (src) {
      const origin = pointerRef.current?.x ?? e.clientX;
      const dragging = dragStore.getSnapshot().status === "dragging";
      if (!dragging && Math.abs(e.clientX - origin) < DRAG_THRESHOLD) return;
      // Past the threshold: track the LIVE pointer so the auto-scroll tick reads the current edge.
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const layout = layoutFor(src.zone);
      const zoneX = zoneLocalXFor(src.zone, e.clientX);
      const { index, indicatorX } = dropIndexAtX(
        layout.offsets,
        layout.widths,
        zoneX,
        src.bounds,
      );
      if (dragging) dragStore.updateTarget(index, indicatorX);
      else {
        dragStore.start({
          sourceColumnId: src.columnId,
          sourceZone: src.zone,
          sourceIndex: src.sourceIndex,
          targetIndex: index,
          indicatorX,
        });
        // A center drag can reach off-screen columns — start the edge auto-scroll (D5: frozen
        // zones are fully rendered, so they never need it).
        if (src.zone === "center" && dragScrollRef.current == null) {
          dragScrollRef.current = requestAnimationFrame(dragScrollTick);
        }
      }
      return;
    }
    if (!draggingRef.current) return;
    pointerRef.current = { x: e.clientX, y: e.clientY };
    extendDrag(hitTest(e.clientX, e.clientY));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Header drag (P7): on drop, emit the new order (within-zone). A press that never crossed the
    // threshold leaves the store idle — treat it as a plain header click (no reorder).
    const src = dragSourceRef.current;
    if (src) {
      dragSourceRef.current = null;
      if (dragScrollRef.current != null) {
        cancelAnimationFrame(dragScrollRef.current);
        dragScrollRef.current = null;
      }
      scrollRef.current?.releasePointerCapture(e.pointerId);
      if (scrollRef.current) scrollRef.current.style.cursor = ""; // restore hover grab
      const snap = dragStore.getSnapshot();
      if (snap.status === "dragging") {
        const next = reorderWithinZone(
          columnOrder,
          snap.sourceColumnId,
          snap.targetIndex,
          (id) => placementMap.get(id)?.zone,
        );
        dragStore.end();
        if (next !== columnOrder) onColumnOrderChange?.(next); // same ref ⇒ drop onto self ⇒ no-op
      }
      return;
    }
    draggingRef.current = false;
    if (autoScrollRef.current != null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
    scrollRef.current?.releasePointerCapture(e.pointerId);
    // A click (no drag) on the already-focused cell enters edit mode.
    const editCell = pendingEditRef.current;
    pendingEditRef.current = null;
    if (editCell && !movedRef.current) beginEdit(editCell);
  };

  // Safety net for the column drag (P7): if pointer capture is lost WITHOUT a pointerup — e.g. a
  // pointercancel, or the OS stealing the pointer — make sure the imperative `grabbing` cursor and
  // the drag state don't get stuck. Idempotent on the normal release path (state already cleared),
  // and harmless to the cell drag (it sets no cursor and no `dragSourceRef`).
  const onLostPointerCapture = () => {
    if (scrollRef.current) scrollRef.current.style.cursor = "";
    if (dragScrollRef.current != null) {
      cancelAnimationFrame(dragScrollRef.current);
      dragScrollRef.current = null;
    }
    if (dragSourceRef.current) {
      dragSourceRef.current = null;
      dragStore.end();
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // While an editor is open it owns the keyboard (it's focused inside the body portal, so its
    // keydowns don't even reach here — this is a belt-and-braces guard).
    if (editStore.getSnapshot().status !== "idle") return;

    if (e.key === "Escape") {
      store.clearRange();
      return;
    }

    const focused = store.getSnapshot().focusedCell;
    if (focused) {
      // Enter / F2 open the editor; a printable key opens it and replaces the value.
      if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        beginEdit(focused);
        return;
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        beginEdit(focused, e.key);
        return;
      }
    }

    const dir = ARROW_DIR[e.key];
    if (!dir || columnOrder.length === 0) return;
    e.preventDefault();

    if (!focused) {
      // First arrow just lands focus on the origin cell — the first SELECTABLE column.
      const firstSelectable =
        columnOrder.find((id) => placementMap.get(id)?.selectable !== false) ??
        columnOrder[0];
      const origin: CellCoord = { rowIndex: 0, columnId: firstSelectable };
      store.focusCell(origin);
      scrollCellIntoView(origin);
      return;
    }
    const next = stepCoord(focused, dir, geom, e.metaKey || e.ctrlKey);
    if (e.shiftKey) store.extendTo(next);
    else store.focusCell(next);
    scrollCellIntoView(next);
  };

  const rowIdAt = (index: number) => getRowId(rows[index], index);
  const getAllRowIds = () => rows.map((row, i) => getRowId(row, i));

  // Renders a frozen zone: a `sticky; left|right: 0` flex item (z 2 — above the scrolling
  // center) containing its own `sticky; top: 0` header row (the corner) over an opaque body
  // band, plus the zone's selection overlay. Always-rendered columns × the windowed rows. The
  // left zone sticks at `leftBand`'s gutter offset so it sits just right of the checkbox gutter.
  const renderFrozen = (
    side: FrozenZone,
    cols: Column<T>[],
    layout: ZoneLayout,
  ) => {
    if (cols.length === 0) return null;
    const stick: CSSProperties =
      side === "left"
        ? { left: gutterW, ...FREEZE_DIVIDER_LEFT }
        : { right: 0, ...FREEZE_DIVIDER_RIGHT };
    return (
      <div
        style={{
          flex: `0 0 ${layout.total}px`,
          position: "sticky",
          zIndex: 2,
          ...stick,
        }}
      >
        {/* corner: sticky on both axes (this zone is sticky-left/right, the row is sticky-top) */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            height: rowHeight,
            background: HEADER_BG,
            borderBottom: HEADER_BORDER,
          }}
        >
          {cols.map((col, i) => (
            <HeaderCell
              key={col.id}
              name={col.name}
              x={layout.offsets[i]}
              width={layout.widths[i]}
              height={rowHeight}
              frozen={side}
              draggable={reorderable && col.type !== "action"}
            />
          ))}
          <DragOverlay zone={side} dragStore={dragStore} rowHeight={rowHeight} />
        </div>
        <div
          style={{
            position: "relative",
            height: totalHeight,
            background: FROZEN_BG,
          }}
        >
          {vRows.map((vr) => {
            const row = rows[vr.index];
            const rowId = getRowId(row, vr.index);
            return cols.map((col, i) => (
              <Cell
                key={cellKey(rowId, col.id)}
                content={readContent(col, row, vr.index, rowId)}
                x={layout.offsets[i]}
                y={vr.start}
                width={layout.widths[i]}
                height={vr.size}
                frozen={side}
              />
            ));
          })}
          <SelectionOverlay zone={side} store={store} editStore={editStore} geom={geom} />
          <PendingOverlay zone={side} pendingStore={pendingStore} geom={geom} />
        </div>
      </div>
    );
  };

  // Single native scroll container. Inside it a flex row holds the gutter + three zones: the
  // gutter and left/right zones are `position: sticky` so they ride the same compositor-driven
  // scroll as the body (horizontal freeze with zero JS sync, mirroring the sticky header's
  // vertical freeze). Flex places the right zone at the content's right edge, which is exactly
  // where `sticky; right: 0` needs it. Each zone's header is a `sticky; top: 0` row, so the
  // frozen corners pin on both axes.
  return (
    <>
      <div
        ref={scrollRef}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onLostPointerCapture={onLostPointerCapture}
        onKeyDown={onKeyDown}
        style={{
          height: "100%",
          overflow: "auto",
          position: "relative",
          outline: "none",
          userSelect: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            width: totalWidth,
            height: rowHeight + totalHeight,
            position: "relative",
          }}
        >
          {enableRowSelection && (
            <RowGutter
              store={store}
              vRows={vRows}
              rowIdAt={rowIdAt}
              rowCount={rows.length}
              bodyHeight={totalHeight}
              rowHeight={rowHeight}
              getAllRowIds={getAllRowIds}
              strongDivider={left.total === 0}
            />
          )}

          {renderFrozen("left", zones.left, left)}

          {/* center zone — the only horizontally windowed zone */}
          <div style={{ flex: `0 0 ${center.total}px`, position: "relative" }}>
            {/* sticky header — same scroll as the body, so it never trails */}
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 1,
                height: rowHeight,
                background: HEADER_BG,
                borderBottom: HEADER_BORDER,
              }}
            >
              {vCols.map((vc) => {
                const col = zones.center[vc.index];
                return (
                  <HeaderCell
                    key={col.id}
                    name={col.name}
                    x={vc.start - centerScrollMargin}
                    width={vc.size}
                    height={rowHeight}
                    draggable={reorderable && col.type !== "action"}
                  />
                );
              })}
              <DragOverlay
                zone="center"
                dragStore={dragStore}
                rowHeight={rowHeight}
              />
            </div>

            {/* body */}
            <div style={{ position: "relative", height: totalHeight }}>
              {vRows.map((vr) => {
                const row = rows[vr.index];
                const rowId = getRowId(row, vr.index);
                return vCols.map((vc) => {
                  const col = zones.center[vc.index];
                  return (
                    <Cell
                      key={cellKey(rowId, col.id)}
                      content={readContent(col, row, vr.index, rowId)}
                      x={vc.start - centerScrollMargin}
                      y={vr.start}
                      width={vc.size}
                      height={vr.size}
                    />
                  );
                });
              })}
              <SelectionOverlay zone="center" store={store} editStore={editStore} geom={geom} />
              <PendingOverlay zone="center" pendingStore={pendingStore} geom={geom} />
            </div>
          </div>

          {renderFrozen("right", zones.right, right)}
        </div>
      </div>

      {/* The edit overlay — a body portal, so it escapes the scroll clip (R5/R7). Only this leaf
          subscribes to the edit store; the windowed body above never re-renders on edit. */}
      <EditorPortal
        editStore={editStore}
        scrollRef={scrollRef}
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        geom={geom}
        gutterW={gutterW}
        leftBand={leftBand}
        rightTotal={right.total}
        rowHeight={rowHeight}
        setDraft={editStore.setDraft}
        commit={commitCell}
        cancel={cancelEdit}
        commitAndMove={commitAndMove}
        editorClassName={editorClassName}
        editorStyle={editorStyle}
      />
    </>
  );
}
