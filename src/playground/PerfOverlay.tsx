import { useFps } from './useFps'

interface PerfOverlayProps {
  rows?: number
  cols?: number
  /** Cells actually mounted in the DOM right now (set once virtualization exists). */
  renderedCells?: number
}

function fpsColor(fps: number): string {
  if (fps >= 50) return '#16a34a'
  if (fps >= 30) return '#ca8a04'
  return '#dc2626'
}

/**
 * Live perf meter (DECISIONS.md harness). Owns useFps so only this leaf re-renders at 4 Hz.
 * Pass row/col/rendered-cell counts from the grid once they exist.
 */
export function PerfOverlay({ rows, cols, renderedCells }: PerfOverlayProps) {
  const { fps, minFps, frameMs } = useFps()

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 1000,
        background: 'rgba(28,25,23,0.92)',
        color: '#fafaf9',
        font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
        padding: '10px 12px',
        borderRadius: 8,
        minWidth: 150,
        boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ opacity: 0.7 }}>FPS</span>
        <span style={{ color: fpsColor(fps), fontWeight: 700 }}>{fps}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ opacity: 0.7 }}>min (3s)</span>
        <span style={{ color: fpsColor(minFps), fontWeight: 700 }}>{minFps}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ opacity: 0.7 }}>frame</span>
        <span>{frameMs}ms</span>
      </div>
      {(rows != null || cols != null || renderedCells != null) && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
          {rows != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.7 }}>rows</span>
              <span>{rows.toLocaleString()}</span>
            </div>
          )}
          {cols != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.7 }}>cols</span>
              <span>{cols.toLocaleString()}</span>
            </div>
          )}
          {renderedCells != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.7 }}>cells</span>
              <span>{renderedCells.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
