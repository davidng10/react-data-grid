import { memo, useSyncExternalStore } from "react";

import type { Zone } from "../core/selection/geometry";
import type { DragStore } from "../core/store/drag-store";

// Draws the drop indicator in the source zone's header coordinate space.
export const DragOverlay = memo(function DragOverlay(props: {
  zone: Zone;
  dragStore: DragStore;
  rowHeight: number;
}) {
  const { zone, dragStore, rowHeight } = props;
  const drag = useSyncExternalStore(
    dragStore.subscribe,
    dragStore.getSnapshot,
    dragStore.getSnapshot
  );
  if (drag.status !== "dragging" || drag.sourceZone !== zone) return null;
  return (
    <div className="dgr-overlay">
      <div
        className="dgr-reorder-indicator"
        style={{
          height: rowHeight,
          transform: `translateX(${drag.indicatorX - 1}px)`,
        }}
      />
    </div>
  );
});
