import type { PointerEvent as ReactPointerEvent } from "react";

// Compose mutually exclusive gestures in priority order. The first handler to consume an event wins;
// lost pointer capture runs every cleanup handler.

type PointerHandler = (e: ReactPointerEvent<HTMLDivElement>) => boolean | void;

export interface PointerGesture {
  onPointerDown?: PointerHandler;
  onPointerMove?: PointerHandler;
  onPointerUp?: PointerHandler;
  onLostPointerCapture?: () => void;
}

export interface PointerGestureHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: () => void;
}

/**
 * Compose ordered gestures into container handlers. Only the primary button starts a gesture.
 */
export function composePointerGestures(
  gestures: PointerGesture[]
): PointerGestureHandlers {
  const route = (
    e: ReactPointerEvent<HTMLDivElement>,
    pick: (g: PointerGesture) => PointerHandler | undefined
  ) => {
    for (const g of gestures) {
      if (pick(g)?.(e)) return; // first gesture to consume the event wins; the rest are skipped
    }
  };
  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      route(e, (g) => g.onPointerDown);
    },
    onPointerMove: (e) => route(e, (g) => g.onPointerMove),
    onPointerUp: (e) => route(e, (g) => g.onPointerUp),
    onLostPointerCapture: () => {
      for (const g of gestures) g.onLostPointerCapture?.();
    },
  };
}
