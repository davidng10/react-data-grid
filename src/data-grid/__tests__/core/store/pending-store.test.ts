import { describe, expect, it } from "vitest";

import { createPendingStore } from "../../../core/store/pending-store";

const A = { rowId: "r1", columnId: "c1" };
const B = { rowId: "r2", columnId: "c1" };

const setPending = (
  store: ReturnType<typeof createPendingStore>,
  cell: typeof A,
  value: unknown
) => store.setPending(cell.rowId, cell.columnId, value);
const has = (store: ReturnType<typeof createPendingStore>, cell: typeof A) =>
  store.has(cell.rowId, cell.columnId);
const clear = (store: ReturnType<typeof createPendingStore>, cell: typeof A) =>
  store.clear(cell.rowId, cell.columnId);

describe("pendingStore", () => {
  it("starts empty", () => {
    const s = createPendingStore();
    expect(s.getSnapshot().size).toBe(0);
  });

  it("setPending adds an optimistic entry", () => {
    const s = createPendingStore();
    setPending(s, A, "new");
    expect(has(s, A)).toBe(true);
    expect([...s.getSnapshot().values()][0]).toEqual({
      ...A,
      value: "new",
      status: "pending",
    });
  });

  it("setError flips status to error and keeps the value", () => {
    const s = createPendingStore();
    setPending(s, A, "new");
    s.setError(A.rowId, A.columnId);
    expect([...s.getSnapshot().values()][0]).toMatchObject({
      status: "error",
      value: "new",
    });
  });

  it("clear removes one entry without touching others", () => {
    const s = createPendingStore();
    setPending(s, A, "a");
    setPending(s, B, "b");
    clear(s, A);
    expect(has(s, A)).toBe(false);
    expect(has(s, B)).toBe(true);
  });

  it("supports multiple concurrent pending cells", () => {
    const s = createPendingStore();
    setPending(s, A, "a");
    setPending(s, B, "b");
    expect(s.getSnapshot().size).toBe(2);
  });

  it("clear is a no-op (no churn) when the cell is absent", () => {
    const s = createPendingStore();
    const snap = s.getSnapshot();
    clear(s, A);
    expect(s.getSnapshot()).toBe(snap);
  });

  it("produces a fresh Map identity on mutation (immutable snapshots)", () => {
    const s = createPendingStore();
    const before = s.getSnapshot();
    setPending(s, A, "x");
    expect(s.getSnapshot()).not.toBe(before);
    expect(before.size).toBe(0); // old snapshot untouched
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const s = createPendingStore();
    let calls = 0;
    const unsub = s.subscribe(() => {
      calls++;
    });
    setPending(s, A, "x");
    expect(calls).toBe(1);
    unsub();
    clear(s, A);
    expect(calls).toBe(1);
  });
});
