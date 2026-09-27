import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { DataGrid } from "../../data-grid";

import type {
  CellEditContext,
  Column,
  DataGridHandle,
  RowId,
  SelectionCheckboxProps,
} from "../../data-grid";

import "./loading-playground.css";

interface Person {
  id: number;
  name: string;
  status: string;
}
const PEOPLE = Array.from({ length: 200 }, (_, index) => ({
  id: index + 1,
  name: `Person ${index + 1}`,
  status: "Available",
}));

// A native button supplies Space/Enter activation; checkbox role/state supply its meaning.
function SelectionControl(props: SelectionCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-label={props["aria-label"]}
      aria-checked={props.indeterminate ? "mixed" : props.checked}
      aria-readonly={props.readOnly}
      disabled={props.disabled}
      onClick={props.onChange}
      style={{
        width: 32,
        height: 32,
        padding: 0,
        border: "1px solid #78716c",
        borderRadius: 4,
        background: props.checked ? "#dbeafe" : "white",
        color: "#1c1917",
        cursor: props.disabled ? "default" : "pointer",
      }}
    >
      <span aria-hidden="true">
        {props.indeterminate ? "−" : props.checked ? "✓" : ""}
      </span>
    </button>
  );
}

function StatusEditor({ ctx }: { ctx: CellEditContext<Person> }) {
  return (
    <div
      style={{ minWidth: ctx.width, padding: 8 }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          ctx.cancel();
        }
      }}
    >
      <input
        autoFocus
        aria-label="Status draft"
        value={String(ctx.draft)}
        onChange={(event) => ctx.setDraft(event.target.value)}
        style={{ width: "100%", font: "inherit" }}
      />
      {/* DOM containment in the host prevents outside-pointer commits, including when focus moves. */}
      <div
        role="group"
        aria-label="Status suggestions"
        style={{
          position: "absolute",
          top: "100%",
          right: 0,
          width: 180,
          padding: 8,
          background: "var(--dgr-editor-background, white)",
          border: "1px solid #78716c",
        }}
      >
        <button type="button" onClick={() => ctx.setDraft("Away")}>
          Use Away
        </button>{" "}
        <button type="button" onClick={ctx.commit}>
          Save status
        </button>
        <button type="button" onClick={ctx.cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
const COLUMNS: Column<Person>[] = [
  {
    id: "name",
    name: "Name",
    width: 160,
    frozen: "left",
    accessor: (row) => row.name,
    editable: true,
  },
  ...Array.from({ length: 12 }, (_, index): Column<Person> => ({
    id: `field${index + 1}`,
    name: `Field ${index + 1}`,
    width: 150,
    accessor: (row) => `${row.id} / ${index + 1}`,
  })),
  {
    id: "status",
    name: "Status",
    width: 160,
    frozen: "right",
    accessor: (row) => row.status,
    editable: true,
    renderEditor: (ctx) => <StatusEditor ctx={ctx} />,
  },
];

export function IntegrationPlayground() {
  const ref = useRef<DataGridHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setNarrow(element.clientWidth < 640)
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The application chooses responsive pinning; the grid never silently changes frozen props.
  const columns = useMemo(
    () =>
      narrow
        ? COLUMNS.map((column) =>
            column.id === "status"
              ? { ...column, frozen: undefined }
              : column.id === "name"
                ? { ...column, width: 120 }
                : column
          )
        : COLUMNS,
    [narrow]
  );
  const [rows, setRows] = useState(PEOPLE);
  const [selectedRowIds, setSelectedRowIds] = useState<ReadonlySet<RowId>>(
    new Set([1])
  );
  const [readOnly, setReadOnly] = useState(false);
  const [custom, setCustom] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("Ready");
  const focus = (rowId: RowId, columnId: string) => {
    const result = ref.current?.focusCell({ rowId, columnId });
    setResult(
      result?.ok
        ? `Focused ${rowId} / ${columnId}`
        : (result?.reason ?? "Unmounted")
    );
  };
  return (
    <main className="loading-demo">
      <header>
        <Link to="/">← Playground</Link>
        <h1>Integration examples</h1>
        <p>
          Custom selection controls, stable-ID focus and an editor popup inside
          its host.
        </p>
      </header>
      <div className="loading-demo-controls">
        <button onClick={() => focus(180, "field12")}>
          Focus row 180 / Field 12
        </button>
        <button onClick={() => focus(180, "name")}>Focus row 180 / Name</button>
        <button onClick={() => focus(1, "status")}>Focus row 1 / Status</button>
        <button onClick={() => setRows((current) => [...current].reverse())}>
          Reverse rows
        </button>
        <label>
          <input
            type="checkbox"
            checked={custom}
            onChange={(event) => setCustom(event.target.checked)}
          />
          Custom controls
        </label>
        <label>
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(event) => setReadOnly(event.target.checked)}
          />
          Read-only selection
        </label>
        <label>
          <input
            type="checkbox"
            checked={loading}
            onChange={(event) => setLoading(event.target.checked)}
          />
          Loading
        </label>
      </div>
      <p role="status">
        {result} · Selected rows: {selectedRowIds.size}
      </p>
      <div className="loading-demo-grid" ref={containerRef}>
        <DataGrid
          ref={ref}
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          rowHeight={44}
          aria-label="Integration people"
          loading={loading}
          enableRowSelection
          selectedRowIds={selectedRowIds}
          onSelectedRowIdsChange={readOnly ? undefined : setSelectedRowIds}
          renderSelectionCheckbox={
            custom ? (props) => <SelectionControl {...props} /> : undefined
          }
          onCellCommit={({ rowId, columnId, nextValue }) =>
            setRows((current) =>
              current.map((row) =>
                row.id === rowId
                  ? { ...row, [columnId]: String(nextValue) }
                  : row
              )
            )
          }
        />
      </div>
      <p>
        After a focus command, press Enter to edit Name or Status. Choose “Use
        Away” in the status popup, then save. Selection controls use Space;
        read-only mode disables them. Below 640px this example unpins Status and
        narrows Name to keep the center usable.
      </p>
    </main>
  );
}
