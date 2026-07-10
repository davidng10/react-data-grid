import { describe, expect, it } from "vitest";

import { createDragStore } from "../../../core/store/drag-store";

const START = {
  sourceColumnId: "C1",
  sourceZone: "center" as const,
  sourceIndex: 1,
  targetIndex: 1,
  indicatorX: 100,
};

describe("dragStore", () => {
  it("starts idle (stable reference)", () => {
    const s = createDragStore();
    expect(s.getSnapshot()).toEqual({ status: "idle" });
    expect(s.getSnapshot()).toBe(s.getSnapshot());
  });

  it("start opens a drag carrying the source + initial target", () => {
    const s = createDragStore();
    s.start(START);
    expect(s.getSnapshot()).toEqual({ status: "dragging", ...START });
  });

  it("updateTarget patches the index + indicator while dragging", () => {
    const s = createDragStore();
    s.start(START);
    s.updateTarget(3, 300);
    expect(s.getSnapshot()).toMatchObject({
      status: "dragging",
      sourceColumnId: "C1",
      targetIndex: 3,
      indicatorX: 300,
    });
  });

  it("updateTarget is identity-stable when target + indicator are unchanged", () => {
    const s = createDragStore();
    s.start(START);
    const snap = s.getSnapshot();
    s.updateTarget(START.targetIndex, START.indicatorX);
    expect(s.getSnapshot()).toBe(snap); // unchanged identity — overlay doesn't re-render
  });

  it("updateTarget is a no-op while idle", () => {
    const s = createDragStore();
    s.updateTarget(2, 200);
    expect(s.getSnapshot()).toEqual({ status: "idle" });
  });

  it("end returns to idle", () => {
    const s = createDragStore();
    s.start(START);
    s.end();
    expect(s.getSnapshot()).toEqual({ status: "idle" });
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const s = createDragStore();
    let calls = 0;
    const unsub = s.subscribe(() => {
      calls++;
    });
    s.start(START);
    expect(calls).toBe(1);
    s.updateTarget(2, 200);
    expect(calls).toBe(2);
    unsub();
    s.end();
    expect(calls).toBe(2);
  });
});
