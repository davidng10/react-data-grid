import { memo } from "react";

import { classNames } from "../internal/class-names";

import type { ReactNode } from "react";
import type { FrozenZone } from "../core/types";

// Primitive content keeps memoization effective; custom renderers may pass a fresh React node.
export const Cell = memo(function Cell(props: {
  id: string;
  rowIndex: number;
  columnIndex: number;
  ariaColumnIndex: number;
  readOnly: boolean;
  className?: string;
  content: ReactNode;
  x: number;
  y: number;
  width: number;
  height: number;
  frozen?: FrozenZone;
}) {
  const { content, x, y, width, height, frozen } = props;
  return (
    <div
      id={props.id}
      role="gridcell"
      aria-colindex={props.ariaColumnIndex}
      aria-rowindex={props.rowIndex + 2}
      aria-readonly={props.readOnly}
      data-cell-row={props.rowIndex}
      data-cell-column={props.columnIndex}
      className={classNames("dgr-cell", props.className)}
      data-frozen={frozen}
      style={{
        width,
        height,
        lineHeight: `${height}px`,
        transform: `translate(${x}px, ${y}px)`,
      }}
    >
      {content}
    </div>
  );
});
