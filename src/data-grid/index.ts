// Public entry for the data grid (shadcn-registry item). Consumers import from here:
//
//   import { DataGrid, type Column } from "@/components/data-grid"
//
// Core types are public. Stores and geometry helpers remain implementation details.

export { DataGrid } from "./data-grid";
export type {
  CellCommit,
  CellCommitFailure,
  CellCoord,
  CellEditContext,
  CellRange,
  CellRenderContext,
  CellType,
  Column,
  ColumnId,
  DataGridProps,
  EditStatus,
  FrozenZone,
  GridSelection,
  HeaderRenderContext,
  RowId,
  SelectOption,
} from "./core/types";
