"use client";

import { useState } from "react";
import { DataGrid } from "data-griddle";

import type { Column } from "data-griddle";

type Person = { id: number; name: string; role: string };

function createPeople(): Person[] {
  const firstNames = [
    "Ada",
    "Lin",
    "Sam",
    "Maya",
    "Leo",
    "Nora",
    "Owen",
    "Priya",
    "Theo",
    "Zoe",
  ];
  const lastNames = [
    "Chen",
    "Patel",
    "Rivera",
    "Kim",
    "Morgan",
    "Tan",
    "Brooks",
    "Shah",
    "Park",
    "Reed",
  ];
  const roles = [
    "Engineer",
    "Designer",
    "Researcher",
    "Product Manager",
    "Data Analyst",
    "QA Engineer",
    "Technical Writer",
    "Customer Success",
    "Operations Manager",
    "Engineering Manager",
    "UX Researcher",
    "Solutions Architect",
  ];

  return Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    name: `${firstNames[index % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length)]}`,
    role: roles[index % roles.length],
  }));
}

export function BasicExample() {
  const [rows, setRows] = useState(createPeople);
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
    <DataGrid
      aria-label="People example"
      style={{ height: "min(600px, calc(100dvh - 48px))" }}
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
  );
}
