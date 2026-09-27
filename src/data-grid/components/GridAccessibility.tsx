import { useLayoutEffect } from "react";

import { gridCellId } from "../internal/accessibility";

import type { VirtualItem } from "@tanstack/react-virtual";
import type { RefObject } from "react";
import type { GridGeometry } from "../core/selection/geometry";
import type { GridStore } from "../core/store/grid-store";
import type { RowId } from "../core/types";

/** Logical owners group the actual cells across zones; never duplicate renderer content. */
export function GridAccessibility(props: {
  gridId: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  store: GridStore;
  rowIds: readonly RowId[];
  vRows: VirtualItem[];
  renderedColumns: readonly string[];
  geom: GridGeometry;
  gutter: boolean;
}) {
  const {
    gridId,
    scrollRef,
    store,
    rowIds,
    vRows,
    renderedColumns,
    geom,
    gutter,
  } = props;
  useLayoutEffect(() => {
    const grid = scrollRef.current;
    if (!grid) return;
    const cells = [...grid.querySelectorAll<HTMLElement>("[data-cell-row]")];
    const rows = [
      ...grid.querySelectorAll<HTMLElement>('[role="row"][data-row-index]'),
    ];
    const update = () => {
      const { focusedCell, range, selectedRows } = store.getSnapshot();
      const activeId =
        focusedCell && rowIds[focusedCell.rowIndex] !== undefined
          ? gridCellId(
              gridId,
              rowIds[focusedCell.rowIndex],
              focusedCell.columnId
            )
          : null;
      // Logical focus survives virtualization; a missing DOM target must not
      // bring back the scroller outline around its native scrollbars.
      grid.toggleAttribute("data-has-focused-cell", activeId !== null);
      if (activeId && document.getElementById(activeId))
        grid.setAttribute("aria-activedescendant", activeId);
      else grid.removeAttribute("aria-activedescendant");
      const start = range
        ? geom.columnOrder.indexOf(range.anchor.columnId)
        : -1;
      const end = range ? geom.columnOrder.indexOf(range.focus.columnId) : -1;
      for (const cell of cells) {
        const r = Number(cell.dataset.cellRow);
        const c = Number(cell.dataset.cellColumn);
        const selected =
          range != null &&
          r >= Math.min(range.anchor.rowIndex, range.focus.rowIndex) &&
          r <= Math.max(range.anchor.rowIndex, range.focus.rowIndex) &&
          c >= Math.min(start, end) &&
          c <= Math.max(start, end);
        const value = String(selected);
        if (cell.getAttribute("aria-selected") !== value)
          cell.setAttribute("aria-selected", value);
      }
      for (const row of rows) {
        if (gutter)
          row.setAttribute(
            "aria-selected",
            String(selectedRows.has(rowIds[Number(row.dataset.rowIndex)]))
          );
      }
    };
    update();
    return store.subscribe(update);
  });
  const owns = (rowId: RowId | null) =>
    [
      ...(gutter ? [gridCellId(gridId, rowId, null)] : []),
      ...renderedColumns.map((id) => gridCellId(gridId, rowId, id)),
    ].join(" ");
  return (
    <>
      <div className="dgr-semantic-rows">
        <div role="row" aria-rowindex={1} aria-owns={owns(null)} />
        {vRows.map((row) => (
          <div
            key={row.key}
            role="row"
            aria-rowindex={row.index + 2}
            data-row-index={row.index}
            aria-owns={owns(rowIds[row.index])}
          />
        ))}
      </div>
      <div className="dgr-sr-only" id={`${gridId}-instructions`}>
        Arrow keys navigate cells. Shift and arrows select a range. Home, End
        and Page keys navigate. Enter edits. Escape cancels. Tab moves through
        the grid and its controls in browser tab order. Only visible rows and
        columns are rendered.
      </div>
    </>
  );
}
