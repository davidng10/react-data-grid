import { memo } from "react";
import type { FrozenZone } from "../core/types";
import { cellBase } from "../internal/style";
import { HEADER_BG } from "../internal/constants";

export const HeaderCell = memo(function HeaderCell(props: {
  name: string;
  x: number;
  width: number;
  height: number;
  frozen?: FrozenZone;
  /** Show the grab affordance (column drag-reorder, P7). */
  draggable?: boolean;
}) {
  const { name, x, width, height, frozen, draggable } = props;
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
    </div>
  );
});
