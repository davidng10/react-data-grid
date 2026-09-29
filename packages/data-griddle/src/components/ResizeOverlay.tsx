import { memo, useSyncExternalStore } from "react";

import type { Zone } from "../core/selection/geometry";
import type { ResizeStore } from "../core/store/resize-store";

// Draws the resize guide in the active zone's coordinate space.
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
    resizeStore.getSnapshot
  );
  if (resize.status !== "resizing" || resize.zone !== zone) return null;
  return (
    <div
      className="dgr-resize-indicator"
      style={{
        height,
        transform: `translateX(${resize.indicatorX - 1}px)`,
      }}
    />
  );
});
