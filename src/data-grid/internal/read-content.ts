import type { ReactNode } from "react";
import type { CellRenderContext } from "../core/types";

// Share one accessor result and context between the renderer and conditional class callback.
export function readContent<T>(context: CellRenderContext<T>): ReactNode {
  return context.column.renderCell
    ? context.column.renderCell(context)
    : String(context.value ?? "");
}
