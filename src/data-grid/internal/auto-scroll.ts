import { EDGE_ZONE, EDGE_SPEED } from "./constants";

// Shared edge auto-scroll ramp for the drag gestures (cell drag-select and column reorder). Both
// nudge the scroll offset while the pointer is held near a viewport edge so off-screen content flows
// in. The band math is identical between them; this is its one home so a boundary/sign fix can't land
// in one gesture and miss the other.

/**
 * The non-scrolling viewport margins: the sticky header (`top`) and the frozen bands (`left`/`right`).
 * Auto-scroll triggers at the SCROLLING region's edge — inset by these — not under the pinned
 * rows/columns. Omit `top` for a horizontal-only gesture (vertical delta stays 0).
 */
export interface EdgeInsets {
  top?: number;
  left: number;
  right: number;
}

/**
 * How far to nudge the scroll offset this frame, given the pointer's position relative to `el`'s
 * inset edge bands. Returns `{dx, dy}` in px/frame: `±EDGE_SPEED` when the pointer is within
 * `EDGE_ZONE` of an edge (inset by the pinned margins), else 0. Vertical is computed only when
 * `insets.top` is provided. Pure — the caller applies the deltas and decides what to do afterward.
 */
export function edgeScrollDelta(
  pt: { x: number; y: number },
  el: HTMLElement,
  insets: EdgeInsets,
): { dx: number; dy: number } {
  const rect = el.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  const leftLimit = rect.left + insets.left;
  const rightLimit = rect.left + el.clientWidth - insets.right;
  if (pt.x < leftLimit + EDGE_ZONE) dx = -EDGE_SPEED;
  else if (pt.x > rightLimit - EDGE_ZONE) dx = EDGE_SPEED;
  if (insets.top != null) {
    const topLimit = rect.top + insets.top;
    if (pt.y < topLimit + EDGE_ZONE) dy = -EDGE_SPEED;
    else if (pt.y > rect.bottom - EDGE_ZONE) dy = EDGE_SPEED;
  }
  return { dx, dy };
}
