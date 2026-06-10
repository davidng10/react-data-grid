import type { CSSProperties } from "react";
import { FREEZE_DIVIDER_COLOR } from "./constants";

// The freeze dividers overlay the boundary as a box-shadow so they cost zero layout width.
export const FREEZE_DIVIDER_LEFT: CSSProperties = {
  boxShadow: `1px 0 0 0 ${FREEZE_DIVIDER_COLOR}`,
};
export const FREEZE_DIVIDER_RIGHT: CSSProperties = {
  boxShadow: `-1px 0 0 0 ${FREEZE_DIVIDER_COLOR}`,
};

export const cellBase: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  padding: "0 10px",
  fontSize: 13,
  boxSizing: "border-box",
  borderRight: "1px solid #f0efee",
  borderBottom: "1px solid #f0efee",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
