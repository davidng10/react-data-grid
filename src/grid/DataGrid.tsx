import { memo, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Column, RowId } from "../core/types";
import { cellKey } from "../core/types";

// The grid shell (DOM-rendered). DECISIONS.md D5/D8/D9.
//
// Windowing via TanStack Virtual: one vertical row virtualizer (uniform height, D8) + one
// horizontal column virtualizer (per-index widths). Cells are absolutely positioned with
// transform (D5) and memoized on primitive values (D9). No freeze / selection / editing yet —
// this is the dumb-div shell whose only job is to prove the 50 FPS gate (P3).

export interface GridStats {
  rows: number;
  cols: number;
  renderedCells: number;
}

const DEFAULT_ROW_HEIGHT = 32;
const DEFAULT_COL_WIDTH = 140;

export interface DataGridProps<T> {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T, index: number) => RowId;
  rowHeight?: number;
  overscanRows?: number;
  overscanCols?: number;
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
}) {
  const { value, x, y, width, height } = props;
  return (
    <div
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
}) {
  const { name, x, width, height } = props;
  return (
    <div
      style={{
        ...cellBase,
        fontWeight: 600,
        borderRight: "1px solid #e7e5e4",
        background: "#f5f5f4",
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

export function DataGrid<T>(props: DataGridProps<T>) {
  const {
    rows,
    columns,
    getRowId,
    rowHeight = DEFAULT_ROW_HEIGHT,
    overscanRows = 6,
    overscanCols = 2,
    statsRef,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);

  // False positive lint noise, not using RC
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: overscanRows,
  });

  const colWidths = useMemo(
    () => columns.map((c) => c.width ?? DEFAULT_COL_WIDTH),
    [columns],
  );

  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => colWidths[i],
    overscan: overscanCols,
  });

  const vRows = rowVirtualizer.getVirtualItems();
  const vCols = colVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();
  const totalWidth = colVirtualizer.getTotalSize();

  if (statsRef) {
    statsRef.current = {
      rows: rows.length,
      cols: columns.length,
      renderedCells: vRows.length * vCols.length,
    };
  }

  // Single native scroll container. The header is a sticky row INSIDE it, so it rides the same
  // compositor-driven scroll as the body — horizontal sync is native (no JS, no trailing) and
  // `sticky; top:0` pins it vertically. The header occupies the first `rowHeight` of flow, so
  // the body sits below it automatically; overscan absorbs the ~1-row offset in the row window.
  return (
    <div
      ref={scrollRef}
      style={{ height: "100%", overflow: "auto", position: "relative" }}
    >
      <div
        style={{
          width: totalWidth,
          height: rowHeight + totalHeight,
          position: "relative",
        }}
      >
        {/* sticky header — same scroll as the body, so it never trails */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            width: totalWidth,
            height: rowHeight,
            background: "#f5f5f4",
            borderBottom: "1px solid #d6d3d1",
          }}
        >
          {vCols.map((vc) => (
            <HeaderCell
              key={columns[vc.index].id}
              name={columns[vc.index].name}
              x={vc.start}
              width={vc.size}
              height={rowHeight}
            />
          ))}
        </div>

        {/* body */}
        <div
          style={{ width: totalWidth, height: totalHeight, position: "relative" }}
        >
          {vRows.map((vr) => {
            const row = rows[vr.index];
            const rowId = getRowId(row, vr.index);
            return vCols.map((vc) => {
              const col = columns[vc.index];
              return (
                <Cell
                  key={cellKey(rowId, col.id)}
                  value={String(col.accessor(row) ?? "")}
                  x={vc.start}
                  y={vr.start}
                  width={vc.size}
                  height={vr.size}
                />
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}
