"use client";

import { useRef, useState } from "react";
import { DataGrid } from "data-griddle";

import type { CellEditContext, Column, DataGridHandle } from "data-griddle";

type Row = { id: number; name: string; status: string };
function StatusEditor({ ctx }: { ctx: CellEditContext<Row> }) {
  return (
    <div>
      <input
        autoFocus
        aria-label="Status draft"
        value={String(ctx.draft)}
        onChange={(e) => ctx.setDraft(e.target.value)}
      />
      <div role="group" aria-label="Suggestions">
        <button onClick={() => ctx.setDraft("Away")}>Use Away</button>
        <button onClick={ctx.commit}>Save status</button>
        <button onClick={ctx.cancel}>Cancel status</button>
      </div>
    </div>
  );
}
export default function Example() {
  const [rows, setRows] = useState<Row[]>(
    Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: `Person ${i + 1}`,
      status: "Available",
    }))
  );
  const [loading, setLoading] = useState(false);
  const ref = useRef<DataGridHandle>(null);
  const columns: Column<Row>[] = [
    {
      id: "name",
      name: "Name",
      width: 200,
      accessor: (row) => row.name,
      editable: true,
      frozen: "left",
    },
    {
      id: "status",
      name: "Status",
      accessor: (row) => row.status,
      editable: true,
      renderEditor: (ctx) => <StatusEditor ctx={ctx} />,
    },
  ];
  // These callbacks and accessors live inside this client boundary.
  return (
    <>
      <h1>Packed consumer</h1>
      <p>Server-rendered explanation outside the virtual grid.</p>
      <button
        onClick={() => ref.current?.focusCell({ rowId: 80, columnId: "name" })}
      >
        Focus row 80
      </button>
      <button
        onClick={() => ref.current?.focusCell({ rowId: 1, columnId: "name" })}
      >
        Focus first
      </button>
      <button onClick={() => setLoading((v) => !v)}>Toggle loading</button>
      <button onClick={() => setRows([])}>Empty rows</button>
      <div style={{ height: 320, width: 640, maxWidth: "100%" }}>
        <DataGrid
          ref={ref}
          aria-label="Consumer grid"
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          enableRowSelection
          loading={loading}
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
      <div style={{ height: 100 }}>
        <DataGrid
          aria-label="Initial loading grid"
          rows={null}
          columns={columns}
          getRowId={(row) => row.id}
          loading
        />
      </div>
    </>
  );
}
