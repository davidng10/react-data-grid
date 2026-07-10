import { memo } from "react";
import type { ReactNode } from "react";
import type { FrozenZone } from "../core/types";
import { cellBase } from "../internal/style";

// Primitive content keeps memoization effective; custom renderers may pass a fresh React node.
export const Cell = memo(function Cell(props: {
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
      data-frozen={frozen}
      style={{
        ...cellBase,
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
