"use client";

import { useState } from "react";
import { DataGrid } from "data-griddle";

import type { Column } from "data-griddle";

type Person = { id: number; name: string; role: string };
export function BasicExample() {
  const [rows, setRows] = useState<Person[]>([
    { id: 1, name: "Ada", role: "Engineer" },
    { id: 2, name: "Lin", role: "Designer" },
    { id: 3, name: "Sam", role: "Researcher" },
  ]);
  const columns: Column<Person>[] = [
    {
      id: "name",
      name: "Name",
      accessor: (row) => row.name,
      width: 220,
      editable: true,
    },
    { id: "role", name: "Role", accessor: (row) => row.role, editable: true },
  ];
  return (
    <div style={{ height: "100dvh" }}>
      <DataGrid
        aria-label="People example"
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        enableRowSelection
        onCellCommit={({ rowId, columnId, nextValue }) =>
          setRows((current) =>
            current.map((row) =>
              row.id === rowId ? { ...row, [columnId]: String(nextValue) } : row
            )
          )
        }
      />
    </div>
  );
}
