import { useMemo, useRef } from "react";
import { Link } from "react-router";
import { makeColumns, makeRows, STRESS } from "../fixtures";
import { DataGrid, type GridStats } from "../../grid/DataGrid";
import { PerfOverlay } from "../PerfOverlay";

const ROW_HEIGHT = 32;

export function GridPlayground() {
  const rows = useMemo(() => makeRows(STRESS.rows), []);
  const columns = useMemo(() => makeColumns(STRESS.cols), []);
  const statsRef = useRef<GridStats>({
    rows: STRESS.rows,
    cols: STRESS.cols,
    renderedCells: 0,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid #e7e5e4",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flex: "none",
        }}
      >
        <Link
          to="/"
          style={{ fontSize: 13, color: "#4f46e5", textDecoration: "none" }}
        >
          ← home
        </Link>
        <strong style={{ fontSize: 14 }}>Data grid</strong>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 20,
            background: "#dcfce7",
            color: "#166534",
          }}
        >
          PHASE 4 · frozen zones ({STRESS.rows.toLocaleString()}×
          {STRESS.cols.toLocaleString()})
        </span>
      </header>

      {/* minHeight:0 lets the flex child shrink so the inner scroll container can own overflow */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          rowHeight={ROW_HEIGHT}
          statsRef={statsRef}
        />
      </div>

      <PerfOverlay getStats={() => statsRef.current} />
    </div>
  );
}
