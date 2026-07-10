import { useCallback, useMemo, useRef, useState } from "react";
import { Button, Select } from "antd";

import { DataGrid, cellKey } from "../../data-grid";
import { ControlPanel } from "../ControlPanel";
import { PerfOverlay } from "../PerfOverlay";
import { STRESS, WORDS, makeColumns, makeRows } from "../fixtures";

import type {
  CellCommit,
  CellKey,
  ColumnId,
  FrozenZone,
  GridStats,
} from "../../data-grid";
import type { DemoColumn, DemoRow } from "../fixtures";

const MAX_FREEZE_PER_SIDE = 4;

// Demo-only: AntD lives ONLY here (a devDependency), never in the grid. The grid stays headless —
// this column proves the `renderEdit` override path with a real third-party component.
const WORD_OPTIONS = WORDS.map((w) => ({ label: w, value: w }));

// The two columns we make editable in the demo.
const TEXT_COL = "c2"; // default floating text editor (zero-dep)
const SELECT_COL = "c1"; // AntD Select via renderEdit (override path)

// A frozen-right "actions" column. `type: "action"` makes its cells NON-selectable (the grid skips
// them for pointer + keyboard), so the AntD Button inside handles its own clicks — no
// stopPropagation/preventDefault wiring needed. Content lives in `renderRead`.
const ACTIONS_COLUMN: DemoColumn = {
  id: "actions",
  name: "Actions",
  width: 96,
  frozen: "right",
  type: "action",
  accessor: () => "",
  renderRead: () => (
    <div style={{ display: "flex", alignItems: "center", height: "100%" }}>
      <Button
        size="small"
        type="link"
        onClick={() => {
          window.alert("Action clicked");
        }}
      >
        Action
      </Button>
    </div>
  ),
};

export function GridPlayground() {
  const rows = useMemo(() => makeRows(STRESS.rows), []);
  const baseColumns = useMemo(() => makeColumns(STRESS.cols), []);

  // Control-panel state (demo only).
  const [rowSelection, setRowSelection] = useState(true);
  const [freezeLeft, setFreezeLeft] = useState(1);
  const [freezeRight, setFreezeRight] = useState(1);
  const [rowHeight, setRowHeight] = useState(32);

  // Controlled column order (R3/P7) — the grid holds no internal order state, so a drag-reorder
  // only sticks because we store the emitted id list and feed it back. `undefined` = the columns'
  // natural order; the grid sorts WITHIN each frozen zone by this list.
  const [columnOrder, setColumnOrder] = useState<ColumnId[] | undefined>(
    undefined
  );

  // The parent-owned, authoritative edit store (R4): a sparse override map keyed by stable
  // RowId:ColumnId. The grid never mutates row data — committed values land here and flow back in
  // through the editable columns' `accessor. This override state exist because the synthetic data is generated.
  const [overrides, setOverrides] = useState<Map<CellKey, string>>(
    () => new Map()
  );

  // Fake async commit (R4): ~700ms, ~30% rejection, so the demo exercises submitting + error +
  // retry. On success, write the override; the column re-derives and the body shows the new value.
  const onCellCommit = useCallback(async (u: CellCommit<DemoRow>) => {
    await new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        if (Math.random() < 0.4)
          reject(new Error("Random save failure — retry"));
        else resolve();
      }, 700);
    });
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(cellKey(u.rowId, u.columnId), String(u.nextValue));
      return next;
    });
  }, []);

  // Apply freeze flags (R3) + make two columns editable. Re-derived when `overrides` changes so a
  // committed value surfaces through the editable columns' accessor.
  const columns = useMemo<DemoColumn[]>(
    () => [
      ...baseColumns.map((c, i): DemoColumn => {
        let frozen: FrozenZone | undefined;
        if (i < freezeLeft) frozen = "left";
        else if (i >= STRESS.cols - freezeRight) frozen = "right";
        const base: DemoColumn = { ...c, frozen };

        if (c.id === TEXT_COL) {
          return {
            ...base,
            name: "Score 10–100 (text ✎)",
            editable: true,
            // Resting values are numeric strings IN range, so the synchronous `validate` below only
            // ever trips on a draft the user actually types — pre-existing data never traps them
            // (validation runs only on a real change, against the parsed value).
            accessor: (row) =>
              overrides.get(cellKey(row.id, TEXT_COL)) ??
              String(10 + (row.id % 91)),
            // Synchronous cell validation (D4): reject anything that isn't a number in [10, 100]. On
            // an explicit save (Enter/Tab) the default editor stays open with a red border + this
            // message; a click-away (blur / outside-click) discards the invalid draft instead.
            validate: (v) => {
              const n = Number(v);
              return Number.isFinite(n) && n >= 10 && n <= 100
                ? null
                : "Must be a number from 10 to 100";
            },
          };
        }
        if (c.id === SELECT_COL) {
          return {
            ...base,
            name: "Word (AntD ✎)",
            editable: true,
            type: "select",
            options: WORD_OPTIONS,
            accessor: (row) =>
              overrides.get(cellKey(row.id, SELECT_COL)) ?? c.accessor(row),
            // Override editor: a real AntD Select. The grid supplies draft/commit/cancel/status;
            // AntD supplies the UI.
            renderEdit: (ctx) => (
              <Select
                autoFocus
                defaultOpen
                // Borderless + fill: the grid's editor host provides the panel frame (border/shadow/
                // bg), so the Select renders transparently into it — no double border, no clashing
                // chrome. Style the panel itself via the grid's `editorStyle`/`editorClassName`.
                variant="borderless"
                // Render the dropdown INSIDE the editor host (not AntD's default body portal) so it
                // (a) scrolls with the floating editor and (b) counts as "inside" for the grid's
                // outside-click-to-close. This is the integrator's contract for popup editors (R7).
                getPopupContainer={(node) =>
                  node.parentElement ?? document.body
                }
                style={{ width: 200 }}
                value={
                  ctx.draft == null || ctx.draft === ""
                    ? undefined
                    : String(ctx.draft)
                }
                status={ctx.status === "error" ? "error" : undefined}
                disabled={ctx.status === "submitting"}
                options={WORD_OPTIONS}
                onChange={(v) => {
                  ctx.setDraft(v);
                  ctx.commit();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") ctx.cancel();
                }}
              />
            ),
          };
        }
        return base;
      }),
      ACTIONS_COLUMN, // always frozen-right, last position
    ],
    [baseColumns, freezeLeft, freezeRight, overrides]
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
          ({STRESS.rows.toLocaleString()}×{STRESS.cols.toLocaleString()})
        </span>
        <span style={{ fontSize: 11, color: "#78716c" }}>
          drag a column header to reorder (within its frozen zone) · Enter/click
          “Score” or “Word” to edit · “Score” must be 10–100 · Esc cancels
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
          columnOrder={columnOrder}
          onColumnOrderChange={setColumnOrder}
          onCellCommit={onCellCommit}
          statsRef={statsRef}
        />
      </div>

      <PerfOverlay getStats={() => statsRef.current} />
    </div>
  );
}
