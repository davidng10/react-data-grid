import { memo, useSyncExternalStore } from "react";
import type { ResizeStore } from "../core/store/resize-store";
import type { Zone } from "../core/selection/geometry";
import { RESIZE_LINE_COLOR } from "../internal/constants";

// The guide line for a column resize (D12), one leaf per zone. Mounted INSIDE that zone's container
// (spanning header + body), so it shares the cells' zone-local x and pins/scrolls with them — a
// full-height line marking where the dragged right edge will land. Subscribes to the resize store,
// so a resize drag re-renders only this leaf, never the body (D1/D6). A zone draws the line only
// while ITS own column is the one being resized.
export const ResizeOverlay = memo(function ResizeOverlay(props: {
  zone: Zone;
  resizeStore: ResizeStore;
  /** Full zone height (header + body), so the guide spans every visible row. */
  height: number;
}) {
  const { zone, resizeStore, height } = props;
  const resize = useSyncExternalStore(
    resizeStore.subscribe,
    resizeStore.getSnapshot,
  );
  if (resize.status !== "resizing" || resize.zone !== zone) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 2,
        height,
        transform: `translateX(${resize.indicatorX - 1}px)`,
        background: RESIZE_LINE_COLOR,
        zIndex: 3,
        pointerEvents: "none",
      }}
    />
  );
});
