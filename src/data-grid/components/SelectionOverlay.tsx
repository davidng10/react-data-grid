import { memo, useSyncExternalStore } from "react";

import { cellToZoneRect, rangeToZoneRects } from "../core/selection/geometry";
import {
  FOCUS_BORDER,
  SELECT_BORDER,
  SELECT_FILL,
} from "../internal/constants";

import type { GridGeometry, Zone } from "../core/selection/geometry";
import type { EditStore } from "../core/store/edit-store";
import type { GridStore } from "../core/store/grid-store";

// The selection layer for ONE zone. Subscribes to the store (so only this leaf re-renders on a
// focus/drag change, never the body) and draws the slice of the range + focus that falls in its
// zone, in zone-local coords (the same coords the cells use). `memo` keeps it off the scroll hot
// path — props are stable across scroll, so it only re-renders when the selection itself changes.
export const SelectionOverlay = memo(function SelectionOverlay(props: {
  zone: Zone;
  store: GridStore;
  editStore: EditStore;
  geom: GridGeometry;
}) {
  const { zone, store, editStore, geom } = props;
  const selection = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const edit = useSyncExternalStore(editStore.subscribe, editStore.getSnapshot);

  const rangeRects = selection.range
    ? rangeToZoneRects(selection.range, geom).filter((r) => r.zone === zone)
    : [];
  // While a cell is being edited, the editor IS the focus indicator — suppress the focus outline so
  // it doesn't peek out behind a custom editor's rounded corners / transparent edges.
  const fc = selection.focusedCell;
  const editingCell = edit.status === "idle" ? null : edit.cell;
  const isEditingFocused =
    fc != null &&
    editingCell != null &&
    editingCell.rowIndex === fc.rowIndex &&
    editingCell.columnId === fc.columnId;
  const focusRect = fc && !isEditingFocused ? cellToZoneRect(fc, geom) : null;
  const focus = focusRect && focusRect.zone === zone ? focusRect : null;

  if (rangeRects.length === 0 && !focus) return null;

  // No z-index: rendered after the cells, so it paints above them by tree order while staying
  // below the sticky header (z1) and — for the center — below the frozen zones (z2).
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {rangeRects.map((r, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: r.width,
            height: r.height,
            transform: `translate(${r.x}px, ${r.y}px)`,
            background: SELECT_FILL,
            border: SELECT_BORDER,
            boxSizing: "border-box",
          }}
        />
      ))}
      {focus && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: focus.width,
            height: focus.height,
            transform: `translate(${focus.x}px, ${focus.y}px)`,
            border: FOCUS_BORDER,
            boxSizing: "border-box",
          }}
        />
      )}
    </div>
  );
});
