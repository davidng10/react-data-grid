// The edit overlay (DECISIONS.md D1/D4/R5/R7) — the editing counterpart of `SelectionOverlay`.
//
// A single memo-free leaf that subscribes to the edit store and, while an edit is open, mounts the
// active cell's editor in a `createPortal` to `document.body`. Two consequences of the portal:
//   • R5 (editor survives the underlying cell virtualizing out) is free — the editor is NOT a body
//     cell, so cell windowing can never unmount it.
//   • R7 (escape the clip) is solved here — a body portal isn't clipped by the grid's
//     `overflow`/transform, so the floating editor can grow past the cell and the grid edges.
// The price: a body portal does NOT ride the grid's compositor scroll, so we reposition it
// IMPERATIVELY on scroll/resize (writing `transform` on the host ref — never setState, so the
// windowed body is never re-rendered, preserving the D1/D6 contract).
//
// `DataGrid` itself never subscribes to the edit store; only this leaf does. Draft keystrokes and
// submit/error transitions re-render only this component.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Column, CellEditContext, EditStatus, RowId } from "../core/types";
import type { EditStore } from "../core/store/edit-store";
import { cellViewportRect } from "../core/selection/geometry";
import type {
  Direction,
  GridGeometry,
  ViewportInfo,
} from "../core/selection/geometry";
import { FloatingTextEditor, NativeSelectEditor } from "./FloatingTextEditor";

// Positioning is owned by the grid — these always win. (transform + visibility are written
// imperatively in `place`, never via React, so they survive this leaf's scroll re-renders.)
const HOST_POSITION: CSSProperties = {
  position: "fixed",
  top: -2,
  left: -2,
};

// The default visual frame for the editor "panel". This is what the integrator restyles via
// `editorClassName` / `editorStyle` (and the `data-editing` attribute, for plain CSS). The default
// editors fill this frame transparently; a custom `renderEdit` should too (e.g. AntD `borderless`),
// so every editor — default or custom — shares one grid-owned, consistently-styled panel.
const HOST_FRAME: CSSProperties = {
  zIndex: 1000,
  border: "1px solid #2563eb",
  borderRadius: 4,
  background: "#fff",
  boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
};

export interface EditorPortalProps<T> {
  editStore: EditStore;
  scrollRef: { current: HTMLDivElement | null };
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T, index: number) => RowId;
  geom: GridGeometry;
  // View constants (px) needed to convert the active cell to viewport coords each reposition.
  gutterW: number;
  leftBand: number;
  rightTotal: number;
  rowHeight: number;
  // Stable callbacks supplied by the shell (they read live props via refs).
  setDraft: (next: unknown) => void;
  commit: () => void;
  cancel: () => void;
  commitAndMove: (dir: Direction) => void;
  // Styling for the floating editor panel (D7): merged onto / set on the host, over the default frame.
  editorClassName?: string;
  editorStyle?: CSSProperties;
}

