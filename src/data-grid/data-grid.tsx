import { useEffect, useRef, useState } from "react";

import { GridZone } from "./components/GridZone";
import { RowGutter } from "./components/RowGutter";
import { createDragStore } from "./core/store/drag-store";
import { createEditStore } from "./core/store/edit-store";
import { createGridStore } from "./core/store/grid-store";
import { createPendingStore } from "./core/store/pending-store";
import { createResizeStore } from "./core/store/resize-store";
import { EditorPortal } from "./editors/EditorPortal";
import { useCellEditing } from "./hooks/useCellEditing";
import { useColumnDrag } from "./hooks/useColumnDrag";
import { useColumnResize } from "./hooks/useColumnResize";
import { useDragSelect } from "./hooks/useDragSelect";
import { useGridGeometryHelpers } from "./hooks/useGridGeometryHelpers";
import { useGridKeyboard } from "./hooks/useGridKeyboard";
import { useGridLayout } from "./hooks/useGridLayout";
import {
  DEFAULT_OVERSCAN_COLS,
  DEFAULT_OVERSCAN_ROWS,
  DEFAULT_ROW_HEIGHT,
} from "./internal/constants";
import { composePointerGestures } from "./internal/pointer-gestures";

import type { CSSProperties } from "react";
import type { PlacedCol } from "./components/GridZone";
import type {
  CellCommit,
  CellCommitFailure,
  Column,
  ColumnId,
  GridSelection,
  RowId,
} from "./core/types";

