import { describe, it, expect } from "vitest";
import { createResizeStore } from "../../../core/store/resize-store";

const START = {
  columnId: "C1",
  zone: "center" as const,
  indicatorX: 240,
};

describe("resizeStore", () => {
  it("starts idle (stable reference)", () => {
    const s = createResizeStore();
    expect(s.getSnapshot()).toEqual({ status: "idle" });
    expect(s.getSnapshot()).toBe(s.getSnapshot());
  });

  it("start opens a resize carrying the column + initial guide line", () => {
    const s = createResizeStore();
    s.start(START);
    expect(s.getSnapshot()).toEqual({ status: "resizing", ...START });
  });

  it("setIndicator moves the guide line while resizing", () => {
    const s = createResizeStore();
    s.start(START);
    s.setIndicator(300);
    expect(s.getSnapshot()).toMatchObject({
      status: "resizing",
      columnId: "C1",
      indicatorX: 300,
    });
  });

  it("setIndicator is identity-stable when the indicator is unchanged", () => {
    const s = createResizeStore();
    s.start(START);
    const snap = s.getSnapshot();
    s.setIndicator(START.indicatorX);
    expect(s.getSnapshot()).toBe(snap); // unchanged identity — overlay doesn't re-render
  });

  it("setIndicator is a no-op while idle", () => {
    const s = createResizeStore();
    s.setIndicator(200);
    expect(s.getSnapshot()).toEqual({ status: "idle" });
  });

  it("end returns to idle", () => {
    const s = createResizeStore();
    s.start(START);
    s.end();
    expect(s.getSnapshot()).toEqual({ status: "idle" });
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const s = createResizeStore();
    let calls = 0;
    const unsub = s.subscribe(() => {
      calls++;
    });
    s.start(START);
    expect(calls).toBe(1);
    s.setIndicator(300);
    expect(calls).toBe(2);
    unsub();
    s.end();
    expect(calls).toBe(2);
  });
});
