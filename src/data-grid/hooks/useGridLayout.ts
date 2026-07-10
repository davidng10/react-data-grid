import { useCallback, useEffect, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  DEFAULT_COL_WIDTH,
  GUTTER_WIDTH,
  MIN_COL_WIDTH,
} from "../internal/constants";
import { clampNum, zoneLayout } from "../internal/layout";

import type { VirtualItem } from "@tanstack/react-virtual";
import type { RefObject } from "react";
import type {
  ColumnPlacement,
  GridGeometry,
  Zone,
} from "../core/selection/geometry";
import type { Column, ColumnId } from "../core/types";
import type { ZoneLayout } from "../internal/layout";

type CellPlacement = ColumnPlacement & { localIndex: number };

export interface GridLayout<T> {
  zones: { left: Column<T>[]; center: Column<T>[]; right: Column<T>[] };
  left: ZoneLayout;
  center: ZoneLayout;
  right: ZoneLayout;
  /** Width reserved for the checkbox gutter (0 when row selection is off). */
  gutterW: number;
  /** Content x where the center zone begins (after the gutter + left frozen zone). */
  leftBand: number;
  centerScrollMargin: number;
  totalWidth: number;
  placementMap: Map<ColumnId, CellPlacement>;
  columnOrder: ColumnId[];
  geom: GridGeometry;
  vRows: VirtualItem[];
  vCols: VirtualItem[];
  totalHeight: number;
}

// Derives zone geometry and drives row and center-column virtualization. Interaction state does not
// belong here.
export function useGridLayout<T>(args: {
  columns: Column<T>[];
  /** Controlled column order; source order is used when omitted. */
  columnOrder?: ColumnId[];
  /**
   * In-session widths keyed by column id. Missing entries fall back to `column.width`.
   */
  widthOverrides?: Record<ColumnId, number>;
  rows: T[];
  rowHeight: number;
  overscanRows: number;
  overscanCols: number;
  enableRowSelection: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
}): GridLayout<T> {
  const {
    columns,
    columnOrder: columnOrderProp,
    widthOverrides,
    rows,
    rowHeight,
    overscanRows,
    overscanCols,
    enableRowSelection,
    scrollRef,
  } = args;

  const gutterW = enableRowSelection ? GUTTER_WIDTH : 0;

  // Clamp all width sources so headers, cells, and overlays share the same geometry.
  const widthOf = useCallback(
    (c: Column<T>) =>
      clampNum(
        widthOverrides?.[c.id] ?? c.width ?? DEFAULT_COL_WIDTH,
        c.minWidth ?? MIN_COL_WIDTH,
        c.maxWidth ?? Infinity
      ),
    [widthOverrides]
  );

  // Apply controlled order before zoning. A stable sort places unknown ids after listed ids while
  // preserving their source order. Frozen state still controls zone membership.
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

  // Zone membership is defined only by `frozen`; drag reorder cannot move columns across zones.
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

  const left = useMemo(
    () => zoneLayout(zones.left, widthOf),
    [zones.left, widthOf]
  );
  const center = useMemo(
    () => zoneLayout(zones.center, widthOf),
    [zones.center, widthOf]
  );
  const right = useMemo(
    () => zoneLayout(zones.right, widthOf),
    [zones.right, widthOf]
  );

  // Content x where the left frozen zone begins (after the gutter) and where the center begins
  // (after gutter + left zone). The column virtualizer's window must be offset by the latter.
  const leftBand = gutterW + left.total;
  const centerScrollMargin = leftBand;
  const totalWidth = leftBand + center.total + right.total;

  // Placement of every column in its zone-local coords + the visual column order, both for the
  // overlay geometry and for keyboard stepping / scroll-into-view. `localIndex` is the per-zone
  // index (the center virtualizer's index for center columns).
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
    [rows.length, rowHeight, columnOrder, placementMap]
  );

  // TanStack Virtual returns functions that the React compiler cannot safely memoize.
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

  return {
    zones,
    left,
    center,
    right,
    gutterW,
    leftBand,
    centerScrollMargin,
    totalWidth,
    placementMap,
    columnOrder,
    geom,
    vRows,
    vCols,
    totalHeight,
  };
}
