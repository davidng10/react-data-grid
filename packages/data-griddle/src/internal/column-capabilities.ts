import type { CellRenderContext, Column } from "../core/types";

export interface ResolvedColumnCapabilities<T> {
  selectable: boolean;
  editable: boolean | ((ctx: CellRenderContext<T>) => boolean);
  resizable: boolean;
  reorderable: boolean;
  reorderBarrier: boolean;
}

/** Resolve the fixed action contract and the explicit capabilities of a normal column. */
export function resolveColumnCapabilities<T>(
  column: Column<T>
): ResolvedColumnCapabilities<T> {
  if (column.type === "action") {
    return {
      selectable: false,
      editable: false,
      resizable: false,
      reorderable: false,
      reorderBarrier: true,
    };
  }

  return {
    selectable: column.selectable !== false,
    editable: column.editable ?? false,
    resizable: column.resizable !== false,
    reorderable: column.reorderable !== false,
    reorderBarrier: column.reorderBarrier === true,
  };
}
