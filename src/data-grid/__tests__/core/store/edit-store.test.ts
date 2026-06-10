import { describe, it, expect } from "vitest";
import { createEditStore } from "../../../core/store/edit-store";

const CELL = { rowIndex: 3, columnId: "c2" };

describe("editStore", () => {
  it("starts idle", () => {
    const s = createEditStore();
    expect(s.getSnapshot()).toEqual({ status: "idle" });
  });

  it("begin opens an editor with the initial draft", () => {
    const s = createEditStore();
    s.begin(CELL, "hello");
    expect(s.getSnapshot()).toEqual({
      status: "editing",
      cell: CELL,
      draft: "hello",
    });
  });

  it("setDraft updates the draft while editing", () => {
    const s = createEditStore();
    s.begin(CELL, "a");
    s.setDraft("ab");
    const snap = s.getSnapshot();
    expect(snap.status).toBe("editing");
    expect(snap).toMatchObject({ draft: "ab", cell: CELL });
  });

  it("setDraft is a no-op while idle or submitting (editor locked)", () => {
    const s = createEditStore();
    s.setDraft("x");
    expect(s.getSnapshot().status).toBe("idle");

    s.begin(CELL, "a");
    s.submitting();
    const locked = s.getSnapshot();
    s.setDraft("b");
    expect(s.getSnapshot()).toBe(locked); // unchanged identity — input ignored mid-flight
  });

  it("submitting transitions from editing and keeps cell + draft", () => {
    const s = createEditStore();
    s.begin(CELL, "v");
    s.submitting();
    expect(s.getSnapshot()).toEqual({
      status: "submitting",
      cell: CELL,
      draft: "v",
    });
  });

  it("succeed closes the editor", () => {
    const s = createEditStore();
    s.begin(CELL, "v");
    s.submitting();
    s.succeed();
    expect(s.getSnapshot()).toEqual({ status: "idle" });
  });

  it("fail keeps the cell + draft and carries the error", () => {
    const s = createEditStore();
    s.begin(CELL, "v");
    s.submitting();
    s.fail(new Error("boom"));
    const snap = s.getSnapshot();
    expect(snap.status).toBe("error");
    expect(snap).toMatchObject({ cell: CELL, draft: "v" });
    expect((snap as { error: Error }).error).toBeInstanceOf(Error);
  });

  it("typing after an error clears the error back to editing (retry-by-typing)", () => {
    const s = createEditStore();
    s.begin(CELL, "v");
    s.submitting();
    s.fail("nope");
    s.setDraft("v2");
    expect(s.getSnapshot()).toEqual({
      status: "editing",
      cell: CELL,
      draft: "v2",
    });
  });

  it("submitting can re-run from an error state (retry of the same draft)", () => {
    const s = createEditStore();
    s.begin(CELL, "v");
    s.submitting();
    s.fail("nope");
    s.submitting();
    expect(s.getSnapshot()).toEqual({
      status: "submitting",
      cell: CELL,
      draft: "v",
    });
  });

  it("cancel returns to idle from any open state", () => {
    const s = createEditStore();
    s.begin(CELL, "v");
    s.cancel();
    expect(s.getSnapshot()).toEqual({ status: "idle" });
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const s = createEditStore();
    let calls = 0;
    const unsub = s.subscribe(() => {
      calls++;
    });
    s.begin(CELL, "v");
    expect(calls).toBe(1);
    s.setDraft("w");
    expect(calls).toBe(2);
    unsub();
    s.cancel();
    expect(calls).toBe(2);
  });

  it("produces a fresh snapshot identity on mutation", () => {
    const s = createEditStore();
    const before = s.getSnapshot();
    s.begin(CELL, "v");
    expect(s.getSnapshot()).not.toBe(before);
  });
});
