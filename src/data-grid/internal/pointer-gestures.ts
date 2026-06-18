import type { PointerEvent as ReactPointerEvent } from "react";

// One declarative gesture stack for the grid's scroll container. The shell layers several pointer
// gestures on the SAME element — column-resize, column-reorder, cell drag-select — that are mutually
// exclusive within a gesture and have a fixed priority (resize > reorder > select). Rather than
// hand-repeat that priority inside every event handler (where one handler silently forgetting a
// gesture is a real, shipped bug class — e.g. a lost-pointer-capture path that cleaned up two of the
// three gestures), each gesture declares its handlers once and this composer derives the four
// container handlers from the ordered list.
//
// `onPointerDown/Move/Up` return a "consumed" flag: the FIRST gesture in the list that returns truthy
// wins the event and the rest are skipped (a gesture that returns void/undefined declines, so it can
// sit last as the fallback). `onLostPointerCapture` has no priority — capture loss aborts whatever is
// live, so EVERY gesture's cleanup runs.

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
 * Compose an ordered list of {@link PointerGesture}s into the container's pointer handlers. Priority
 * is the array order — earliest first. Only the PRIMARY button (`button === 0`) starts a gesture, so
 * a right/middle click never enters the stack (it falls through to the native context menu/scroll).
 */
export function composePointerGestures(
  gestures: PointerGesture[],
): PointerGestureHandlers {
  const route = (
    e: ReactPointerEvent<HTMLDivElement>,
    pick: (g: PointerGesture) => PointerHandler | undefined,
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
