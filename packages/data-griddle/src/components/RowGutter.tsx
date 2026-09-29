import { useMemo, useRef, useSyncExternalStore } from "react";

import { gridCellId } from "../internal/accessibility";
import { GUTTER_WIDTH } from "../internal/constants";
import { useIsomorphicLayoutEffect as useLayoutEffect } from "../internal/use-isomorphic-layout-effect";

import type { VirtualItem } from "@tanstack/react-virtual";
import type { GridStore } from "../core/store/grid-store";
import type {
  DataGridProps,
  RowId,
  SelectionCheckboxProps,
} from "../core/types";

// Shell-owned row-selection gutter, pinned at the far left. Subscribes to the store for the
// selected-row set (a click re-renders only this leaf, never the body). Re-renders on scroll too
// (its windowed rows change), but that's ~30 checkboxes — negligible next to the body.
export function RowGutter(props: {
  gridId: string;
  store: GridStore;
  vRows: VirtualItem[];
  rowIdAt: (index: number) => RowId;
  rowCount: number;
  bodyHeight: number;
  rowHeight: number;
  allRowIds: readonly RowId[];
  onSelectedRowIdsChange: (rowIds: ReadonlySet<RowId>) => void;
  disabled: boolean;
  readOnly: boolean;
  renderSelectionCheckbox?: DataGridProps<unknown>["renderSelectionCheckbox"];
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
    readOnly,
    renderSelectionCheckbox,
    strongDivider,
  } = props;
  const selection = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  // Scroll/focus/range updates reuse this count; do not scan the dataset on pointer movement.
  const selectedCount = useMemo(
    () => allRowIds.filter((id) => selection.selectedRows.has(id)).length,
    [allRowIds, selection.selectedRows]
  );
  const allChecked = rowCount > 0 && selectedCount === rowCount;
  const someChecked = selectedCount > 0 && !allChecked;

  // Controls may retain callbacks. Resolve every toggle against the latest committed props and
  // store snapshot, including loading/read-only transitions and removed rows.
  const toggleRef = useRef<(rowId?: RowId) => void>(() => {});
  useLayoutEffect(() => {
    toggleRef.current = (rowId) => {
      if (disabled || readOnly || allRowIds.length === 0) return;
      const next = new Set(store.getSnapshot().selectedRows);
      if (rowId !== undefined) {
        if (!allRowIds.includes(rowId)) return;
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
      } else if (allRowIds.some((id) => next.has(id))) {
        for (const id of allRowIds) next.delete(id);
      } else {
        for (const id of allRowIds) next.add(id);
      }
      onSelectedRowIdsChange(next);
    };
    return () => {
      toggleRef.current = () => {};
    };
  }, [disabled, readOnly, allRowIds, store, onSelectedRowIdsChange]);
  const toggle = useMemo(() => (rowId?: RowId) => toggleRef.current(rowId), []);

  return (
    <div
      className="dgr-row-gutter"
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      data-divider={strongDivider || undefined}
      style={{ flex: `0 0 ${GUTTER_WIDTH}px` }}
    >
      <div
        className="dgr-gutter-header"
        role="columnheader"
        aria-colindex={1}
        id={gridCellId(props.gridId, null, null)}
        style={{ height: rowHeight }}
      >
        <SelectionCheckbox
          render={renderSelectionCheckbox}
          controlProps={{
            kind: "all",
            "aria-label": "Select all rows",
            disabled: disabled || rowCount === 0,
            readOnly,
            checked: allChecked,
            indeterminate: someChecked,
            onChange: () => toggle(),
          }}
        />
      </div>
      <div className="dgr-body" style={{ height: bodyHeight }}>
        {vRows.map((vr) => {
          const rowId = rowIdAt(vr.index);
          return (
            <div
              className="dgr-gutter-cell"
              role="gridcell"
              aria-colindex={1}
              aria-rowindex={vr.index + 2}
              id={gridCellId(props.gridId, rowId, null)}
              key={vr.key}
              style={{
                width: GUTTER_WIDTH,
                height: vr.size,
                transform: `translateY(${vr.start}px)`,
              }}
            >
              <SelectionCheckbox
                render={renderSelectionCheckbox}
                controlProps={{
                  kind: "row",
                  rowId,
                  rowIndex: vr.index,
                  "aria-label": `Select row ${vr.index + 1}`,
                  disabled,
                  readOnly,
                  checked: selection.selectedRows.has(rowId),
                  indeterminate: false,
                  onChange: () => toggle(rowId),
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function defaultCheckbox(props: SelectionCheckboxProps) {
  return (
    <label className="dgr-checkbox-target">
      <input
        className="dgr-checkbox"
        type="checkbox"
        aria-label={props["aria-label"]}
        aria-readonly={props.readOnly}
        disabled={props.disabled}
        checked={props.checked}
        ref={(element) => {
          if (element) element.indeterminate = props.indeterminate;
        }}
        onChange={props.onChange}
      />
    </label>
  );
}

// Invoke render hooks in a leaf: onChange is event-only, never evaluated by the grid in render.
function SelectionCheckbox({
  render,
  controlProps,
}: {
  render: DataGridProps<unknown>["renderSelectionCheckbox"];
  controlProps: SelectionCheckboxProps;
}) {
  return (render ?? defaultCheckbox)(controlProps);
}
