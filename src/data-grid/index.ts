// Public entry for the data grid (shadcn-registry item). Consumers import from here:
//
//   import { DataGrid, type Column } from "@/components/data-grid"
//
// The grid is headless + unstyled (D7); everything under `core/` is the plain-TS engine (D1)
// and is re-exported below as the public schema/contract. Internals (the selection store, the
// pure geometry) are intentionally NOT re-exported — consumers own the folder and can import
// them directly if they need to, but they aren't part of the intended surface.

export { DataGrid } from './data-grid'
export type { DataGridProps, GridStats } from './data-grid'

// The schema / public contract (D2/D3/D4/D6/D7): Column, CellCoord, GridSelection, cellKey, …
export * from './core/types'
