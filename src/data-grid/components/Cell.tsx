import { memo } from "react";
import type { ReactNode } from "react";
import type { FrozenZone } from "../core/types";
import { cellBase } from "../internal/style";

// `content` is usually the value string (memo stays stable across scroll — D9). A column with a
// custom `renderRead` passes a ReactNode instead; that breaks the memo for *those* cells only (a
// fresh element each render), which is fine — custom-render columns are few, the bulk stay cheap.
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
