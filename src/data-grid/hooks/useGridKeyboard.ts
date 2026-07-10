import { stepCoord } from "../core/selection/geometry";
import { ARROW_DIR } from "../internal/layout";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { EditStore } from "../core/store/edit-store";
import type { GridStore } from "../core/store/grid-store";
import type { CellCoord } from "../core/types";
import type { GridLayout } from "./useGridLayout";

// Handles keyboard navigation and edit triggers without subscribing the cell body to either store.
export function useGridKeyboard<T>(args: {
  store: GridStore;
  editStore: EditStore;
  layout: GridLayout<T>;
  beginEdit: (cell: CellCoord, initialDraft?: unknown) => boolean;
  scrollCellIntoView: (cell: CellCoord) => void;
}): { onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void } {
  const { store, editStore, layout, beginEdit, scrollCellIntoView } = args;
  const { columnOrder, placementMap, geom } = layout;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // While an editor is open it owns the keyboard (it's focused inside the body portal, so its
    // keydowns don't even reach here — this is a belt-and-braces guard).
    if (editStore.getSnapshot().status !== "idle") return;

    if (e.key === "Escape") {
      store.clearRange();
      return;
    }

    const focused = store.getSnapshot().focusedCell;
    if (focused) {
      // Enter / F2 open the editor; a printable key opens it and replaces the value.
      if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        beginEdit(focused);
        return;
      }

      const isPrintableChar = e.key.length === 1;

      if (isPrintableChar && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Only swallow the key if it actually opened an editor. On a non-editable cell
        // beginEdit no-ops, so an unconditional preventDefault would eat the key's native
        // behavior (e.g. Space scrolling) for nothing.
        if (beginEdit(focused, e.key)) e.preventDefault();
        return;
      }
    }

    const dir = ARROW_DIR[e.key];
    if (!dir || columnOrder.length === 0) return;
    e.preventDefault();

    if (!focused) {
      // First arrow just lands focus on the origin cell — the first SELECTABLE column.
      const firstSelectable =
        columnOrder.find((id) => placementMap.get(id)?.selectable !== false) ??
        columnOrder[0];
      const origin: CellCoord = { rowIndex: 0, columnId: firstSelectable };
      store.focusCell(origin);
      scrollCellIntoView(origin);
      return;
    }
    const next = stepCoord(focused, dir, geom, e.metaKey || e.ctrlKey);
    if (e.shiftKey) store.extendTo(next);
    else store.focusCell(next);
    scrollCellIntoView(next);
  };

  return { onKeyDown };
}
