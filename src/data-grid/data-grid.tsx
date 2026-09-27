import "./internal/grid.css";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { GridAccessibility } from "./components/GridAccessibility";
import { GridStatusLayer } from "./components/GridStatusLayer";
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
import { classNames } from "./internal/class-names";
import { resolveColumnCapabilities } from "./internal/column-capabilities";
import {
  DEFAULT_OVERSCAN_COLS,
  DEFAULT_OVERSCAN_ROWS,
  DEFAULT_ROW_HEIGHT,
} from "./internal/constants";
import { composePointerGestures } from "./internal/pointer-gestures";

import type {
  ForwardedRef,
  ReactElement,
  RefAttributes,
  SyntheticEvent,
} from "react";
import type { PlacedCol } from "./components/GridZone";
import type {
  CellCoord,
  ColumnId,
  DataGridHandle,
  DataGridProps,
  RowId,
} from "./core/types";

export type { DataGridProps } from "./core/types";

const EMPTY_ROWS: readonly never[] = [];

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

function DataGridInner<T>(
  props: DataGridProps<T>,
  ref: ForwardedRef<DataGridHandle>
) {
  const {
    rows: suppliedRows,
    loading = false,
    loadingIndicator,
    loadingLabel = "Loading data",
    emptyContent = "No rows",
    columns,
    getRowId,
    rowHeight = DEFAULT_ROW_HEIGHT,
    overscanRows = DEFAULT_OVERSCAN_ROWS,
    overscanColumns = DEFAULT_OVERSCAN_COLS,
    enableRowSelection = false,
    renderSelectionCheckbox,
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

  const hasResult = suppliedRows != null;
  const rows = suppliedRows ?? EMPTY_ROWS;

  const gridId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
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
    !loading &&
    reorderableProp &&
    (!orderControlled || onColumnOrderChange != null);
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
    !loading &&
    resizableProp &&
    (!widthsControlled || onColumnWidthsChange != null);
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
  useLayoutEffect(() => {
    if (!onSelectionChange) return;
    return store.subscribe(() => onSelectionChange(store.getSnapshot()));
  }, [store, onSelectionChange]);

  // Reconcile stable row identities and column ids without putting selection on the cell render
  // path. Row reordering preserves focus/range; removed rows or columns clear invalid coordinates.
  const previousRowIdsRef = useRef<readonly RowId[]>(rowIds);
  useLayoutEffect(() => {
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
    if (loading) return;
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
    loading,
    store,
    editStore,
    pendingStore,
    columns,
    rows,
    rowIndexById,
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

  // Refresh commands after reconciliation, before exposing the handle or running parent layout
  // effects. Updating only at commit keeps interrupted renders out of imperative commands.
  const focusCellRef = useRef<DataGridHandle["focusCell"] | null>(null);
  useLayoutEffect(() => {
    focusCellRef.current = ({ rowId, columnId }) => {
      const rowIndex = rowIndexById.get(rowId);
      if (rowIndex === undefined) return { ok: false, reason: "row-not-found" };
      const column = columns.find((candidate) => candidate.id === columnId);
      if (!column) return { ok: false, reason: "column-not-found" };
      if (!resolveColumnCapabilities(column).selectable)
        return { ok: false, reason: "not-selectable" };
      if (
        loading ||
        editStore.getSnapshot().status !== "idle" ||
        colResize.isActive() ||
        colDrag.isActive() ||
        dragSel.isActive()
      )
        return { ok: false, reason: "busy" };
      const cell = { rowIndex, columnId };
      store.focusCell(cell);
      scrollRef.current?.focus({ preventScroll: true });
      scrollCellIntoView(cell);
      return { ok: true };
    };
  });
  // A stable handle lets callback refs store it in state without a render/ref-update loop.
  useImperativeHandle(
    ref,
    () => ({ focusCell: (target) => focusCellRef.current!(target) }),
    []
  );

  // Earlier gestures get first refusal; all gestures clean up after lost pointer capture.
  const { onPointerDown, onPointerMove, onPointerUp } = composePointerGestures([
    colResize,
    colDrag,
    dragSel,
  ]);

  const { onKeyDown } = useGridKeyboard({
    store,
    editStore,
    layout,
    beginEdit,
    scrollCellIntoView,
  });

  const capturedPointerRef = useRef<number | null>(null);
  const cancelGestures = () => {
    colResize.cancel();
    colDrag.onLostPointerCapture();
    dragSel.onLostPointerCapture();
    const pointer = capturedPointerRef.current;
    capturedPointerRef.current = null;
    if (pointer != null && scrollRef.current?.hasPointerCapture(pointer))
      scrollRef.current.releasePointerCapture(pointer);
  };
  const cancelGesturesRef = useRef(cancelGestures);
  useLayoutEffect(() => {
    cancelGesturesRef.current = cancelGestures;
  });
  const gestureInputs = useRef({
    rowIds,
    columns,
    resolvedOrder,
    resolvedWidths,
    resizeEnabled,
    reorderable,
    rowHeight,
  });
  useLayoutEffect(() => {
    const previous = gestureInputs.current;
    gestureInputs.current = {
      rowIds,
      columns,
      resolvedOrder,
      resolvedWidths,
      resizeEnabled,
      reorderable,
      rowHeight,
    };
    if (
      !loading &&
      (previous.rowIds === rowIds ||
        (previous.rowIds.length === rowIds.length &&
          previous.rowIds.every((id, index) => id === rowIds[index]))) &&
      previous.columns === columns &&
      previous.resolvedOrder === resolvedOrder &&
      previous.resolvedWidths === resolvedWidths &&
      previous.resizeEnabled === resizeEnabled &&
      previous.reorderable === reorderable &&
      previous.rowHeight === rowHeight
    )
      return;
    cancelGesturesRef.current();
  }, [
    loading,
    rowIds,
    columns,
    resolvedOrder,
    resolvedWidths,
    resizeEnabled,
    reorderable,
    rowHeight,
  ]);

  // A second contact anywhere (including the gutter or outside the frame) aborts manipulation.
  useEffect(() => {
    const onAdditionalPointer = (event: PointerEvent) => {
      if (
        capturedPointerRef.current != null &&
        event.pointerId !== capturedPointerRef.current
      ) {
        cancelGestures();
      }
    };
    const onBlur = () => {
      cancelGestures();
    };
    document.addEventListener("pointerdown", onAdditionalPointer, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onAdditionalPointer, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
  });

  const blockWhileLoading = (event: SyntheticEvent) => {
    if (!loading) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const rowIdAt = (index: number) => rowIds[index];

  // Frozen zones render every column; the center list contains only virtualized columns. Folding the
  // scroll margin into `x` keeps GridZone independent of virtualization.
  const leftPlaced: PlacedCol<T>[] = zones.left.map((col, i) => ({
    col,
    x: left.offsets[i],
    width: left.widths[i],
    columnIndex: layout.placementMap.get(col.id)?.visualIndex ?? i,
    resizeFromLeft:
      i > 0 && resolveColumnCapabilities(zones.left[i - 1]).resizable,
  }));
  const rightPlaced: PlacedCol<T>[] = zones.right.map((col, i) => ({
    col,
    x: right.offsets[i],
    width: right.widths[i],
    columnIndex: layout.placementMap.get(col.id)?.visualIndex ?? i,
    resizeFromLeft:
      i > 0 && resolveColumnCapabilities(zones.right[i - 1]).resizable,
  }));
  const centerPlaced: PlacedCol<T>[] = vCols.map((vc) => ({
    col: zones.center[vc.index],
    x: vc.start - centerScrollMargin,
    width: vc.size,
    columnIndex:
      layout.placementMap.get(zones.center[vc.index].id)?.visualIndex ??
      vc.index,
    resizeFromLeft:
      vc.index > 0
        ? resolveColumnCapabilities(zones.center[vc.index - 1]).resizable
        : leftPlaced.length > 0 &&
          resolveColumnCapabilities(leftPlaced.at(-1)!.col).resizable,
  }));

  const zoneProps = {
    gridId,
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
    <div
      ref={frameRef}
      id={id}
      className={classNames("dgr-root", className)}
      data-grid-frame=""
      onClickCapture={blockWhileLoading}
      onDoubleClickCapture={blockWhileLoading}
      onPointerDownCapture={blockWhileLoading}
      onPointerMoveCapture={blockWhileLoading}
      onPointerUpCapture={blockWhileLoading}
      onBlurCapture={blockWhileLoading}
      onKeyDownCapture={(event) => {
        if (event.key !== "Tab") blockWhileLoading(event);
      }}
      style={{
        ...style,
        position: "relative",
        isolation: "isolate",
        boxSizing: "border-box",
      }}
    >
      <div
        ref={scrollRef}
        className="dgr-scroller"
        data-grid-scroller=""
        role="grid"
        aria-rowcount={rows.length + 1}
        aria-colcount={layout.columnOrder.length + (enableRowSelection ? 1 : 0)}
        aria-multiselectable="true"
        aria-describedby={`${gridId}-instructions`}
        aria-label={ariaLabel ?? (ariaLabelledBy ? undefined : "Data grid")}
        aria-labelledby={ariaLabelledBy}
        aria-busy={loading}
        inert={loading || undefined}
        tabIndex={0}
        onPointerDown={(event) => {
          if (
            capturedPointerRef.current != null ||
            (event.pointerType === "touch" && event.isPrimary === false)
          ) {
            cancelGestures();
            return;
          }
          if (event.button !== 0 || event.pointerType === "pen") return;
          if (
            event.target instanceof Element &&
            event.target.closest(
              'button, input, select, textarea, a, [contenteditable="true"], [role="button"], [role="checkbox"]'
            )
          )
            return;
          capturedPointerRef.current = event.pointerId;
          if (event.pointerType === "touch") dragSel.onPointerDown(event);
          else onPointerDown(event);
        }}
        onPointerMove={(event) => {
          if (capturedPointerRef.current === event.pointerId)
            onPointerMove(event);
        }}
        onPointerUp={(event) => {
          if (capturedPointerRef.current !== event.pointerId) return;
          capturedPointerRef.current = null;
          onPointerUp(event);
        }}
        onPointerCancel={() => {
          cancelGestures();
        }}
        onLostPointerCapture={() => {
          if (capturedPointerRef.current != null) {
            cancelGestures();
          }
        }}
        onFocus={(event) => {
          if (event.target !== event.currentTarget) return;
          if (
            loading ||
            rows.length === 0 ||
            capturedPointerRef.current != null
          )
            return;
          const current = store.getSnapshot().focusedCell;
          if (current) {
            scrollCellIntoView(current);
            return;
          }
          const columnId = layout.columnOrder.find(
            (id) => layout.placementMap.get(id)?.selectable !== false
          );
          if (columnId) {
            const cell = { rowIndex: 0, columnId };
            store.focusCell(cell);
            scrollCellIntoView(cell);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            cancelGestures();
          }
          onKeyDown(event);
        }}
      >
        <GridAccessibility
          gridId={gridId}
          scrollRef={scrollRef}
          store={store}
          rowIds={rowIds}
          vRows={vRows}
          renderedColumns={[...leftPlaced, ...centerPlaced, ...rightPlaced].map(
            (pc) => pc.col.id
          )}
          geom={geom}
          gutter={enableRowSelection}
        />
        <div
          className="dgr-content"
          style={{
            width: totalWidth,
            height: rowHeight + totalHeight,
          }}
        >
          {enableRowSelection && (
            <RowGutter
              gridId={gridId}
              store={store}
              vRows={vRows}
              rowIdAt={rowIdAt}
              rowCount={rows.length}
              bodyHeight={totalHeight}
              rowHeight={rowHeight}
              allRowIds={rowIds}
              onSelectedRowIdsChange={updateSelectedRows}
              disabled={loading || rowSelectionReadOnly}
              readOnly={rowSelectionReadOnly}
              renderSelectionCheckbox={renderSelectionCheckbox}
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

      <GridStatusLayer
        hasResult={hasResult}
        rowCount={rows.length}
        loading={loading}
        rowHeight={rowHeight}
        totalWidth={totalWidth}
        loadingIndicator={loadingIndicator}
        loadingLabel={loadingLabel}
        emptyContent={emptyContent}
      />

      {/* The body portal escapes the scroll clip. Only this leaf
          subscribes to the edit store; the windowed body above never re-renders on edit. */}
      <EditorPortal
        frameRef={frameRef}
        loading={loading}
        editStore={editStore}
        scrollRef={scrollRef}
        columns={columns}
        rows={rows}
        rowIndexById={rowIndexById}
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
    </div>
  );
}

// forwardRef supports React 18 and 19. Preserve inference of T at JSX call sites instead of
// exposing forwardRef's erased unknown row type. The runtime handle is independent of T.
export const DataGrid = forwardRef(DataGridInner) as <T>(
  props: DataGridProps<T> & RefAttributes<DataGridHandle>
) => ReactElement;
