import { useMemo } from 'react'
import { Link } from 'react-router'
import { DEFAULT_COL_WIDTH, makeColumns, makeRows } from '../fixtures'
import { PerfOverlay } from '../PerfOverlay'

// Phase 0 PLACEHOLDER. This is a NAIVE, non-virtualized render — it exists only to give the
// FPS harness something real to measure and to demonstrate why virtualization is needed.
// Phase 3 replaces this with the virtualized DOM shell (the 🚦 gate in DECISIONS.md).
// Kept small on purpose: a naive 100k x 1k grid would mount 100M nodes and crash the tab.
const ROWS = 1000
const COLS = 25
const ROW_HEIGHT = 32

export function DomPlayground() {
  const rows = useMemo(() => makeRows(ROWS), [])
  const columns = useMemo(() => makeColumns(COLS), [])
  const totalWidth = useMemo(
    () => columns.reduce((sum, c) => sum + (c.width ?? DEFAULT_COL_WIDTH), 0),
    [columns],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid #e7e5e4',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flex: 'none',
        }}
      >
        <Link to="/" style={{ fontSize: 13, color: '#4f46e5', textDecoration: 'none' }}>← shells</Link>
        <strong style={{ fontSize: 14 }}>DOM shell</strong>
        <span
          style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
            background: '#fef3c7', color: '#92400e',
          }}
        >
          PHASE 0 · naive placeholder ({ROWS.toLocaleString()}×{COLS}, not virtualized)
        </span>
      </header>

      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {/* header row */}
        <div
          style={{
            display: 'flex',
            position: 'sticky',
            top: 0,
            width: totalWidth,
            background: '#f5f5f4',
            borderBottom: '1px solid #d6d3d1',
            zIndex: 1,
          }}
        >
          {columns.map((c) => (
            <div
              key={c.id}
              style={{
                width: c.width ?? DEFAULT_COL_WIDTH,
                flex: 'none',
                padding: '0 10px',
                height: ROW_HEIGHT,
                lineHeight: `${ROW_HEIGHT}px`,
                fontSize: 13,
                fontWeight: 600,
                borderRight: '1px solid #e7e5e4',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {c.name}
            </div>
          ))}
        </div>

        {/* body — naive: every cell mounted */}
        <div style={{ width: totalWidth }}>
          {rows.map((row) => (
            <div key={row.id} style={{ display: 'flex', height: ROW_HEIGHT }}>
              {columns.map((c) => (
                <div
                  key={c.id}
                  style={{
                    width: c.width ?? DEFAULT_COL_WIDTH,
                    flex: 'none',
                    padding: '0 10px',
                    lineHeight: `${ROW_HEIGHT}px`,
                    fontSize: 13,
                    borderRight: '1px solid #f0efee',
                    borderBottom: '1px solid #f0efee',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {/* Read-mode coercion: undefined type => String(value) (D4). */}
                  {String(c.accessor(row) ?? '')}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <PerfOverlay rows={ROWS} cols={COLS} renderedCells={ROWS * COLS} />
    </div>
  )
}
