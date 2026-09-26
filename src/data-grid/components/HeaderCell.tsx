import { memo } from "react";

import { classNames } from "../internal/class-names";
import { RESIZE_HANDLE_WIDTH } from "../internal/constants";

import type { ReactNode } from "react";
import type { FrozenZone } from "../core/types";

export const HeaderCell = memo(function HeaderCell(props: {
  className?: string;
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
      className={classNames("dgr-header-cell", props.className)}
      data-frozen={frozen}
      style={{
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
            width: RESIZE_HANDLE_WIDTH,
            height,
          }}
        />
      )}
      {resizable && (
        <div
          data-resize-handle="right"
          style={{
            width: RESIZE_HANDLE_WIDTH,
            height,
          }}
        />
      )}
    </div>
  );
});
