import { memo } from "react";

import { HEADER_BG, RESIZE_HANDLE_WIDTH } from "../internal/constants";
import { cellBase } from "../internal/style";

import type { ReactNode } from "react";
import type { FrozenZone } from "../core/types";

export const HeaderCell = memo(function HeaderCell(props: {
  content: ReactNode;
  x: number;
  width: number;
  height: number;
  frozen?: FrozenZone;
  /** Show the column-drag affordance. */
  draggable?: boolean;
  /** Show the resize handle at the right edge. */
  resizable?: boolean;
  /** Continue the previous column's resize cursor into this cell's left edge. */
  resizeFromLeft?: boolean;
}) {
  const {
    content,
    x,
    width,
    height,
    frozen,
    draggable,
    resizable,
    resizeFromLeft,
  } = props;
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
      {content}
      {/* These are hover affordances only; the container hit-tests symmetrically around the
          boundary and keeps resize ownership with the column on its left. */}
      {resizeFromLeft && (
        <div
          data-resize-handle="left"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: RESIZE_HANDLE_WIDTH,
            height,
            cursor: "col-resize",
            zIndex: 1,
          }}
        />
      )}
      {resizable && (
        <div
          data-resize-handle="right"
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
