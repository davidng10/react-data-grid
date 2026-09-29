import { describe, expect, it } from "vitest";

import { createGridStore } from "../../../core/store/grid-store";

describe("gridStore", () => {
  it("focusCell sets the cursor and drops any range", () => {
    const s = createGridStore();
    s.focusCell({ rowIndex: 0, columnId: "C0" });
    s.extendTo({ rowIndex: 2, columnId: "C2" });
    expect(s.getSnapshot().range).not.toBeNull();

    s.focusCell({ rowIndex: 5, columnId: "C1" });
    const snap = s.getSnapshot();
    expect(snap.focusedCell).toEqual({ rowIndex: 5, columnId: "C1" });
    expect(snap.range).toBeNull();
  });

  it("extendTo anchors on the existing range anchor through a sequence", () => {
    const s = createGridStore();
    s.focusCell({ rowIndex: 0, columnId: "C0" });
    s.extendTo({ rowIndex: 2, columnId: "C2" });
    s.extendTo({ rowIndex: 3, columnId: "C1" });
    const { range, focusedCell } = s.getSnapshot();
    expect(range?.anchor).toEqual({ rowIndex: 0, columnId: "C0" }); // anchor held
    expect(range?.focus).toEqual({ rowIndex: 3, columnId: "C1" });
    expect(focusedCell).toEqual({ rowIndex: 3, columnId: "C1" });
  });

  it("extendTo with no prior focus or range anchors on the cell itself", () => {
    const s = createGridStore();
    s.extendTo({ rowIndex: 1, columnId: "C1" });
    expect(s.getSnapshot().range).toEqual({
      anchor: { rowIndex: 1, columnId: "C1" },
      focus: { rowIndex: 1, columnId: "C1" },
    });
  });

  it("produces a fresh snapshot identity on mutation, stable otherwise", () => {
    const s = createGridStore();
    const before = s.getSnapshot();
    expect(s.getSnapshot()).toBe(before); // stable read
    s.focusCell({ rowIndex: 0, columnId: "C0" });
    const after = s.getSnapshot();
    expect(after).not.toBe(before); // changed
    expect(s.getSnapshot()).toBe(after); // stable again
  });

  it("toggleRow is immutable and toggles membership", () => {
    const s = createGridStore();
    const empty = s.getSnapshot();
    s.toggleRow("r1");
    expect(s.getSnapshot().selectedRows.has("r1")).toBe(true);
    expect(empty.selectedRows.size).toBe(0); // old snapshot untouched
    expect(s.getSnapshot().selectedRows).not.toBe(empty.selectedRows); // new Set
    s.toggleRow("r1");
    expect(s.getSnapshot().selectedRows.has("r1")).toBe(false);
  });

  it("setRowsSelected bulk-adds and bulk-removes", () => {
    const s = createGridStore();
    s.setRowsSelected(["a", "b", "c"], true);
    expect([...s.getSnapshot().selectedRows].sort()).toEqual(["a", "b", "c"]);
    s.setRowsSelected(["b"], false);
    expect([...s.getSnapshot().selectedRows].sort()).toEqual(["a", "c"]);
  });

  it("clearRange is a no-op when there is no range", () => {
    const s = createGridStore();
    s.focusCell({ rowIndex: 0, columnId: "C0" });
    const snap = s.getSnapshot();
    s.clearRange();
    expect(s.getSnapshot()).toBe(snap); // no churn
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const s = createGridStore();
    let calls = 0;
    const unsub = s.subscribe(() => {
      calls++;
    });
    s.focusCell({ rowIndex: 0, columnId: "C0" });
    expect(calls).toBe(1);
    unsub();
    s.focusCell({ rowIndex: 1, columnId: "C0" });
    expect(calls).toBe(1);
  });

  it("reset clears focus, range, and rows", () => {
    const s = createGridStore();
    s.focusCell({ rowIndex: 0, columnId: "C0" });
    s.extendTo({ rowIndex: 2, columnId: "C2" });
    s.toggleRow("r1");
    s.reset();
    const snap = s.getSnapshot();
    expect(snap.focusedCell).toBeNull();
    expect(snap.range).toBeNull();
    expect(snap.selectedRows.size).toBe(0);
  });
});
