// Dependency-free text and select editors. They render transparently inside the grid-owned editor
// host; pending and failed asynchronous commits are displayed by `PendingOverlay`.

import { useId, useLayoutEffect, useRef } from "react";

import type { KeyboardEvent } from "react";
import type { EditStatus, SelectOption } from "../core/types";

export interface DefaultEditorApi {
  draft: unknown;
  setDraft: (next: unknown) => void;
  commit: () => void;
  cancel: () => void;
  status: EditStatus;
  error?: unknown;
}

/** Auto-growing text editor with spreadsheet-style Enter, Tab, and Escape behavior. */
export function FloatingTextEditor(props: {
  api: DefaultEditorApi;
  width: number;
  rowHeight: number;
  onEnter: () => void;
  onTab: () => void;
  onEscape: () => void;
  onBlur: () => void;
}) {
  const { api, width, rowHeight } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const errorId = useId();
  const value = api.draft == null ? "" : String(api.draft);
  // A rejected `validate` on an explicit save (Enter/Tab) leaves the editor open in `error`.
  const hasError = api.status === "error";

  // Focus + select-all on open, so typing replaces the existing value (spreadsheet behavior).
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.select();
  }, []);

  // Auto-resize: grow the textarea to fit its content, never below one row.
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(rowHeight, ta.scrollHeight)}px`;
  }, [value, rowHeight]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      props.onEnter();
    } else if (e.key === "Tab") {
      e.preventDefault();
      props.onTab();
    } else if (e.key === "Escape") {
      e.preventDefault();
      props.onEscape();
    }
    // Shift+Enter falls through → a newline (the textarea grows).
  };

  // Bare textarea — transparent and always borderless: it FILLS the grid-owned host panel, whose
  // single frame changes from blue to red on a validation error. The message becomes a quiet footer
  // in that panel; both states clear once the user types (`error` → `editing`).
  const maxWidth = Math.max(width * 2, 360);
  return (
    <>
      <textarea
        ref={ref}
        value={value}
        rows={1}
        spellCheck={false}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : undefined}
        onChange={(e) => api.setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => props.onBlur()}
        style={{
          display: "block",
          minWidth: width,
          maxWidth,
          boxSizing: "border-box",
          border: "none",
          outline: "none",
          resize: "none",
          padding: "5px 9px",
          font: "13px/1.4 system-ui, sans-serif",
          background: "transparent",
          color: "#1c1917",
          overflow: "hidden",
        }}
      />
      {hasError && api.error != null && (
        <div
          id={errorId}
          role="alert"
          style={{
            maxWidth,
            boxSizing: "border-box",
            padding: "4px 9px 6px",
            borderTop: "1px solid #fecaca",
            borderRadius: "0 0 3px 3px",
            font: "12px/1.4 system-ui, sans-serif",
            color: "#dc2626",
            background: "#fef2f2",
          }}
        >
          {String(api.error)}
        </div>
      )}
    </>
  );
}

/**
 * The default editor for `type: 'select'` columns — a bare native `<select>` (zero-dep, no
 * expand). Picking an option commits immediately; Escape cancels.
 */
export function NativeSelectEditor(props: {
  api: DefaultEditorApi;
  width: number;
  options: SelectOption[];
  onEscape: () => void;
}) {
  const { api, width, options } = props;
  const value = api.draft == null ? "" : String(api.draft);
  // Borderless/transparent — fills the grid-owned host panel.
  return (
    <select
      autoFocus
      value={value}
      onChange={(e) => {
        api.setDraft(e.target.value);
        api.commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          props.onEscape();
        }
      }}
      style={{
        minWidth: width,
        boxSizing: "border-box",
        padding: "4px 6px",
        font: "13px/1.4 system-ui, sans-serif",
        border: "none",
        outline: "none",
        background: "transparent",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
