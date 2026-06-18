import { describe, it, expect } from "vitest";
import { edgeScrollDelta } from "../../internal/auto-scroll";
import { EDGE_SPEED } from "../../internal/constants";

// A viewport anchored at (0,0), 1000×600. The helper reads rect.{left,top,bottom} and el.clientWidth.
const el = (clientWidth = 1000): HTMLElement =>
  ({
    clientWidth,
    getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 600 }) as DOMRect,
  }) as unknown as HTMLElement;

// 100px left frozen band, 50px right band, 32px sticky header → band edges:
// leftLimit=100, rightLimit=1000-50=950, topLimit=32, bottom=600.
const insets = { top: 32, left: 100, right: 50 };

describe("edgeScrollDelta", () => {
  it("is zero in the interior (no edge near the pointer)", () => {
    expect(edgeScrollDelta({ x: 500, y: 300 }, el(), insets)).toEqual({ dx: 0, dy: 0 });
  });

  it("ramps negative near the left band and positive near the right band", () => {
    expect(edgeScrollDelta({ x: 100, y: 300 }, el(), insets).dx).toBe(-EDGE_SPEED);
    expect(edgeScrollDelta({ x: 920, y: 300 }, el(), insets).dx).toBe(EDGE_SPEED);
  });

  it("ramps negative near the top band and positive near the bottom", () => {
    expect(edgeScrollDelta({ x: 500, y: 40 }, el(), insets).dy).toBe(-EDGE_SPEED);
    expect(edgeScrollDelta({ x: 500, y: 580 }, el(), insets).dy).toBe(EDGE_SPEED);
  });

  it("insets move the band inward — a point inside the frozen band triggers a scroll", () => {
    // x=130 is right of the raw viewport edge (0) but inside the 100px frozen band, so it's within
    // EDGE_ZONE of the SCROLLING region's left edge (100). With no inset it would not trigger.
    expect(edgeScrollDelta({ x: 130, y: 300 }, el(), insets).dx).toBe(-EDGE_SPEED);
    expect(edgeScrollDelta({ x: 130, y: 300 }, el(), { left: 0, right: 0 }).dx).toBe(0);
  });

  it("omitting top disables vertical scroll (horizontal-only gesture)", () => {
    const horizontalOnly = { left: 100, right: 50 };
    expect(edgeScrollDelta({ x: 500, y: 40 }, el(), horizontalOnly)).toEqual({ dx: 0, dy: 0 });
    expect(edgeScrollDelta({ x: 500, y: 580 }, el(), horizontalOnly).dy).toBe(0);
    expect(edgeScrollDelta({ x: 100, y: 580 }, el(), horizontalOnly).dx).toBe(-EDGE_SPEED); // x still works
  });

  it("a corner ramps both axes at once", () => {
    expect(edgeScrollDelta({ x: 100, y: 40 }, el(), insets)).toEqual({
      dx: -EDGE_SPEED,
      dy: -EDGE_SPEED,
    });
  });
});
