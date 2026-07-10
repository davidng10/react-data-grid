import { EDGE_ZONE, EDGE_SPEED } from "./constants";

// Shared edge auto-scroll calculation for selection and column dragging.

/**
 * Non-scrolling viewport margins. Omit `top` for horizontal-only gestures.
 */
export interface EdgeInsets {
  top?: number;
  left: number;
  right: number;
}

/**
 * Return the per-frame scroll delta for a pointer near an inset viewport edge.
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
