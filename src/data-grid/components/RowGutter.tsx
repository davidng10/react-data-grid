import { useSyncExternalStore } from "react";

import { GUTTER_WIDTH } from "../internal/constants";

import type { VirtualItem } from "@tanstack/react-virtual";
import type { GridStore } from "../core/store/grid-store";
import type { RowId } from "../core/types";

// Shell-owned row-selection gutter, pinned at the far left. Subscribes to the store for the
// selected-row set (a click re-renders only this leaf, never the body). Re-renders on scroll too
// (its windowed rows change), but that's ~30 checkboxes — negligible next to the body.
export function RowGutter(props: {
  store: GridStore;
  vRows: VirtualItem[];
  rowIdAt: (index: number) => RowId;
  rowCount: number;
  bodyHeight: number;
  rowHeight: number;
  allRowIds: readonly RowId[];
  onSelectedRowIdsChange: (rowIds: ReadonlySet<RowId>) => void;
  disabled: boolean;
  strongDivider: boolean;
}) {
  const {
    store,
    vRows,
    rowIdAt,
    rowCount,
    bodyHeight,
    rowHeight,
    allRowIds,
    onSelectedRowIdsChange,
    disabled,
    strongDivider,
  } = props;
  const selection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const selectedCount = selection.selectedRows.size;
  const allChecked = rowCount > 0 && selectedCount >= rowCount;
  const someChecked = selectedCount > 0 && !allChecked;

  return (
    <div
      className="dgr-row-gutter"
      data-divider={strongDivider || undefined}
      style={{ flex: `0 0 ${GUTTER_WIDTH}px` }}
    >
      <div className="dgr-gutter-header" style={{ height: rowHeight }}>
        <input
          className="dgr-checkbox"
          type="checkbox"
          aria-label="Select all rows"
          disabled={disabled}
          checked={allChecked}
          ref={(el) => {
            if (el) el.indeterminate = someChecked;
          }}
          onChange={() => {
            const next = new Set(selection.selectedRows);
            if (allChecked || someChecked) {
              for (const rowId of allRowIds) next.delete(rowId);
            } else {
              for (const rowId of allRowIds) next.add(rowId);
            }
            onSelectedRowIdsChange(next);
          }}
        />
      </div>
      <div className="dgr-body" style={{ height: bodyHeight }}>
        {vRows.map((vr) => {
          const rowId = rowIdAt(vr.index);
          return (
            <div
              className="dgr-gutter-cell"
              key={vr.key}
              style={{
                width: GUTTER_WIDTH,
                height: vr.size,
                transform: `translateY(${vr.start}px)`,
              }}
            >
              <input
                className="dgr-checkbox"
                type="checkbox"
                aria-label={`Select row ${vr.index + 1}`}
                disabled={disabled}
                checked={selection.selectedRows.has(rowId)}
                onChange={() => {
                  const next = new Set(selection.selectedRows);
                  if (next.has(rowId)) next.delete(rowId);
                  else next.add(rowId);
                  onSelectedRowIdsChange(next);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
