import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type {
  CellCommit,
  Column,
  ColumnId,
  FrozenZone,
  GridSelection,
  RowId,
} from "./core/types";
import { cellKey } from "./core/types";
import { createGridStore } from "./core/store/grid-store";
import { createEditStore } from "./core/store/edit-store";
import { createPendingStore } from "./core/store/pending-store";
import { createDragStore } from "./core/store/drag-store";
import { createResizeStore } from "./core/store/resize-store";
import { EditorPortal } from "./editors/EditorPortal";
import { PendingOverlay } from "./editors/PendingOverlay";
import {
  DEFAULT_ROW_HEIGHT,
  HEADER_BG,
  HEADER_BORDER,
  FROZEN_BG,
  DEFAULT_OVERSCAN_COLS,
  DEFAULT_OVERSCAN_ROWS,
} from "./internal/constants";
import { FREEZE_DIVIDER_LEFT, FREEZE_DIVIDER_RIGHT } from "./internal/style";
import type { ZoneLayout } from "./internal/layout";
import { readContent } from "./internal/read-content";
import { Cell } from "./components/Cell";
import { HeaderCell } from "./components/HeaderCell";
import { DragOverlay } from "./components/DragOverlay";
import { EmptyRowsLayer } from "./components/EmptyRowsLayer";
import { ResizeOverlay } from "./components/ResizeOverlay";
import { RowGutter } from "./components/RowGutter";
import { SelectionOverlay } from "./components/SelectionOverlay";
import { useGridLayout } from "./hooks/useGridLayout";
import { useGridGeometryHelpers } from "./hooks/useGridGeometryHelpers";
import { useCellEditing } from "./hooks/useCellEditing";
import { useGridKeyboard } from "./hooks/useGridKeyboard";
import { useColumnDrag } from "./hooks/useColumnDrag";
import { useColumnResize } from "./hooks/useColumnResize";
import { useDragSelect } from "./hooks/useDragSelect";

// The grid shell (DOM-rendered)
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
   * Column resize (D12) — **on by default**, UNCONTROLLED. `column.width` is the base/initial width;
   * the grid owns in-session resizes internally, so resize just works with zero wiring. Set `false`
   * to disable globally, or per-column `resizable: false`. (Controlled widths + reset are deferred.)
   */
  enableColumnResize?: boolean;
  /** Fires on each resize commit with the new clamped width — wire it to persist (D12). */
  onColumnResize?: (columnId: ColumnId, width: number) => void;
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

