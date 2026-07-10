// Setup for the jsdom ("dom") test project — registers jest-dom matchers, RTL cleanup, and the
// browser primitives jsdom lacks but the grid relies on. The grid is measurement-driven, but its
// per-column geometry comes from the offsets arrays (props), not per-element layout, so tests only
// need to mock the SCROLL CONTAINER's rect/size (done per-test) plus these globals.

import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

type Globalish = Record<string, unknown>;

// TanStack Virtual observes the scroll element via ResizeObserver — jsdom has none.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Globalish).ResizeObserver = ResizeObserver;
}

// The drag/selection auto-scroll ticks schedule rAF; jsdom may not provide it.
if (!("requestAnimationFrame" in globalThis)) {
  (globalThis as Globalish).requestAnimationFrame = (
    cb: FrameRequestCallback
  ) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as Globalish).cancelAnimationFrame = (id: number) =>
    clearTimeout(id);
}

// jsdom lacks PointerEvent — synthesize from MouseEvent so clientX/clientY/button carry over.
if (!("PointerEvent" in globalThis)) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  (globalThis as Globalish).PointerEvent = PointerEventPolyfill;
}

// Pointer capture is a no-op in jsdom; the grid calls these during a drag.
for (const m of [
  "setPointerCapture",
  "releasePointerCapture",
  "hasPointerCapture",
] as const) {
  if (!(m in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>)[m] = () => {};
  }
}

// jsdom reports 0 for every box metric, so TanStack Virtual computes an EMPTY window and no cells
// render — leaving the cell/overlay/editor paths untested. Give every element a fixed viewport box:
// the grid never measures individual cells (it positions them via transforms from the offsets
// arrays), so one size for all is enough to make the virtualizer produce a window and the render
// paths execute. A test that needs different coordinates overrides the scroll container's own rect.
const VIEWPORT_W = 1000;
const VIEWPORT_H = 600;
// TanStack Virtual sizes its window from offsetWidth/offsetHeight; the grid's hitTest reads
// clientWidth/clientHeight + getBoundingClientRect. Mock all of them.
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get: () => VIEWPORT_W,
});
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get: () => VIEWPORT_H,
});
Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get: () => VIEWPORT_W,
});
Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get: () => VIEWPORT_H,
});
HTMLElement.prototype.getBoundingClientRect = function () {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: VIEWPORT_W,
    bottom: VIEWPORT_H,
    width: VIEWPORT_W,
    height: VIEWPORT_H,
    toJSON: () => ({}),
  } as DOMRect;
};
