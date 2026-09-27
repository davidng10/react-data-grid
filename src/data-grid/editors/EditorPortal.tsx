// Renders the active editor in a body portal so virtualization cannot unmount it and grid overflow
// cannot clip it. The host is repositioned imperatively during scrolling to avoid cell re-renders.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { cellViewportRect } from "../core/selection/geometry";
import { useEditorTheme } from "../hooks/useEditorTheme";
import { FloatingTextEditor, NativeSelectEditor } from "./FloatingTextEditor";

import type { ReactNode, RefObject } from "react";
import type {
  Direction,
  GridGeometry,
  ViewportInfo,
} from "../core/selection/geometry";
import type { EditStore } from "../core/store/edit-store";
import type { CellEditContext, Column, EditStatus, RowId } from "../core/types";

export interface EditorPortalProps<T> {
  frameRef: RefObject<HTMLDivElement | null>;
  loading: boolean;
  editStore: EditStore;
  scrollRef: { current: HTMLDivElement | null };
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowIndexById: ReadonlyMap<RowId, number>;
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
}

export function EditorPortal<T>(props: EditorPortalProps<T>) {
  const {
    loading,
    editStore,
    scrollRef,
    columns,
    rows,
    rowIndexById,
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
  } = props;

  const edit = useSyncExternalStore(editStore.subscribe, editStore.getSnapshot);
  const editRowIndex =
    edit.status === "idle"
      ? undefined
      : edit.rowId == null
        ? edit.cell.rowIndex
        : rowIndexById.get(edit.rowId);
  const cell =
    edit.status === "idle" || editRowIndex == null
      ? null
      : { ...edit.cell, rowIndex: editRowIndex };
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const attachHost = useCallback((element: HTMLDivElement | null) => {
    hostRef.current = element;
    setHost(element);
  }, []);
  // Hidden text has no measurable scroll height; resnapshot and measure on resume.
  useEditorTheme(props.frameRef, loading ? null : host);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Remember editor focus across display:none. External focus always wins over restoration.
  useLayoutEffect(() => {
    const onFocus = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        event.target !== document.body &&
        event.target !== restoreFocusRef.current &&
        !hostRef.current?.contains(event.target)
      ) {
        restoreFocusRef.current = null;
      }
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);
  useLayoutEffect(() => {
    const target = restoreFocusRef.current;
    if (
      !loading &&
      target &&
      hostRef.current?.contains(target) &&
      document.activeElement === document.body
    ) {
      target.focus({ preventScroll: true });
    }
  }, [loading, editRowIndex]);
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
    if (loading || rowIndex == null || columnId == null) return;
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
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const availableWidth = viewport?.width ?? window.innerWidth;
      const availableHeight = viewport?.height ?? window.innerHeight;
      host.style.maxWidth = `${availableWidth}px`;
      host.style.maxHeight = `${availableHeight}px`;
      const hostWidth = Math.min(
        host.getBoundingClientRect().width || rect.width,
        availableWidth
      );
      const hostHeight = Math.min(
        host.getBoundingClientRect().height || rect.height,
        availableHeight
      );
      host.style.transform = `translate(${clamp(origin.left + x, left, left + availableWidth - hostWidth)}px, ${clamp(origin.top + y, top, top + availableHeight - hostHeight)}px)`;
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
    window.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", onScroll);
    window.visualViewport?.addEventListener("scroll", onScroll);
    const observer = new ResizeObserver(onScroll);
    if (hostRef.current) observer.observe(hostRef.current);
    observer.observe(scroller);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", onScroll);
      window.visualViewport?.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [
    loading,
    rowIndex,
    columnId,
    geom,
    gutterW,
    leftBand,
    rightTotal,
    scrollRef,
  ]);

  // Capture outside clicks before grid selection. Custom editor popups must render inside this host
  // or their clicks will implicitly commit the edit.
  useEffect(() => {
    if (loading || rowIndex == null || columnId == null) return;
    const onDown = (e: PointerEvent) => {
      const host = hostRef.current;
      const t = e.target;
      if (host && t instanceof Node && !host.contains(t))
        commitImplicitRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [loading, rowIndex, columnId]);

  if (edit.status === "idle") return null;
  if (typeof document === "undefined") return null;

  const column = columns.find((c) => c.id === edit.cell.columnId);
  const row = cell == null ? undefined : rows[cell.rowIndex];
  if (!column || row == null || !cell) {
    if (loading) return null;
    return (
      <div className="dgr-draft-notice" role="status">
        <span>
          The edited cell is unavailable. Your draft is preserved until it
          returns.
        </span>
        <button className="dgr-draft-discard" type="button" onClick={cancel}>
          Discard draft
        </button>
      </div>
    );
  }

  const placement = geom.placement(cell.columnId);
  const width = placement?.width ?? 140;
  const status = edit.status as EditStatus;
  const hasError = status === "error";

  const ctx: CellEditContext<T> = {
    row,
    rowId: getRowId(row, cell.rowIndex),
    rowIndex: cell.rowIndex,
    column,
    columnId: column.id,
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
  if (column.renderEditor) {
    content = column.renderEditor(ctx);
  } else if (column.type === "select") {
    content = (
      <NativeSelectEditor
        label={`${column.name}, row ${cell.rowIndex + 1}`}
        api={ctx}
        width={width}
        options={column.options ?? []}
        onEscape={cancel}
      />
    );
  } else {
    content = (
      <FloatingTextEditor
        label={`${column.name}, row ${cell.rowIndex + 1}`}
        api={ctx}
        width={width}
        rowHeight={rowHeight}
        onEnter={() => commitAndMove("down")}
        onTab={(backward) => commitAndMove(backward ? "left" : "right")}
        onEscape={cancel}
      />
    );
  }

  return createPortal(
    <div
      className="dgr-editor-host"
      ref={attachHost}
      onBlur={(event) => {
        if (column.renderEditor || loading) return;
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        commitImplicit();
      }}
      onFocusCapture={(event) => {
        restoreFocusRef.current = event.target as HTMLElement;
      }}
      style={{ display: loading ? "none" : undefined }}
      inert={loading || undefined}
      aria-hidden={loading || undefined}
      data-default-editor={!column.renderEditor || undefined}
      data-editing=""
      data-invalid={hasError ? "" : undefined}
    >
      {content}
      {!column.renderEditor && (
        <div
          className="dgr-editor-actions"
          onPointerDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={commit}>
            Save edit
          </button>
          <button type="button" onClick={cancel}>
            Cancel edit
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}
