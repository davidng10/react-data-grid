import { memo } from "react";

import { SKELETON_BAR, SKELETON_BG } from "../internal/constants";

const BAR_FILL = 0.5; // bar height as a fraction of the row (the rest is top/bottom padding)
const BAR_INSET_X = 6; // left/right padding (px) at the row's horizontal ends
const BAR_RADIUS = 4; // corner radius (px) of each row's skeleton bar
const CAP_W = BAR_RADIUS; // width of the rounded end-cap tiles (just enough to hold one corner)
const MID_W = 8; // width of the repeating middle-fill tile

// Build a one-row-tall background tile from inner <rect> markup. Repeated at NATURAL size (never
// `background-size`-scaled), so the 2px corners stay crisp and there's no giant tile to rasterize.
// The svg viewport (width) clips the rect to just the slice this tile contributes.
function tile(width: number, rowHeight: number, rect: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${rowHeight}'>` +
    rect +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export const EmptyRowsLayer = memo(function EmptyRowsLayer({
  rowHeight,
}: {
  rowHeight: number;
}) {
  const h = Math.round(rowHeight * BAR_FILL);
  const y = Math.round((rowHeight - h) / 2);
  const r = BAR_RADIUS;

  // Left cap: a rounded rect pushed right so only its LEFT corners fall inside the CAP_W viewport;
  // the cut right edge is full bar-height, butting seamlessly against the middle fill.
  const leftCap = tile(
    CAP_W,
    rowHeight,
    `<rect x='0' y='${y}' width='${CAP_W + r}' height='${h}' rx='${r}' ry='${r}' fill='${SKELETON_BAR}'/>`
  );
  // Right cap: pushed left so only its RIGHT corners fall inside the viewport (mirror of the above).
  const rightCap = tile(
    CAP_W,
    rowHeight,
    `<rect x='${-r}' y='${y}' width='${CAP_W + r}' height='${h}' rx='${r}' ry='${r}' fill='${SKELETON_BAR}'/>`
  );
  // Middle fill: a square-cornered bar that tiles across the inset content box (the cap zones are
  // padding, so this never reaches the corners the caps round away).
  const mid = tile(
    MID_W,
    rowHeight,
    `<rect x='0' y='${y}' width='${MID_W}' height='${h}' fill='${SKELETON_BAR}'/>`
  );

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: SKELETON_BG,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: BAR_INSET_X,
          right: BAR_INSET_X,
          boxSizing: "border-box",
          padding: `0 ${CAP_W}px`, // reserves the cap zones; the middle fill is clipped to inside this
          backgroundImage: `${leftCap}, ${rightCap}, ${mid}`,
          backgroundRepeat: "repeat-y, repeat-y, repeat",
          backgroundPosition: "left top, right top, left top",
          // caps paint over the full (border) box; the middle is clipped to the inset content box.
          backgroundClip: "border-box, border-box, content-box",
          backgroundSize: `${CAP_W}px ${rowHeight}px, ${CAP_W}px ${rowHeight}px, ${MID_W}px ${rowHeight}px`,
        }}
      />
    </div>
  );
});
