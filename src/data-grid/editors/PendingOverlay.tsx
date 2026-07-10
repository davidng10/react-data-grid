// Displays optimistic values and commit failures in zone-local coordinates. Only this overlay
// subscribes to pending state.

import { memo, useEffect, useRef, useSyncExternalStore } from "react";

import { cellToZoneRect } from "../core/selection/geometry";
import { ERROR_FLASH_MS } from "../core/store/pending-store";

import type { CSSProperties } from "react";
import type { GridGeometry, Zone, ZoneRect } from "../core/selection/geometry";
import type { PendingStore } from "../core/store/pending-store";

const PENDING_BG = "#ffffff";
const PENDING_FG = "#78716c";
const ERROR_BORDER = "#dc2626";
const ERROR_FILL = "rgba(220, 38, 38, 0.10)";
// The body cell's grid lines (right + bottom). The opaque pending box covers the cell, so it must
// repaint them or the saving cell looks borderless. Matches `cellBase` in data-grid.tsx.
const GRID_LINE = "1px solid #f0efee";

function Spinner() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      style={{ flex: "none", marginLeft: 6 }}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="#e7e5e4"
        strokeWidth="3"
      />
      <path
        d="M12 3 a9 9 0 0 1 9 9"
        fill="none"
        stroke="#2563eb"
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

const boxBase = (r: ZoneRect): CSSProperties => ({
  position: "absolute",
  left: 0,
  top: 0,
  width: r.width,
  height: r.height,
  transform: `translate(${r.x}px, ${r.y}px)`,
  boxSizing: "border-box",
});

function PendingBox(props: { rect: ZoneRect; value: unknown }) {
  const { rect, value } = props;
  return (
    <div
      style={{
        ...boxBase(rect),
        background: PENDING_BG,
        borderRight: GRID_LINE,
        borderBottom: GRID_LINE,
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        font: "13px/1 system-ui, sans-serif",
        color: PENDING_FG,
      }}
    >
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
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
    <div
      ref={ref}
      style={{
        ...boxBase(props.rect),
        border: `1px solid ${ERROR_BORDER}`,
        background: ERROR_FILL,
        borderRadius: 1,
      }}
    />
  );
}

export const PendingOverlay = memo(function PendingOverlay(props: {
  zone: Zone;
  pendingStore: PendingStore;
  geom: GridGeometry;
}) {
  const { zone, pendingStore, geom } = props;
  const pending = useSyncExternalStore(
    pendingStore.subscribe,
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
    const rect = cellToZoneRect(entry.cell, geom);
    if (!rect || rect.zone !== zone) continue;
    items.push({ key, rect, value: entry.value, status: entry.status });
  }
  if (items.length === 0) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
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
