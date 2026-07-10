import { memo } from "react";

import { HEADER_BG, RESIZE_HANDLE_WIDTH } from "../internal/constants";
import { cellBase } from "../internal/style";

import type { FrozenZone } from "../core/types";

export const HeaderCell = memo(function HeaderCell(props: {
  name: string;
  x: number;
  width: number;
  height: number;
  frozen?: FrozenZone;
  /** Show the column-drag affordance. */
  draggable?: boolean;
  /** Show the resize handle at the right edge. */
  resizable?: boolean;
}) {
  const { name, x, width, height, frozen, draggable, resizable } = props;
  return (
    <div
      data-frozen={frozen}
      style={{
        ...cellBase,
        fontWeight: 600,
        borderRight: "1px solid #e7e5e4",
        background: HEADER_BG,
        width,
        height,
        lineHeight: `${height}px`,
        transform: `translateX(${x}px)`,
        cursor: draggable ? "grab" : undefined,
      }}
    >
      {name}
      {/* Resize handle — a hover affordance only; the gesture is driven by the container's
          pointerdown via `headerResizeHitTest` (which matches a slightly wider band than this strip,
          symmetric around the boundary), so this purely supplies the `col-resize` cursor. */}
      {resizable && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: RESIZE_HANDLE_WIDTH,
            height,
            cursor: "col-resize",
            zIndex: 1,
          }}
        />
      )}
    </div>
  );
});