export function DataGrid<T>(props: DataGridProps<T>) {
  const {
    rows,
    columns,
    getRowId,
    rowHeight = DEFAULT_ROW_HEIGHT,
    overscanRows = DEFAULT_OVERSCAN_ROWS,
    overscanCols = DEFAULT_OVERSCAN_COLS,
    enableRowSelection = false,
    onSelectionChange,
    columnOrder: columnOrderProp,
    onColumnOrderChange,
    enableColumnResize = true,
    onColumnResize,
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
  const [resizeStore] = useState(() => createResizeStore());

  // Drag-reorder is enabled only when the consumer can persist the result (it's controlled, R3): no
  // handler ⇒ no drag, no grab cursor. Gates both the interaction and the header affordance.
  const reorderable = !!onColumnOrderChange;

  // Column resize (D12) — ON by default, UNCONTROLLED. `column.width` is the base/initial width; the
  // grid owns in-session resizes in `internalWidths` (layered over `column.width`), so resize just
  // works with zero wiring — one relayout per commit. `onColumnResize` fires for optional persistence
  // (save it, reseed `column.width` on next mount). Controlled widths + reset (a `columnWidths` prop)
  // are deferred — revisit when there's a concrete need.
  const resizeEnabled = enableColumnResize;
  const [internalWidths, setInternalWidths] = useState<
    Record<ColumnId, number>
  >({});
  const commitResize = (columnId: ColumnId, width: number) => {
    setInternalWidths((prev) => ({ ...prev, [columnId]: width }));
    onColumnResize?.(columnId, width);
  };

  // All pure layout/geometry derivation + the row/column virtualizers (D5/D8).
  const layout = useGridLayout({
    columns,
    columnOrder: columnOrderProp,
    widthOverrides: internalWidths,
    rows,
    rowHeight,
    overscanRows,
    overscanCols,
    enableRowSelection,
    scrollRef,
  });
  const {
    zones,
    left,
    center,
    right,
    gutterW,
    leftBand,
    centerScrollMargin,
    totalWidth,
    geom,
    vRows,
    vCols,
    totalHeight,
  } = layout;

  // Perf telemetry for the optional meter. Written in an effect (never during render — that would
  // violate the no-ref-writes-during-render rule); the meter polls on its own RAF, so the one-frame
  // lag is invisible. Runs after every render (vRows/vCols are fresh arrays) — cheap, no setState.
  useEffect(() => {
    if (!statsRef) return;
    statsRef.current = {
      rows: rows.length,
      cols: columns.length,
      // Center is windowed; the frozen zones are always fully rendered per visible row.
      renderedCells:
        vRows.length * (zones.left.length + vCols.length + zones.right.length),
    };
  });

  // Emit selection changes to the consumer without ever re-rendering this component (the body):
  // a plain store subscription, no setState.
  useEffect(() => {
    if (!onSelectionChange) return;
    return store.subscribe(() => onSelectionChange(store.getSnapshot()));
  }, [store, onSelectionChange]);

  // --- pointer + keyboard → stores (D1: never touches the windowed body's render path) ---

  // Live-DOM geometry readers (hit-testing, per-zone layout, scroll-into-view) shared by the
  // interaction hooks below.
  const helpers = useGridGeometryHelpers({
    scrollRef,
    layout,
    rows,
    rowHeight,
  });
  const { scrollCellIntoView } = helpers;

  // --- editing (D4/R4/R5): triggers + commit orchestration → the edit store (→ EditorPortal) ---
  // DataGrid never SUBSCRIBES to the edit store; it only calls mutators. Only EditorPortal reads
  // it, so opening an editor / typing a draft / submit+error never re-render the windowed body.

  const { beginEdit, cancelEdit, commitCell, commitAndMove } = useCellEditing({
    store,
    editStore,
    pendingStore,
    columns,
    rows,
    getRowId,
    rowHeight,
    geom,
    onCellCommit,
    scrollRef,
    scrollCellIntoView,
  });

  // Column drag-reorder (P7) and cell drag-select (D6) are mutually exclusive within a gesture, so
  // the shell composes them: header-drag gets first refusal on each pointer event (returns a
  // "consumed" flag), and only when it declines does drag-select run. Each gesture owns its own
  // refs internally — they never overlap.
  const colDrag = useColumnDrag({
    reorderable,
    dragStore,
    scrollRef,
    layout,
    helpers,
    onColumnOrderChange,
  });
  // Column resize (D12): a header-edge drag. Gets FIRST refusal in the pointer chain — its hot zone
  // is a thin strip at the boundary, a subset of the header, so it must claim the gesture before the
  // reorder grab (which owns the rest of the header) and the cell drag-select.
  const colResize = useColumnResize({
    enabled: resizeEnabled,
    resizeStore,
    scrollRef,
    helpers,
    onCommit: commitResize,
  });
  const dragSel = useDragSelect({
    store,
    scrollRef,
    layout,
    rowHeight,
    helpers,
    beginEdit,
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (colResize.onPointerDown(e)) return;
    if (colDrag.onPointerDown(e)) return;
    dragSel.onPointerDown(e);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (colResize.onPointerMove(e)) return;
    if (colDrag.onPointerMove(e)) return;
    dragSel.onPointerMove(e);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (colResize.onPointerUp(e)) return;
    if (colDrag.onPointerUp(e)) return;
    dragSel.onPointerUp(e);
  };
  const onLostPointerCapture = () => {
    colResize.onLostPointerCapture();
    colDrag.onLostPointerCapture();
  };

  const { onKeyDown } = useGridKeyboard({
    store,
    editStore,
    layout,
    beginEdit,
    scrollCellIntoView,
  });

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
              resizable={
                resizeEnabled &&
                col.type !== "action" &&
                col.resizable !== false
              }
            />
          ))}
          <DragOverlay
            zone={side}
            dragStore={dragStore}
            rowHeight={rowHeight}
          />
        </div>
        <div
          style={{
            position: "relative",
            height: totalHeight,
            background: FROZEN_BG,
          }}
        >
          <EmptyRowsLayer rowHeight={rowHeight} />
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
          <SelectionOverlay
            zone={side}
            store={store}
            editStore={editStore}
            geom={geom}
          />
          <PendingOverlay zone={side} pendingStore={pendingStore} geom={geom} />
        </div>
        <ResizeOverlay
          zone={side}
          resizeStore={resizeStore}
          height={rowHeight + totalHeight}
        />
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
                    resizable={
                      resizeEnabled &&
                      col.type !== "action" &&
                      col.resizable !== false
                    }
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
            <div
              style={{
                position: "relative",
                height: totalHeight,
                background: FROZEN_BG,
              }}
            >
              <EmptyRowsLayer rowHeight={rowHeight} />
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
              <SelectionOverlay
                zone="center"
                store={store}
                editStore={editStore}
                geom={geom}
              />
              <PendingOverlay
                zone="center"
                pendingStore={pendingStore}
                geom={geom}
              />
            </div>
            <ResizeOverlay
              zone="center"
              resizeStore={resizeStore}
              height={rowHeight + totalHeight}
            />
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
