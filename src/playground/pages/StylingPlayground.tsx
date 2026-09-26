import { useEffect, useRef, useState } from "react";

import { DataGrid } from "../../data-grid";

import type { CSSProperties } from "react";
import type { CellEditContext, Column } from "../../data-grid";

import "./styling-playground.css";

type Entry = {
  id: number;
  name: string;
  amount: number;
  note: string;
  status: string;
};
const ENTRIES: Entry[] = Array.from({ length: 1000 }, (_, i) => ({
  id: i + 1,
  name:
    ["Studio North", "Fieldwork", "Common Ground", "Forma"][i % 4] +
    ` ${i + 1}`,
  amount: i % 3 === 0 ? -125 - i : 240 + i * 17,
  note:
    "Quarterly studio supplies · reference " +
    String(i + 1).padStart(5, "0") +
    " · long text stays within the calculated cell width",
  status: i % 2 ? "Review" : "Ready",
}));
const getRowId = (row: Entry) => row.id;
function StatusEditor({ ctx }: { ctx: CellEditContext<Entry> }) {
  return (
    <div className="styling-custom-editor" style={{ minWidth: ctx.width }}>
      <label>
        Status{" "}
        <select
          autoFocus
          value={String(ctx.draft)}
          onChange={(e) => ctx.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") ctx.cancel();
          }}
        >
          <option>Ready</option>
          <option>Review</option>
        </select>
      </label>
      <button onClick={ctx.commit}>Save</button>
      <button onClick={ctx.cancel}>Cancel</button>
    </div>
  );
}
const COLUMNS: Column<Entry>[] = [
  {
    id: "name",
    name: "Account",
    width: 165,
    frozen: "left",
    accessor: (r) => r.name,
    editable: true,
    validate: (v) => (String(v).trim() ? null : "Enter an account name"),
  },
  {
    id: "amount",
    name: "Balance",
    width: 120,
    accessor: (r) => r.amount,
    editable: true,
    parseValue: Number,
    validate: (v) => (Number.isFinite(v) ? null : "Enter a number"),
    cellClassName: (ctx) =>
      Number(ctx.value) < 0 ? "styling-negative" : undefined,
    headerClassName: "styling-number-heading",
  },
  {
    id: "note",
    name: "Details",
    width: 330,
    accessor: (r) => r.note,
    editable: true,
  },
  {
    id: "delta",
    name: "Change",
    width: 120,
    frozen: "right",
    accessor: (r) => r.amount,
    cellClassName: (ctx) =>
      Number(ctx.value) < 0 ? "styling-negative" : undefined,
  },
  {
    id: "status",
    name: "Status",
    width: 115,
    accessor: (r) => r.status,
    editable: true,
    renderEditor: (ctx) => <StatusEditor ctx={ctx} />,
  },
];

