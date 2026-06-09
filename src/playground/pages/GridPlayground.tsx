import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { makeColumns, makeRows, STRESS, type DemoColumn } from "../fixtures";
import { DataGrid, type GridStats, type FrozenZone } from "../../data-grid";
import { PerfOverlay } from "../PerfOverlay";
import { ControlPanel } from "../ControlPanel";

const MAX_FREEZE_PER_SIDE = 4;

export function GridPlayground() {
  const rows = useMemo(() => makeRows(STRESS.rows), []);
  const baseColumns = useMemo(() => makeColumns(STRESS.cols), []);

  // Control-panel state (demo only).
  const [rowSelection, setRowSelection] = useState(true);
  const [freezeLeft, setFreezeLeft] = useState(1);
  const [freezeRight, setFreezeRight] = useState(1);
  const [rowHeight, setRowHeight] = useState(32);

  // Apply the freeze flags onto the columns (the grid is controlled — the consumer owns columns,
  // R3). Accessors are reused from baseColumns, so this is a cheap re-map, not a regeneration.
  const columns = useMemo<DemoColumn[]>(
    () =>
      baseColumns.map((c, i) => {
        let frozen: FrozenZone | undefined;
        if (i < freezeLeft) frozen = "left";
        else if (i >= STRESS.cols - freezeRight) frozen = "right";
        return { ...c, frozen };
      }),
    [baseColumns, freezeLeft, freezeRight],
  );

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
        <Link to="/" style={{ fontSize: 13, color: "#4f46e5", textDecoration: "none" }}>
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
          PHASE 5 · selection ({STRESS.rows.toLocaleString()}×{STRESS.cols.toLocaleString()})
        </span>
      </header>

      <div style={{ flex: "none" }}>
        <ControlPanel
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          freezeLeft={freezeLeft}
          onFreezeLeftChange={setFreezeLeft}
          freezeRight={freezeRight}
          onFreezeRightChange={setFreezeRight}
          rowHeight={rowHeight}
          onRowHeightChange={setRowHeight}
          maxFreeze={MAX_FREEZE_PER_SIDE}
        />
      </div>

      {/* minHeight:0 lets the flex child shrink so the inner scroll container can own overflow */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          rowHeight={rowHeight}
          enableRowSelection={rowSelection}
          statsRef={statsRef}
        />
      </div>

      <PerfOverlay getStats={() => statsRef.current} />
    </div>
  );
}
