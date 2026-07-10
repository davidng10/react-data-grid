// Renders the active editor in a body portal so virtualization cannot unmount it and grid overflow
// cannot clip it. The host is repositioned imperatively during scrolling to avoid cell re-renders.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { cellViewportRect } from "../core/selection/geometry";
import { FloatingTextEditor, NativeSelectEditor } from "./FloatingTextEditor";

import type { CSSProperties, ReactNode } from "react";
import type {
  Direction,
  GridGeometry,
  ViewportInfo,
} from "../core/selection/geometry";
import type { EditStore } from "../core/store/edit-store";
import type { CellEditContext, Column, EditStatus, RowId } from "../core/types";

// Positioning is owned by the grid — these always win. (transform + visibility are written
// imperatively in `place`, never via React, so they survive this leaf's scroll re-renders.)
const HOST_POSITION: CSSProperties = {
  position: "fixed",
  top: -2,
  left: -2,
};

// The default visual frame for the editor "panel". This is what the integrator restyles via
// `editorClassName` / `editorStyle` (and the `data-editing` / `data-invalid` attributes, for plain
// CSS). The default editors fill this frame transparently; a custom `renderEdit` should too (e.g.
// AntD `borderless`), so every editor — default or custom — shares one consistently-styled panel.
const HOST_FRAME: CSSProperties = {
  zIndex: 1000,
  borderRadius: 4,
  background: "#fff",
  boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
};

// Synchronous validation keeps the editor open, so the same grid-owned frame becomes the error
// indicator. Keep the complete border shorthand present in both states: adding/removing only the
// `borderColor` longhand makes the browser fall back to `currentColor` (black) when the error clears.
const HOST_EDITING_BORDER = "1px solid #2563eb";
const HOST_ERROR_BORDER = "1px solid #dc2626";

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
  // EXPLICIT commit (the user actively saving from inside the editor) — exposed to editors as `ctx.commit`.
  commit: () => void;
  // IMPLICIT commit (focus left the editor: blur / outside-click) — discards an invalid draft.
  commitImplicit: () => void;
  cancel: () => void;
  commitAndMove: (dir: Direction) => void;
  // Consumer styles are merged over the default editor frame.
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
    commitImplicit,
    cancel,
    commitAndMove,
    editorClassName,
    editorStyle,
  } = props;

  const edit = useSyncExternalStore(editStore.subscribe, editStore.getSnapshot);
  const cell = edit.status === "idle" ? null : edit.cell;
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Latest IMPLICIT commit, read by the outside-click listener below (props are fresh closures each
  // render). Outside-click is a focus-leaving trigger, so it discards an invalid draft (not `commit`).
  const commitImplicitRef = useRef(commitImplicit);
  useEffect(() => {
    commitImplicitRef.current = commitImplicit;
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
        Math.max(rect.height, view.clientHeight - rect.height)
      );
      // Horizontal clamp only matters for the center zone; frozen columns are pinned to their band.
      const x =
        geom.placement(columnId)?.zone === "center"
          ? clamp(
              rect.x,
              view.leftBand,
              Math.max(
                view.leftBand,
                view.clientWidth - view.rightTotal - rect.width
              )
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

  // Capture outside clicks before grid selection. Custom editor popups must render inside this host
  // or their clicks will implicitly commit the edit.
  useEffect(() => {
    if (rowIndex == null || columnId == null) return;
    const onDown = (e: PointerEvent) => {
      const host = hostRef.current;
      const t = e.target;
      if (host && t instanceof Node && !host.contains(t))
        commitImplicitRef.current();
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
  const hasError = status === "error";

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
        onBlur={commitImplicit}
      />
    );
  }

  return createPortal(
    // Frame (default + validation state) ← editorStyle (integrator override) ← position
    // (grid-owned, always wins). `data-invalid` lets a styled host supply its own error treatment.
    <div
      ref={hostRef}
      className={editorClassName}
      style={{
        ...HOST_FRAME,
        border: hasError ? HOST_ERROR_BORDER : HOST_EDITING_BORDER,
        ...editorStyle,
        ...HOST_POSITION,
      }}
      data-editing=""
      data-invalid={hasError ? "" : undefined}
    >
      {content}
    </div>,
    document.body
  );
}
