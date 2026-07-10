import { memo, useSyncExternalStore } from "react";
import type { DragStore } from "../core/store/drag-store";
import type { Zone } from "../core/selection/geometry";
import { DROP_LINE_COLOR } from "../internal/constants";

// Draws the drop indicator in the source zone's header coordinate space.
export const DragOverlay = memo(function DragOverlay(props: {
  zone: Zone;
  dragStore: DragStore;
  rowHeight: number;
}) {
  const { zone, dragStore, rowHeight } = props;
  const drag = useSyncExternalStore(dragStore.subscribe, dragStore.getSnapshot);
  if (drag.status !== "dragging" || drag.sourceZone !== zone) return null;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 2,
          height: rowHeight,
          transform: `translateX(${drag.indicatorX - 1}px)`,
          background: DROP_LINE_COLOR,
          zIndex: 2,
        }}
      />
    </div>
  );
});
