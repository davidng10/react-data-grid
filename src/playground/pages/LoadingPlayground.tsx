import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { DataGrid } from "../../data-grid";

import type { Column } from "../../data-grid";

import "./loading-playground.css";

interface Person {
  id: number;
  name: string;
  team: string;
  location: string;
  email: string;
  status: string;
}

const PEOPLE: Person[] = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name:
    ["Ada Chen", "Jonah Reed", "Maya Patel", "Theo Park", "Leah Tan"][i % 5] +
    ` ${i + 1}`,
  team: ["Engineering", "Design", "Operations"][i % 3],
  location: ["Singapore", "London", "New York"][i % 3],
  email: `person${i + 1}@example.com`,
  status: i % 4 === 0 ? "Away" : "Available",
}));
const COLUMNS: Column<Person>[] = [
  {
    id: "name",
    name: "Name",
    width: 190,
    frozen: "left",
    accessor: (r) => r.name,
    editable: true,
  },
  { id: "team", name: "Team", width: 180, accessor: (r) => r.team },
  { id: "location", name: "Location", width: 180, accessor: (r) => r.location },
  { id: "email", name: "Email", width: 250, accessor: (r) => r.email },
  { id: "id", name: "Member ID", width: 140, accessor: (r) => r.id },
  {
    id: "status",
    name: "Status",
    width: 130,
    frozen: "right",
    accessor: (r) => r.status,
  },
];
const getRowId = (row: Person) => row.id;

export function LoadingPlayground() {
  const [rows, setRows] = useState<readonly Person[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [delay, setDelay] = useState(1600);
  const [custom, setCustom] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextRows = useRef<readonly Person[]>(PEOPLE);

  const finish = () => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
    setRows(nextRows.current);
    setLoading(false);
  };

  useEffect(() => {
    timer.current = setTimeout(() => {
      setRows(PEOPLE);
      setLoading(false);
      timer.current = null;
    }, 1600);
    return () => {
      if (timer.current != null) clearTimeout(timer.current);
      if (refreshTimer.current != null) clearTimeout(refreshTimer.current);
    };
  }, []);

  const request = (next: readonly Person[], initial = false) => {
    if (timer.current != null) clearTimeout(timer.current);
    nextRows.current = next;
    if (initial) setRows(null);
    setLoading(true);
    timer.current = delay > 0 ? setTimeout(finish, delay) : null;
  };

  return (
    <main className="loading-demo">
      <header>
        <Link to="/">← Large grid playground</Link>
        <h1>Loading, without losing your place.</h1>
        <p>
          Skeletons for the first result. A quiet overlay while existing data
          updates.
        </p>
      </header>
      <div className="loading-demo-controls">
        <button onClick={() => request(PEOPLE, true)}>Initial load</button>
        <button onClick={() => request(rows ?? PEOPLE)}>Refresh</button>
        <button
          onClick={() => {
            if (refreshTimer.current != null)
              clearTimeout(refreshTimer.current);
            refreshTimer.current = setTimeout(
              () => request(rows ?? PEOPLE),
              3000
            );
          }}
        >
          Refresh in 3s
        </button>
        <button onClick={() => request([...(rows ?? PEOPLE)].reverse())}>
          Reverse order
        </button>
        <button onClick={() => request([])}>Empty result</button>
        <button onClick={() => request(PEOPLE)}>Load people</button>
        <button
          onClick={() => {
            if (timer.current != null) clearTimeout(timer.current);
            timer.current = null;
            setRows(null);
            setLoading(false);
          }}
        >
          Idle
        </button>
        <label>
          Delay{" "}
          <select
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
          >
            <option value={1600}>1.6 seconds</option>
            <option value={4000}>4 seconds</option>
            <option value={0}>Manual finish</option>
          </select>
        </label>
        <button disabled={!loading} onClick={finish}>
          Finish now
        </button>
        <label>
          <input
            type="checkbox"
            checked={custom}
            onChange={(e) => setCustom(e.target.checked)}
          />{" "}
          Custom indicator
        </label>
      </div>
      <div className="loading-demo-caption">
        <span>
          {loading
            ? "Fetching…"
            : rows == null
              ? "Ready to request data"
              : `${rows.length} people`}
        </span>
        <span>
          Scroll in both directions. Click a name, then press Enter to edit.
        </span>
      </div>
      <div className="loading-demo-grid">
        <DataGrid
          rows={rows}
          loading={loading}
          columns={COLUMNS}
          getRowId={getRowId}
          aria-label="People"
          enableRowSelection
          loadingIndicator={
            custom ? (
              <span className="loading-demo-custom">Updating people…</span>
            ) : undefined
          }
          emptyContent={
            <div>
              <strong>No matching people</strong>
              <br />
              Try loading the people list again.
            </div>
          }
          onCellCommit={({ rowId, nextValue }) => {
            setRows(
              (current) =>
                current?.map((row) =>
                  row.id === rowId ? { ...row, name: String(nextValue) } : row
                ) ?? null
            );
          }}
        />
      </div>
    </main>
  );
}
