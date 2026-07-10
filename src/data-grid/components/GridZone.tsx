import type { CSSProperties, ReactNode } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { Column, RowId } from "../core/types";
import { cellKey } from "../core/types";
import type { GridGeometry, Zone } from "../core/selection/geometry";
import type { GridStore } from "../core/store/grid-store";
import type { EditStore } from "../core/store/edit-store";
import type { DragStore } from "../core/store/drag-store";
import type { PendingStore } from "../core/store/pending-store";
import type { ResizeStore } from "../core/store/resize-store";
import { HEADER_BG, HEADER_BORDER, FROZEN_BG } from "../internal/constants";
import { FREEZE_DIVIDER_LEFT, FREEZE_DIVIDER_RIGHT } from "../internal/style";
import { readContent } from "../internal/read-content";
import { Cell } from "./Cell";
import { HeaderCell } from "./HeaderCell";
import { DragOverlay } from "./DragOverlay";
import { EmptyRowsLayer } from "./EmptyRowsLayer";
import { SelectionOverlay } from "./SelectionOverlay";
import { ResizeOverlay } from "./ResizeOverlay";
import { PendingOverlay } from "../editors/PendingOverlay";

/** A rendered column with its resolved zone-local position. */
export type PlacedCol<T> = { col: Column<T>; x: number; width: number };

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
  rows: T[];
  getRowId: (row: T, index: number) => RowId;
  reorderable: boolean;
  resizeEnabled: boolean;
  store: GridStore;
  editStore: EditStore;
  dragStore: DragStore;
  pendingStore: PendingStore;
  resizeStore: ResizeStore;
  geom: GridGeometry;
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
        {placedCols.map((pc) => (
          <HeaderCell
            key={pc.col.id}
            name={pc.col.name}
            x={pc.x}
            width={pc.width}
            height={rowHeight}
            frozen={frozen}
            draggable={reorderable && pc.col.type !== "action"}
            resizable={
              resizeEnabled &&
              pc.col.type !== "action" &&
              pc.col.resizable !== false
            }
          />
        ))}
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
              content={readContent(pc.col, row, vr.index, rowId)}
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
        <PendingOverlay zone={zone} pendingStore={pendingStore} geom={geom} />
      </div>
      <ResizeOverlay
        zone={zone}
        resizeStore={resizeStore}
        height={rowHeight + totalHeight}
      />
    </div>
  );
}
