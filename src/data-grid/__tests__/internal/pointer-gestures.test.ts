import { describe, it, expect, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  composePointerGestures,
  type PointerGesture,
} from "../../internal/pointer-gestures";

// The composer only reads `e.button`; everything else is passed through opaquely, so a minimal
// fake event is enough.
const ev = (button = 0) =>
  ({ button }) as unknown as ReactPointerEvent<HTMLDivElement>;

describe("composePointerGestures", () => {
  it("routes to the first gesture that consumes the event and skips the rest", () => {
    const first = vi.fn(() => false); // declines
    const winner = vi.fn(() => true); // consumes
    const skipped = vi.fn(() => true);
    const gestures: PointerGesture[] = [
      { onPointerDown: first },
      { onPointerDown: winner },
      { onPointerDown: skipped },
    ];
    composePointerGestures(gestures).onPointerDown(ev());
    expect(first).toHaveBeenCalledTimes(1);
    expect(winner).toHaveBeenCalledTimes(1);
    expect(skipped).not.toHaveBeenCalled();
  });

  it("treats a void return as 'declined', so a fallback gesture still runs last", () => {
    const declines = vi.fn(() => undefined);
    const fallback = vi.fn(() => undefined);
    const gestures: PointerGesture[] = [
      { onPointerMove: declines },
      { onPointerMove: fallback },
    ];
    composePointerGestures(gestures).onPointerMove(ev());
    expect(declines).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("only the primary button starts a gesture (the guard is pointerdown-only)", () => {
    const down = vi.fn(() => true);
    const move = vi.fn(() => true);
    const handlers = composePointerGestures([
      { onPointerDown: down, onPointerMove: move },
    ]);

    handlers.onPointerDown(ev(2)); // right click → ignored
    expect(down).not.toHaveBeenCalled();
    handlers.onPointerDown(ev(0)); // primary → routed
    expect(down).toHaveBeenCalledTimes(1);

    handlers.onPointerMove(ev(2)); // move is routed regardless of button
    expect(move).toHaveBeenCalledTimes(1);
  });

  it("runs EVERY gesture's lost-capture cleanup, with no priority short-circuit", () => {
    const a = vi.fn();
    const b = vi.fn();
    const gestures: PointerGesture[] = [
      { onPointerDown: vi.fn(() => true), onLostPointerCapture: a },
      { onLostPointerCapture: b },
      {}, // a gesture with no cleanup must not throw
    ];
    composePointerGestures(gestures).onLostPointerCapture();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("skips gestures that don't implement the routed handler", () => {
    const down = vi.fn(() => true);
    const gestures: PointerGesture[] = [{}, { onPointerDown: down }];
    composePointerGestures(gestures).onPointerDown(ev());
    expect(down).toHaveBeenCalledTimes(1);
  });
});