// DOM-rendered grid shell. Rows and center columns are virtualized; frozen zones use sticky
// positioning. Selection and interaction overlays subscribe to external stores so pointer moves
// do not re-render the windowed cells.

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
  /** Show the row-checkbox gutter pinned to the left edge. */
  enableRowSelection?: boolean;
  /** Called whenever the internal selection changes. */
  onSelectionChange?: (next: GridSelection) => void;
  /**
   * Controlled column order. Columns remain grouped by frozen zone, so this only changes order
   * within each zone.
   */
  columnOrder?: ColumnId[];
  /** Called with the full column order after a within-zone drag. Enables column dragging. */
  onColumnOrderChange?: (order: ColumnId[]) => void;
  /**
   * Enable column resizing. Defaults to `true`; individual columns can opt out with
   * `resizable: false`. The grid keeps resized widths for the current mount.
   */
  enableColumnResize?: boolean;
  /** Called after a resize with the clamped width. Use it to persist widths between mounts. */
  onColumnResize?: (columnId: ColumnId, width: number) => void;
  /**
   * Fallback commit handler for columns without `onCommit`. It receives the parsed value after
   * synchronous validation passes. The consumer remains responsible for updating `rows`.
   */
  onCellCommit?: (update: CellCommit<T>) => Promise<void> | void;
  /**
   * Called after an asynchronous cell commit rejects. The grid still performs its default rollback
   * and temporary red flash; use this hook for application-level notifications or logging.
   */
  onCellCommitError?: (failure: CellCommitFailure<T>) => void;
  /**
   * Style the floating editor host. It exposes `data-editing` and `data-invalid` state attributes.
   */
  editorClassName?: string;
  editorStyle?: CSSProperties;
  /** Written during render so the perf meter can read counts without scroll-frequency setState. */
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
    onCellCommitError,
    editorClassName,
    editorStyle,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [store] = useState(() => createGridStore());
  const [editStore] = useState(() => createEditStore());
  const [pendingStore] = useState(() => createPendingStore());
  const [dragStore] = useState(() => createDragStore());
  const [resizeStore] = useState(() => createResizeStore());

  // Reordering is controlled, so the callback also enables the drag gesture and affordance.
  const reorderable = !!onColumnOrderChange;

  // In-session width overrides are applied over each column's initial width.
  const resizeEnabled = enableColumnResize;
  const [internalWidths, setInternalWidths] = useState<
    Record<ColumnId, number>
  >({});
  const commitResize = (columnId: ColumnId, width: number) => {
    setInternalWidths((prev) => ({ ...prev, [columnId]: width }));
    onColumnResize?.(columnId, width);
  };

  // Layout owns pure geometry derivation and both virtualizers.
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

  // Forward store changes without subscribing the windowed body through React state.
  useEffect(() => {
    if (!onSelectionChange) return;
    return store.subscribe(() => onSelectionChange(store.getSnapshot()));
  }, [store, onSelectionChange]);

  // Live-DOM geometry readers (hit-testing, per-zone layout, scroll-into-view) shared by the
  // interaction hooks below.
  const helpers = useGridGeometryHelpers({
    scrollRef,
    layout,
    rows,
    rowHeight,
  });
  const { scrollCellIntoView } = helpers;

  // Only EditorPortal subscribes to edit state.

  const {
    beginEdit,
    setDraft,
    cancelEdit,
    commitCell,
    commitImplicit,
    commitAndMove,
  } = useCellEditing({
    store,
    editStore,
    pendingStore,
    columns,
    rows,
    getRowId,
    rowHeight,
    geom,
    onCellCommit,
    onCellCommitError,
    scrollRef,
    scrollCellIntoView,
  });

  // Column drag and cell selection are mutually exclusive; header drag gets first refusal.
  const colDrag = useColumnDrag({
    reorderable,
    dragStore,
    scrollRef,
    layout,
    helpers,
    onColumnOrderChange,
  });
  // Resize gets first refusal because its narrow hit area overlaps the header drag area.
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

  // Earlier gestures get first refusal; all gestures clean up after lost pointer capture.
  const { onPointerDown, onPointerMove, onPointerUp, onLostPointerCapture } =
    composePointerGestures([colResize, colDrag, dragSel]);

  const { onKeyDown } = useGridKeyboard({
    store,
    editStore,
    layout,
    beginEdit,
    scrollCellIntoView,
  });

  const rowIdAt = (index: number) => getRowId(rows[index], index);
  const getAllRowIds = () => rows.map((row, i) => getRowId(row, i));

  // Frozen zones render every column; the center list contains only virtualized columns. Folding the
  // scroll margin into `x` keeps GridZone independent of virtualization.
  const leftPlaced: PlacedCol<T>[] = zones.left.map((col, i) => ({
    col,
    x: left.offsets[i],
    width: left.widths[i],
  }));
  const rightPlaced: PlacedCol<T>[] = zones.right.map((col, i) => ({
    col,
    x: right.offsets[i],
    width: right.widths[i],
  }));
  const centerPlaced: PlacedCol<T>[] = vCols.map((vc) => ({
    col: zones.center[vc.index],
    x: vc.start - centerScrollMargin,
    width: vc.size,
  }));

  const zoneProps = {
    gutterW,
    rowHeight,
    totalHeight,
    vRows,
    rows,
    getRowId,
    reorderable,
    resizeEnabled,
    store,
    editStore,
    dragStore,
    pendingStore,
    resizeStore,
    geom,
  };

  // Flex places the right zone at the content edge required by `sticky; right: 0`. Sticky zones and
  // headers then follow the native scroll without JavaScript synchronization.
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

          {/* frozen zones render only when non-empty; the center always renders (even width 0) */}
          {leftPlaced.length > 0 && (
            <GridZone
              zone="left"
              placedCols={leftPlaced}
              total={left.total}
              {...zoneProps}
            />
          )}

          <GridZone
            zone="center"
            placedCols={centerPlaced}
            total={center.total}
            {...zoneProps}
          />

          {rightPlaced.length > 0 && (
            <GridZone
              zone="right"
              placedCols={rightPlaced}
              total={right.total}
              {...zoneProps}
            />
          )}
        </div>
      </div>

      {/* The body portal escapes the scroll clip. Only this leaf
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
        setDraft={setDraft}
        commit={commitCell}
        commitImplicit={commitImplicit}
        cancel={cancelEdit}
        commitAndMove={commitAndMove}
        editorClassName={editorClassName}
        editorStyle={editorStyle}
      />
    </>
  );
}
