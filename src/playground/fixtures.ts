// Stress fixtures for the playground.
//
// Uses the real `Column<T>` contract from core/types (Phase 1) so the fixtures double as a
// compile-time check on the schema. We need: stable row ids (D2), a push-model accessor (D3),
// and enough columns/rows to stress virtualization (100k x 1k).
//
// Memory note: we do NOT materialize 100k x 1k = 100M cell strings. Rows are tiny `{ id }`
// objects and each column's accessor computes its display value deterministically on demand.

import type { Column } from '../data-grid'

export interface DemoRow {
  id: number
}

export type DemoColumn = Column<DemoRow>

/** Width used by fixture columns and the placeholder layout when a column omits one. */
export const DEFAULT_COL_WIDTH = 140

const WORDS = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
  'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
]

/** Deterministic xorshift-ish hash so cell values are stable across renders. */
function hash(n: number): number {
  let x = n | 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}

export function makeRows(count: number): DemoRow[] {
  const rows: DemoRow[] = new Array(count)
  for (let i = 0; i < count; i++) rows[i] = { id: i }
  return rows
}

export function makeColumns(count: number): DemoColumn[] {
  const cols: DemoColumn[] = new Array(count)
  for (let c = 0; c < count; c++) {
    if (c === 0) {
      // The row-number column. Freezing is applied by the playground control panel, not here.
      cols[c] = { id: 'c0', name: '#', width: 80, accessor: (row) => String(row.id) }
      continue
    }
    const colIndex = c
    cols[c] = {
      id: `c${c}`,
      name: `Col ${c}`,
      width: DEFAULT_COL_WIDTH,
      accessor: (row) => {
        const h = hash(row.id * 1_000_003 + colIndex)
        switch (colIndex % 3) {
          case 0: return String(h % 100_000)
          case 1: return WORDS[h % WORDS.length]
          default: return `${WORDS[h % WORDS.length]}-${h % 1000}`
        }
      },
    }
  }
  return cols
}

/** The headline stress target (DECISIONS.md harness). */
export const STRESS = { rows: 100_000, cols: 1_000 } as const