export function EditorPortal<T>(props: EditorPortalProps<T>) {
  const {
    editStore,
    scrollRef,
    columns,
    rows,
    getRowId,
    geom,
    gutterW,
    leftBand,
    rightTotal,
    rowHeight,
    setDraft,
    commit,
    cancel,
    commitAndMove,
    editorClassName,
    editorStyle,
  } = props;

  const edit = useSyncExternalStore(editStore.subscribe, editStore.getSnapshot);
  const cell = edit.status === "idle" ? null : edit.cell;
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Latest commit, read by the document listener below (props are fresh closures each render).
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });

  // Position (and reposition on scroll/resize) the floating host in viewport coords. Runs in a
  // layout effect so it's placed before paint (no 0,0 flash). Keyed on the cell's PRIMITIVES (not
  // the cell object) so a keystroke — which changes the draft but reuses the same cell — never
  // re-runs it; the effect rebuilds the cell from those primitives so it has no `cell` closure.
  const rowIndex = cell?.rowIndex;
  const columnId = cell?.columnId;
  useLayoutEffect(() => {
    if (rowIndex == null || columnId == null) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const target = { rowIndex, columnId };

    const place = () => {
      const host = hostRef.current;
      if (!host) return;
      const origin = scroller.getBoundingClientRect();
      const view: ViewportInfo = {
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
        clientWidth: scroller.clientWidth,
        clientHeight: scroller.clientHeight,
        gutterW,
        leftBand,
        rightTotal,
      };
      const rect = cellViewportRect(target, geom, view);
      if (!rect) {
        host.style.visibility = "hidden"; // unknown column — shouldn't happen
        return;
      }
      // Keep the active editor "frozen" inside the usable (un-pinned) viewport: as the edited cell
      // scrolls toward an edge the editor clamps to that edge and stays visible — it never tucks
      // under the sticky header / frozen bands and never scrolls away (spec: the editor floats,
      // it does not hide). When the cell is fully on-screen these clamps are no-ops. `rect.height`
      // == the row height == the sticky-header height, so it's also the top inset.
      const clamp = (n: number, lo: number, hi: number) =>
        Math.max(lo, Math.min(hi, n));
      const y = clamp(
        rect.y,
        rect.height,
        Math.max(rect.height, view.clientHeight - rect.height),
      );
      // Horizontal clamp only matters for the center zone; frozen columns are pinned to their band.
      const x =
        geom.placement(columnId)?.zone === "center"
          ? clamp(
              rect.x,
              view.leftBand,
              Math.max(
                view.leftBand,
                view.clientWidth - view.rightTotal - rect.width,
              ),
            )
          : rect.x;
      host.style.visibility = "visible";
      host.style.transform = `translate(${origin.left + x}px, ${origin.top + y}px)`;
    };

    place();
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        place();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [rowIndex, columnId, geom, gutterW, leftBand, rightTotal, scrollRef]);

  // Outside-click closes the editor (a GRID responsibility — D10): a pointerdown anywhere outside
  // the floating host commits the active edit, so every editor (the default one OR a custom
  // `renderEdit`) dismisses without each wiring its own blur. Capture phase, so it runs before the
  // grid's own pointer handlers (which then re-select the clicked cell). Custom editors with their
  // own popup MUST render it INSIDE the host (e.g. AntD `getPopupContainer`) so a click on the popup
  // counts as "inside" and doesn't dismiss the editor.
  useEffect(() => {
    if (rowIndex == null || columnId == null) return;
    const onDown = (e: PointerEvent) => {
      const host = hostRef.current;
      const t = e.target;
      if (host && t instanceof Node && !host.contains(t)) commitRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [rowIndex, columnId]);

  if (edit.status === "idle" || !cell) return null;
  if (typeof document === "undefined") return null;

  const column = columns.find((c) => c.id === cell.columnId);
  const row = rows[cell.rowIndex];
  if (!column || row == null) return null;

  const placement = geom.placement(cell.columnId);
  const width = placement?.width ?? 140;
  const status = edit.status as EditStatus;

  const ctx: CellEditContext<T> = {
    row,
    rowId: getRowId(row, cell.rowIndex),
    rowIndex: cell.rowIndex,
    column,
    value: column.accessor(row),
    draft: edit.draft,
    setDraft,
    commit,
    cancel,
    status,
    error: edit.status === "error" ? edit.error : undefined,
    width,
    height: rowHeight,
  };

  let content: ReactNode;
  if (column.renderEdit) {
    content = column.renderEdit(ctx);
  } else if (column.type === "select") {
    content = (
      <NativeSelectEditor
        api={ctx}
        width={width}
        options={column.options ?? []}
        onEscape={cancel}
      />
    );
  } else {
    content = (
      <FloatingTextEditor
        api={ctx}
        width={width}
        rowHeight={rowHeight}
        onEnter={() => commitAndMove("down")}
        onTab={() => commitAndMove("right")}
        onEscape={cancel}
      />
    );
  }

  return createPortal(
    // Frame (default) ← editorStyle (integrator override) ← position (grid-owned, always wins).
    <div
      ref={hostRef}
      className={editorClassName}
      style={{ ...HOST_FRAME, ...editorStyle, ...HOST_POSITION }}
      data-editing=""
    >
      {content}
    </div>,
    document.body,
  );
}
