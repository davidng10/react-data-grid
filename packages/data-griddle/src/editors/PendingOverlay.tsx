// Displays optimistic values and commit failures in zone-local coordinates. Only this overlay
// subscribes to pending state.

import { memo, useEffect, useRef, useSyncExternalStore } from "react";

import { cellToZoneRect } from "../core/selection/geometry";
import { ERROR_FLASH_MS } from "../core/store/pending-store";

import type { CSSProperties } from "react";
import type { GridGeometry, Zone, ZoneRect } from "../core/selection/geometry";
import type { PendingStore } from "../core/store/pending-store";
import type { RowId } from "../core/types";

function Spinner() {
  return (
    <svg
      className="dgr-pending-spinner"
      width="12"
      height="12"
      viewBox="0 0 24 24"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        className="dgr-pending-track"
        strokeWidth="3"
      />
      <path
        d="M12 3 a9 9 0 0 1 9 9"
        fill="none"
        className="dgr-pending-stroke"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

const rectStyle = (r: ZoneRect): CSSProperties => ({
  width: r.width,
  height: r.height,
  transform: `translate(${r.x}px, ${r.y}px)`,
});

function PendingBox(props: { rect: ZoneRect; value: unknown }) {
  const { rect, value } = props;
  return (
    <div className="dgr-pending-cell" style={rectStyle(rect)}>
      <span className="dgr-pending-value">
        {value == null ? "" : String(value)}
      </span>
      <Spinner />
    </div>
  );
}

// Red border that flashes then fades (Web Animations — no global CSS). The store entry is cleared
// by the shell after the same ERROR_FLASH_MS, which reverts the cell to its old value.
function ErrorFlash(props: { rect: ZoneRect }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    const anim = el.animate(
      [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }],
      {
        duration: ERROR_FLASH_MS,
        easing: "ease-out",
        // Hold the final (transparent) frame; without this the element snaps back to opacity 1
        // when the animation ends and "flashes" a second time before the store entry is cleared.
        fill: "forwards",
      }
    );
    return () => anim.cancel();
  }, []);
  return (
    <div className="dgr-error-cell" ref={ref} style={rectStyle(props.rect)} />
  );
}

export const PendingOverlay = memo(function PendingOverlay(props: {
  zone: Zone;
  pendingStore: PendingStore;
  geom: GridGeometry;
  rowIndexById: ReadonlyMap<RowId, number>;
}) {
  const { zone, pendingStore, geom, rowIndexById } = props;
  const pending = useSyncExternalStore(
    pendingStore.subscribe,
    pendingStore.getSnapshot,
    pendingStore.getSnapshot
  );
  if (pending.size === 0) return null;

  const items: {
    key: string;
    rect: ZoneRect;
    value: unknown;
    status: string;
  }[] = [];
  for (const [key, entry] of pending) {
    const rowIndex = rowIndexById.get(entry.rowId);
    if (rowIndex == null) continue;
    const rect = cellToZoneRect({ rowIndex, columnId: entry.columnId }, geom);
    if (!rect || rect.zone !== zone) continue;
    items.push({ key, rect, value: entry.value, status: entry.status });
  }
  if (items.length === 0) return null;

  return (
    <div className="dgr-overlay" aria-hidden="true">
      {items.map((it) =>
        it.status === "error" ? (
          <ErrorFlash key={it.key} rect={it.rect} />
        ) : (
          <PendingBox key={it.key} rect={it.rect} value={it.value} />
        )
      )}
    </div>
  );
});
