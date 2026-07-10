// Stores transient column-drag state. Geometry remains pure, and only `DragOverlay` subscribes.

import type { Zone } from "../selection/geometry";
import type { ColumnId } from "../types/ids";

export type DragState =
  | { status: "idle" }
  | {
      status: "dragging";
      /** The header being dragged. */
      sourceColumnId: ColumnId;
      /** Fixed for the gesture because columns cannot move between zones. */
      sourceZone: Zone;
      /** The source's local index within its zone. */
      sourceIndex: number;
      /** Insertion index 0..n within the zone (where a drop would land). */
      targetIndex: number;
      /** Zone-local x of the drop-indicator line (a column boundary). */
      indicatorX: number;
    };

const IDLE: DragState = { status: "idle" };

export interface DragStore {
  getSnapshot: () => DragState;
  subscribe: (listener: () => void) => () => void;

  /** Begin a drag (called once the pointer crosses the movement threshold). */
  start: (args: {
    sourceColumnId: ColumnId;
    sourceZone: Zone;
    sourceIndex: number;
    targetIndex: number;
    indicatorX: number;
  }) => void;
  /**
   * Move the drop target as the pointer moves. No-op while idle; skips the `set` (so the overlay
   * doesn't re-render) when the index + indicator are unchanged — mirrors `extendDrag`'s same-cell
   * guard.
   */
  updateTarget: (targetIndex: number, indicatorX: number) => void;
  /** End the drag (drop or cancel) -> idle. */
  end: () => void;
}

export function createDragStore(): DragStore {
  let state: DragState = IDLE;
  const listeners = new Set<() => void>();

  const set = (next: DragState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    start({
      sourceColumnId,
      sourceZone,
      sourceIndex,
      targetIndex,
      indicatorX,
    }) {
      set({
        status: "dragging",
        sourceColumnId,
        sourceZone,
        sourceIndex,
        targetIndex,
        indicatorX,
      });
    },

    updateTarget(targetIndex, indicatorX) {
      if (state.status !== "dragging") return;
      if (state.targetIndex === targetIndex && state.indicatorX === indicatorX)
        return;
      set({ ...state, targetIndex, indicatorX });
    },

    end() {
      if (state.status !== "idle") set(IDLE);
    },
  };
}