function ThemeExample({
  initialDark,
  id,
}: {
  initialDark: boolean;
  id: string;
}) {
  const [dark, setDark] = useState(initialDark);
  const [rows, setRows] = useState<readonly Entry[] | null>(ENTRIES);
  const [loading, setLoading] = useState(false);
  const [height, setHeight] = useState(32);
  const [fontSize, setFontSize] = useState(13);
  const [family, setFamily] = useState("system-ui, sans-serif");
  const [saveMode, setSaveMode] = useState("immediate");
  const [override, setOverride] = useState(false);
  const [message, setMessage] = useState("Double-click a cell to edit.");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    []
  );
  function later(action: () => void) {
    timers.current.push(setTimeout(action, 2500));
  }
  const themeStyle = {
    "--dgr-font-size": `${fontSize}px`,
    "--dgr-font-family": family,
    ...(override ? { "--dgr-editor-background": "#305c47" } : {}),
  } as CSSProperties;
  return (
    <section
      className={`styling-example ${dark ? "demo-dark" : "demo-light"}`}
      style={themeStyle}
      aria-label={`${id} theme example`}
    >
      <div className="styling-example-title">
        <h2>{id === "day" ? "Day ledger" : "Night ledger"}</h2>
        <span>
          {dark ? "Dark" : "Light"} / {rows?.length ?? "—"} rows
        </span>
      </div>
      <div className="styling-controls">
        <button
          onClick={() => {
            setRows(null);
            setLoading(true);
          }}
        >
          Initial load
        </button>
        <button onClick={() => setLoading(true)}>Refresh</button>
        <button
          onClick={() => {
            setRows(ENTRIES);
            setLoading(false);
          }}
        >
          Show rows
        </button>
        <button
          onClick={() => {
            setRows([]);
            setLoading(false);
          }}
        >
          Empty
        </button>
        <button onClick={() => setLoading(false)}>Finish</button>
        <button
          onClick={() => {
            setMessage("Theme will switch in 2.5 seconds. Open an editor.");
            later(() => {
              setDark((v) => !v);
              setMessage("Theme changed.");
            });
          }}
        >
          Switch theme in 2.5s
        </button>
        <button
          onClick={() => {
            setMessage("Text size will change in 2.5 seconds. Open an editor.");
            later(() => {
              setFontSize((value) => (value === 13 ? 17 : 13));
              setMessage("Text size changed.");
            });
          }}
        >
          Resize text in 2.5s
        </button>
        <button
          onClick={() => {
            setMessage("Editor tint will toggle in 2.5 seconds.");
            later(() => {
              setOverride((v) => !v);
              setMessage("Editor tint toggled.");
            });
          }}
        >
          Toggle tint in 2.5s
        </button>
        <button
          onClick={() => {
            setMessage("Refresh will begin in 2.5 seconds.");
            later(() => {
              setLoading(true);
              later(() => {
                setLoading(false);
                setMessage("Refresh finished.");
              });
            });
          }}
        >
          Refresh in 2.5s
        </button>
      </div>
      <div className="styling-controls styling-settings">
        <label>
          Row height{" "}
          <select
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          >
            {[24, 32, 44].map((v) => (
              <option key={v} value={v}>
                {v}px
              </option>
            ))}
          </select>
        </label>
        <label>
          Text size{" "}
          <select
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          >
            {[12, 13, 17].map((v) => (
              <option key={v} value={v}>
                {v}px
              </option>
            ))}
          </select>
        </label>
        <label>
          Typeface{" "}
          <select value={family} onChange={(e) => setFamily(e.target.value)}>
            <option value="system-ui, sans-serif">System</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="monospace">Mono</option>
          </select>
        </label>
        <label>
          Save{" "}
          <select
            value={saveMode}
            onChange={(e) => setSaveMode(e.target.value)}
          >
            <option value="immediate">Immediate</option>
            <option value="pending">Delay 3s</option>
            <option value="fail">Fail after 3s</option>
          </select>
        </label>
      </div>
      <div className="styling-grid-wrap">
        <DataGrid
          id={`styling-${id}`}
          className="styling-grid"
          aria-label={`${id} accounts`}
          columns={COLUMNS}
          rows={rows}
          loading={loading}
          rowHeight={height}
          getRowId={getRowId}
          enableRowSelection
          onCellCommit={async ({ rowId, columnId, nextValue }) => {
            if (saveMode !== "immediate")
              await new Promise((resolve) => setTimeout(resolve, 3000));
            if (saveMode === "fail") throw new Error("Demo save failed");
            setRows(
              (current) =>
                current?.map((row) =>
                  row.id === rowId ? { ...row, [columnId]: nextValue } : row
                ) ?? null
            );
          }}
        />
      </div>
      <p className="styling-caption" aria-live="polite">
        {message}
      </p>
    </section>
  );
}

export function StylingPlayground() {
  return (
    <main className="styling-demo">
      <header className="styling-intro">
        <nav>
          <a href="/">Large grid</a>
          <a href="/loading">Loading</a>
          <a href="/styling-check.html">Without a reset</a>
        </nav>
        <p className="styling-kicker">DATA GRIDDLE / STYLING LAB</p>
        <h1>One grid. Two points of view.</h1>
        <p>
          Independent themes, the same interactions. Edit a balance, scroll the
          ledger, or change the light while an editor is open.
        </p>
      </header>
      <div className="styling-comparison">
        <ThemeExample id="day" initialDark={false} />
        <ThemeExample id="night" initialDark />
      </div>
      <footer className="styling-footer">
        Negative balances use conditional classes. Row height controls density;
        text size changes typography. Scroll sideways for the custom Status
        editor.
      </footer>
    </main>
  );
}
