import { memo } from "react";

import { classNames } from "../internal/class-names";

import type { ReactNode } from "react";
import type { FrozenZone } from "../core/types";

// Primitive content keeps memoization effective; custom renderers may pass a fresh React node.
export const Cell = memo(function Cell(props: {
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
