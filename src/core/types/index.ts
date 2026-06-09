// Public type contract for the grid (Phase 1). See DECISIONS.md for the rationale behind each.

export type { RowId, ColumnId, CellCoord, CellKey } from './ids'
export { cellKey } from './ids'

export type {
  CellType,
  FrozenZone,
  SelectOption,
  CellRenderContext,
  CellEditContext,
  Column,
} from './column'

export type { CellRange, GridSelection } from './selection'
export { EMPTY_SELECTION } from './selection'

export type { EditStatus, EditState, CellCommit } from './editing'

export type {
  GridSize,
  GridClassNames,
  ExpandedRowContext,
  GridProps,
} from './grid'
