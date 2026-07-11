import { cellKey } from "../core/types/ids";
import { PendingOverlay } from "../editors/PendingOverlay";
import { resolveColumnCapabilities } from "../internal/column-capabilities";
import { FROZEN_BG, HEADER_BG, HEADER_BORDER } from "../internal/constants";
import { readContent } from "../internal/read-content";
import { FREEZE_DIVIDER_LEFT, FREEZE_DIVIDER_RIGHT } from "../internal/style";
import { Cell } from "./Cell";
import { DragOverlay } from "./DragOverlay";
import { EmptyRowsLayer } from "./EmptyRowsLayer";
import { HeaderCell } from "./HeaderCell";
import { ResizeOverlay } from "./ResizeOverlay";
import { SelectionOverlay } from "./SelectionOverlay";

import type { VirtualItem } from "@tanstack/react-virtual";
import type { CSSProperties, ReactNode } from "react";
import type { GridGeometry, Zone } from "../core/selection/geometry";
import type { DragStore } from "../core/store/drag-store";
import type { EditStore } from "../core/store/edit-store";
import type { GridStore } from "../core/store/grid-store";
import type { PendingStore } from "../core/store/pending-store";
import type { ResizeStore } from "../core/store/resize-store";
import type { Column, HeaderRenderContext, RowId } from "../core/types";

/** A rendered column with its resolved zone-local position. */
export type PlacedCol<T> = {
  col: Column<T>;
  x: number;
  width: number;
  columnIndex: number;
};

// Renders one zone's header, cells, and interaction overlays. Only overlays subscribe to stores, so
// interaction updates do not re-render this windowed body.
export function GridZone<T>(props: {
  zone: Zone;
  placedCols: PlacedCol<T>[];
  /** Zone width → flex basis. */
  total: number;
  /** Left-stick offset (so the left zone sits just right of the checkbox gutter); left zone only. */
  gutterW: number;
  rowHeight: number;
  totalHeight: number;
  vRows: VirtualItem[];
  rows: readonly T[];
  getRowId: (row: T, index: number) => RowId;
  reorderable: boolean;
  resizeEnabled: boolean;
  store: GridStore;
  editStore: EditStore;
  dragStore: DragStore;
  pendingStore: PendingStore;
  resizeStore: ResizeStore;
  geom: GridGeometry;
  rowIndexById: ReadonlyMap<RowId, number>;
}): ReactNode {
  const {
    zone,
    placedCols,
    total,
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
  } = props;

  // Frozen zones are `sticky` flex items (z2 — above the scrolling center) pinned to their side with
  // the freeze-divider box-shadow; the center is a plain `relative` flex item. Both flex `0 0 total`.
  const wrapperStyle: CSSProperties =
    zone === "center"
      ? { flex: `0 0 ${total}px`, position: "relative" }
      : zone === "left"
        ? {
            flex: `0 0 ${total}px`,
            position: "sticky",
            zIndex: 2,
            left: gutterW,
            ...FREEZE_DIVIDER_LEFT,
          }
        : {
            flex: `0 0 ${total}px`,
            position: "sticky",
            zIndex: 2,
            right: 0,
            ...FREEZE_DIVIDER_RIGHT,
          };

  // The `frozen` flag on header/cell is set for the frozen zones, omitted (undefined) for center.
  const frozen = zone === "center" ? undefined : zone;

  return (
    <div style={wrapperStyle}>
      {/* header row: sticky on the vertical axis (the frozen corner is sticky on both axes) */}
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
        {placedCols.map((pc) => {
          const capabilities = resolveColumnCapabilities(pc.col);
          const headerContext: HeaderRenderContext<T> = {
            column: pc.col,
            columnId: pc.col.id,
            columnIndex: pc.columnIndex,
            frozen,
            width: pc.width,
            resizable: resizeEnabled && capabilities.resizable,
            reorderable: reorderable && capabilities.reorderable,
          };
          return (
            <HeaderCell
              key={pc.col.id}
              content={
                pc.col.renderHeader
                  ? pc.col.renderHeader(headerContext)
                  : pc.col.name
              }
              x={pc.x}
              width={pc.width}
              height={rowHeight}
              frozen={frozen}
              draggable={headerContext.reorderable}
              resizable={headerContext.resizable}
            />
          );
        })}
        <DragOverlay zone={zone} dragStore={dragStore} rowHeight={rowHeight} />
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
          return placedCols.map((pc) => (
            <Cell
              key={cellKey(rowId, pc.col.id)}
              content={readContent(
                pc.col,
                row,
                vr.index,
                rowId,
                pc.width,
                vr.size
              )}
              x={pc.x}
              y={vr.start}
              width={pc.width}
              height={vr.size}
              frozen={frozen}
            />
          ));
        })}
        <SelectionOverlay
          zone={zone}
          store={store}
          editStore={editStore}
          geom={geom}
        />
        <PendingOverlay
          zone={zone}
          pendingStore={pendingStore}
          geom={geom}
          rowIndexById={rowIndexById}
        />
      </div>
      <ResizeOverlay
        zone={zone}
        resizeStore={resizeStore}
        height={rowHeight + totalHeight}
      />
    </div>
  );
}
