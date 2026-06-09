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
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualItem } from "@tanstack/react-virtual";
import type {
  CellCoord,
  Column,
  ColumnId,
  FrozenZone,
  GridSelection,
  RowId,
} from "./core/types";
import { cellKey } from "./core/types";
import { createGridStore } from "./core/store/grid-store";
import type { GridStore } from "./core/store/grid-store";
import {
  cellToZoneRect,
  rangeToZoneRects,
  stepCoord,
} from "./core/selection/geometry";
import type {
  ColumnPlacement,
  Direction,
  GridGeometry,
  Zone,
} from "./core/selection/geometry";

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
const FREEZE_DIVIDER_LEFT: CSSProperties = { boxShadow: `1px 0 0 0 ${FREEZE_DIVIDER_COLOR}` };
const FREEZE_DIVIDER_RIGHT: CSSProperties = { boxShadow: `-1px 0 0 0 ${FREEZE_DIVIDER_COLOR}` };
// Frozen body cells must be opaque so the scrolling center band doesn't show through them as it
// slides underneath (z-ordering puts frozen zones above center). Read-mode only; transparency
// for AntD edit cells is a P6 concern.
const FROZEN_BG = "#ffffff";

// Overlay cosmetics (D6). The dumb shell hard-codes light styling; the D7 theming surface is P9.
const SELECT_FILL = "rgba(37, 99, 235, 0.12)";
const SELECT_BORDER = "1px solid rgba(37, 99, 235, 0.55)";
const FOCUS_BORDER = "2px solid #2563eb";

// Auto-scroll while drag-selecting near a viewport edge.
const EDGE_ZONE = 48;
const EDGE_SPEED = 22;

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

const Cell = memo(function Cell(props: {
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
  frozen?: FrozenZone;
}) {
  const { value, x, y, width, height, frozen } = props;
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
      {value}
    </div>
  );
});

const HeaderCell = memo(function HeaderCell(props: {
  name: string;
  x: number;
  width: number;
  height: number;
  frozen?: FrozenZone;
}) {
  const { name, x, width, height, frozen } = props;
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
  geom: GridGeometry;
}) {
  const { zone, store, geom } = props;
  const selection = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const rangeRects = selection.range
    ? rangeToZoneRects(selection.range, geom).filter((r) => r.zone === zone)
    : [];
  const focusRect = selection.focusedCell
    ? cellToZoneRect(selection.focusedCell, geom)
    : null;
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
  const { store, vRows, rowIdAt, rowCount, bodyHeight, rowHeight, getAllRowIds, strongDivider } =
    props;
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
      <div style={{ position: "relative", height: bodyHeight, background: FROZEN_BG }}>
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

const clampNum = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

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
    statsRef,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [store] = useState(() => createGridStore());

  const gutterW = enableRowSelection ? GUTTER_WIDTH : 0;

  // Partition columns into the three zones, preserving relative order within each. Cross-zone
  // reorder is disallowed (D5), so grouping by `frozen` is the whole zoning model.
  const zones = useMemo(() => {
    const left: Column<T>[] = [];
    const center: Column<T>[] = [];
    const right: Column<T>[] = [];
    for (const c of columns) {
      if (c.frozen === "left") left.push(c);
      else if (c.frozen === "right") right.push(c);
      else center.push(c);
    }
    return { left, center, right };
  }, [columns]);

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
    return { rowIndex, columnId: cols[i].id };
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
      if (colLeft < el.scrollLeft + leftBand) el.scrollLeft = colLeft - leftBand;
      else if (colRight > el.scrollLeft + el.clientWidth - right.total) {
        el.scrollLeft = colRight - el.clientWidth + right.total;
      }
    }
  };

  const extendDrag = (cell: CellCoord | null) => {
    if (!cell) return;
    const last = lastHitRef.current;
    if (last && last.rowIndex === cell.rowIndex && last.columnId === cell.columnId) {
      return; // same cell — skip the redundant store update
    }
    lastHitRef.current = cell;
    store.extendTo(cell);
  };

  // While dragging near a viewport edge, ramp the scroll and keep extending the range. The center
  // edges are inset by the gutter/frozen bands so auto-scroll triggers at the scrolling region's
  // edge, not under the pinned columns.
  const autoScrollTick = () => {
    if (!draggingRef.current) {
      autoScrollRef.current = null;
      return;
    }
    const el = scrollRef.current;
    const pt = pointerRef.current;
    if (el && pt) {
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

  useEffect(
    () => () => {
      if (autoScrollRef.current != null) cancelAnimationFrame(autoScrollRef.current);
    },
    [],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const cell = hitTest(e.clientX, e.clientY);
    if (!cell) return; // header / gutter / outside — let native handlers (e.g. checkboxes) run
    scrollRef.current?.focus();
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
    if (!draggingRef.current) return;
    pointerRef.current = { x: e.clientX, y: e.clientY };
    extendDrag(hitTest(e.clientX, e.clientY));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (autoScrollRef.current != null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
    scrollRef.current?.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      store.clearRange();
      return;
    }
    const dir = ARROW_DIR[e.key];
    if (!dir || columnOrder.length === 0) return;
    e.preventDefault();

    const snap = store.getSnapshot();
    if (!snap.focusedCell) {
      // First arrow just lands focus on the origin cell.
      const origin: CellCoord = { rowIndex: 0, columnId: columnOrder[0] };
      store.focusCell(origin);
      scrollCellIntoView(origin);
      return;
    }
    const next = stepCoord(snap.focusedCell, dir, geom, e.metaKey || e.ctrlKey);
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
  const renderFrozen = (side: FrozenZone, cols: Column<T>[], layout: ZoneLayout) => {
    if (cols.length === 0) return null;
    const stick: CSSProperties =
      side === "left"
        ? { left: gutterW, ...FREEZE_DIVIDER_LEFT }
        : { right: 0, ...FREEZE_DIVIDER_RIGHT };
    return (
      <div style={{ flex: `0 0 ${layout.total}px`, position: "sticky", zIndex: 2, ...stick }}>
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
            />
          ))}
        </div>
        <div style={{ position: "relative", height: totalHeight, background: FROZEN_BG }}>
          {vRows.map((vr) => {
            const row = rows[vr.index];
            const rowId = getRowId(row, vr.index);
            return cols.map((col, i) => (
              <Cell
                key={cellKey(rowId, col.id)}
                value={String(col.accessor(row) ?? "")}
                x={layout.offsets[i]}
                y={vr.start}
                width={layout.widths[i]}
                height={vr.size}
                frozen={side}
              />
            ));
          })}
          <SelectionOverlay zone={side} store={store} geom={geom} />
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
    <div
      ref={scrollRef}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
                />
              );
            })}
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
                    value={String(col.accessor(row) ?? "")}
                    x={vc.start - centerScrollMargin}
                    y={vr.start}
                    width={vc.size}
                    height={vr.size}
                  />
                );
              });
            })}
            <SelectionOverlay zone="center" store={store} geom={geom} />
          </div>
        </div>

        {renderFrozen("right", zones.right, right)}
      </div>
    </div>
  );
}
