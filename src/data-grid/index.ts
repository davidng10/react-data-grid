// Public entry for the data grid (shadcn-registry item). Consumers import from here:
//
//   import { DataGrid, type Column } from "@/components/data-grid"
//
// Core types are public. Stores and geometry helpers remain implementation details.

export { DataGrid } from './data-grid'
export type { DataGridProps, GridStats } from './data-grid'

export * from './core/types'
