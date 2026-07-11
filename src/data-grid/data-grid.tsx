import { useEffect, useMemo, useRef, useState } from "react";

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

import type { PlacedCol } from "./components/GridZone";
import type { CellCoord, ColumnId, DataGridProps, RowId } from "./core/types";

export type { DataGridProps } from "./core/types";

// DOM-rendered grid shell. Rows and center columns are virtualized; frozen zones use sticky
// positioning. Selection and interaction overlays subscribe to external stores so pointer moves
// do not re-render the windowed cells.

const sameSet = <T,>(a: ReadonlySet<T>, b: ReadonlySet<T>) =>
  a.size === b.size && [...a].every((value) => b.has(value));

const sameCell = (a: CellCoord | null, b: CellCoord | null) =>
  a === b ||
  (a != null &&
    b != null &&
    a.rowIndex === b.rowIndex &&
    a.columnId === b.columnId);

function reconcileColumnOrder(
  order: readonly ColumnId[],
  columns: readonly { id: ColumnId }[]
): ColumnId[] {
  const available = new Set(columns.map((column) => column.id));
  const next = order.filter((id) => available.delete(id));
  for (const column of columns) {
    if (available.delete(column.id)) next.push(column.id);
  }
  return next;
}

export function DataGrid<T>(props: DataGridProps<T>) {
  const {
    rows,
    columns,
    getRowId,
    rowHeight = DEFAULT_ROW_HEIGHT,
    overscanRows = DEFAULT_OVERSCAN_ROWS,
    overscanColumns = DEFAULT_OVERSCAN_COLS,
    enableRowSelection = false,
    selectedRowIds,
    defaultSelectedRowIds,
    onSelectedRowIdsChange,
    onSelectionChange,
    reorderable: reorderableProp = true,
    columnOrder: columnOrderProp,
    defaultColumnOrder,
    onColumnOrderChange,
    resizable: resizableProp = true,
    columnWidths,
    defaultColumnWidths,
    onColumnWidthsChange,
    onCellCommit,
    onCellCommitError,
    id,
    className,
    style,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [store] = useState(() =>
    createGridStore({ selectedRows: new Set(defaultSelectedRowIds) })
  );
  const [editStore] = useState(() => createEditStore());
  const [pendingStore] = useState(() => createPendingStore());
  const [dragStore] = useState(() => createDragStore());
  const [resizeStore] = useState(() => createResizeStore());

  const orderControlled = columnOrderProp !== undefined;
  const [internalOrder, setInternalOrder] = useState<ColumnId[]>(() =>
    reconcileColumnOrder(
      defaultColumnOrder ?? columns.map((column) => column.id),
      columns
    )
  );
  const resolvedOrder = useMemo(
    () =>
      orderControlled
        ? columnOrderProp
        : reconcileColumnOrder(internalOrder, columns),
    [orderControlled, columnOrderProp, internalOrder, columns]
  );
  const reorderable =
    reorderableProp && (!orderControlled || onColumnOrderChange != null);
  const commitOrder = (next: readonly ColumnId[]) => {
    if (!orderControlled) setInternalOrder([...next]);
    onColumnOrderChange?.(next);
  };

  const widthsControlled = columnWidths !== undefined;
  const [internalWidths, setInternalWidths] = useState<
    Record<ColumnId, number>
  >(() => ({ ...defaultColumnWidths }));
  const resolvedWidths = widthsControlled ? columnWidths : internalWidths;
  const resizeEnabled =
    resizableProp && (!widthsControlled || onColumnWidthsChange != null);
  const commitResize = (columnId: ColumnId, width: number) => {
    const next = { ...resolvedWidths, [columnId]: width };
    if (!widthsControlled) setInternalWidths(next);
    onColumnWidthsChange?.(next);
  };

  const rowIds = useMemo(
    () => rows.map((row, index) => getRowId(row, index)),
    [rows, getRowId]
  );
  const rowIndexById = useMemo(
    () => new Map(rowIds.map((rowId, index) => [rowId, index])),
    [rowIds]
  );
  const columnIds = useMemo(
    () => new Set(columns.map((column) => column.id)),
    [columns]
  );

  // Layout owns pure geometry derivation and both virtualizers.
  const layout = useGridLayout({
    columns,
    columnOrder: resolvedOrder,
    widthOverrides: resolvedWidths,
    rows,
    rowHeight,
    overscanRows,
    overscanCols: overscanColumns,
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

  // Reconcile stable row identities and column ids without putting selection on the cell render
  // path. Row reordering preserves focus/range; removed rows or columns clear invalid coordinates.
  const previousRowIdsRef = useRef<readonly RowId[]>(rowIds);
  useEffect(() => {
    const previousRowIds = previousRowIdsRef.current;
    const current = store.getSnapshot();
    const mapCell = (cell: CellCoord | null): CellCoord | null => {
      if (cell == null || !columnIds.has(cell.columnId)) return null;
      const rowId = previousRowIds[cell.rowIndex];
      const rowIndex = rowId == null ? undefined : rowIndexById.get(rowId);
      return rowIndex == null ? null : { rowIndex, columnId: cell.columnId };
    };
    const focusedCell = mapCell(current.focusedCell);
    const anchor = current.range ? mapCell(current.range.anchor) : null;
    const focus = current.range ? mapCell(current.range.focus) : null;
    const range = anchor && focus ? { anchor, focus } : null;
    const sourceRows = selectedRowIds ?? current.selectedRows;
    const selectedRows = new Set(
      [...sourceRows].filter((rowId) => rowIndexById.has(rowId))
    );
    if (
      !sameCell(focusedCell, current.focusedCell) ||
      !sameCell(range?.anchor ?? null, current.range?.anchor ?? null) ||
      !sameCell(range?.focus ?? null, current.range?.focus ?? null) ||
      !sameSet(selectedRows, current.selectedRows)
    ) {
      store.setSelection({ focusedCell, range, selectedRows });
    }
    previousRowIdsRef.current = rowIds;
  }, [columnIds, rowIds, rowIndexById, selectedRowIds, store]);

  const updateSelectedRows = (next: ReadonlySet<RowId>) => {
    const selectedRows = new Set(
      [...next].filter((rowId) => rowIndexById.has(rowId))
    );
    onSelectedRowIdsChange?.(selectedRows);
    if (selectedRowIds === undefined) {
      store.setSelectedRows(selectedRows);
    } else {
      onSelectionChange?.({ ...store.getSnapshot(), selectedRows });
    }
  };
  const rowSelectionReadOnly =
    selectedRowIds !== undefined && onSelectedRowIdsChange == null;

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
    onColumnOrderChange: commitOrder,
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

  const rowIdAt = (index: number) => rowIds[index];

  // Frozen zones render every column; the center list contains only virtualized columns. Folding the
  // scroll margin into `x` keeps GridZone independent of virtualization.
  const leftPlaced: PlacedCol<T>[] = zones.left.map((col, i) => ({
    col,
    x: left.offsets[i],
    width: left.widths[i],
    columnIndex: layout.placementMap.get(col.id)?.visualIndex ?? i,
  }));
  const rightPlaced: PlacedCol<T>[] = zones.right.map((col, i) => ({
    col,
    x: right.offsets[i],
    width: right.widths[i],
    columnIndex: layout.placementMap.get(col.id)?.visualIndex ?? i,
  }));
  const centerPlaced: PlacedCol<T>[] = vCols.map((vc) => ({
    col: zones.center[vc.index],
    x: vc.start - centerScrollMargin,
    width: vc.size,
    columnIndex:
      layout.placementMap.get(zones.center[vc.index].id)?.visualIndex ??
      vc.index,
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
    rowIndexById,
  };

  // Flex places the right zone at the content edge required by `sticky; right: 0`. Sticky zones and
  // headers then follow the native scroll without JavaScript synchronization.
  return (
    <>
      <div
        ref={scrollRef}
        id={id}
        className={className}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onLostPointerCapture={onLostPointerCapture}
        onKeyDown={onKeyDown}
        style={{
          ...style,
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
              allRowIds={rowIds}
              onSelectedRowIdsChange={updateSelectedRows}
              disabled={rowSelectionReadOnly}
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
      />
    </>
  );
}
