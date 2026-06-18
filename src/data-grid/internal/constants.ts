// Shell layout/cosmetic constants (DECISIONS.md D5/D6/D7). The dumb shell hard-codes light styling;
// the D7 theming surface is a later phase.

export const DEFAULT_ROW_HEIGHT = 32;
export const DEFAULT_COL_WIDTH = 140;
export const GUTTER_WIDTH = 40;
export const DEFAULT_OVERSCAN_COLS = 2;
export const DEFAULT_OVERSCAN_ROWS = 6;

export const HEADER_BG = "#f5f5f4";
export const HEADER_BORDER = "1px solid #d6d3d1";
// The freeze line — a 1px divider that reads more clearly than the inter-cell border. Drawn as a
// box-shadow (not a border) so it costs zero layout width: it overlays the scrolling center at the
// boundary instead of widening the zone past the budgeted `totalWidth` (see style.ts).
export const FREEZE_DIVIDER_COLOR = "#d6d3d1";
// Frozen body cells must be opaque so the scrolling center band doesn't show through them as it
// slides underneath (z-ordering puts frozen zones above center). Read-mode only.
export const FROZEN_BG = "#ffffff";
// Skeleton "loading" placeholder painted behind the (opaque white) body cells — visible only in the
// gap a fast scroll opens before React mounts its cells: See `components/EmptyRowsLayer`.
export const SKELETON_BG = "#ffffff"; // base behind the bars (opaque)
export const SKELETON_BAR = "#f5f5f4"; // the per-row placeholder bar
export const SKELETON_PULSE_MS = 1000;

// Selection overlay cosmetics (D6).
export const SELECT_FILL = "rgba(37, 99, 235, 0.12)";
export const SELECT_BORDER = "1px solid rgba(37, 99, 235, 0.55)";
export const FOCUS_BORDER = "1px solid #2563eb";

// Auto-scroll while drag-selecting near a viewport edge.
export const EDGE_ZONE = 48;
export const EDGE_SPEED = 22;

// Column drag-reorder (P7). The pointer must move this far before a header press becomes a drag (so a
// plain header click isn't swallowed). The drop indicator is a 2px line in the header strip.
export const DRAG_THRESHOLD = 4;
export const DROP_LINE_COLOR = "#2563eb";

// Column resize (P-resize / D12). The grab strip at each header's right edge (px on each side of the
// boundary); the floor a column can be dragged down to; and the full-height guide line drawn while
// resizing (a 2px line in zone-local coords, like the reorder drop indicator).
export const RESIZE_HANDLE_WIDTH = 6;
export const MIN_COL_WIDTH = 48;
export const RESIZE_LINE_COLOR = "#2563eb";
