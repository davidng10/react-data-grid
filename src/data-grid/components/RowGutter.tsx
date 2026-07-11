import { useSyncExternalStore } from "react";

import {
  FROZEN_BG,
  GUTTER_WIDTH,
  HEADER_BG,
  HEADER_BORDER,
} from "../internal/constants";
import { FREEZE_DIVIDER_LEFT } from "../internal/style";

import type { VirtualItem } from "@tanstack/react-virtual";
import type { CSSProperties } from "react";
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

  const cellStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: GUTTER_WIDTH,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRight: "1px solid #e7e5e4",
    borderBottom: "1px solid #f0efee",
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        flex: `0 0 ${GUTTER_WIDTH}px`,
        position: "sticky",
        left: 0,
        zIndex: 3,
        ...(strongDivider ? FREEZE_DIVIDER_LEFT : null),
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          height: rowHeight,
          background: HEADER_BG,
          borderBottom: HEADER_BORDER,
          borderRight: "1px solid #e7e5e4",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <input
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
      <div
        style={{
          position: "relative",
          height: bodyHeight,
          background: FROZEN_BG,
        }}
      >
        {vRows.map((vr) => {
          const rowId = rowIdAt(vr.index);
          return (
            <div
              key={vr.key}
              style={{
                ...cellStyle,
                height: vr.size,
                transform: `translateY(${vr.start}px)`,
              }}
            >
              <input
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
