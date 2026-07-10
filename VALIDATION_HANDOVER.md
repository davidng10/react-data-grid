# Handover: synchronous cell-edit validation

**Goal:** let an integrator validate a draft *before* it commits (e.g. a number column that
must be 10–100) and surface inline feedback in the editor, blocking the commit when invalid.

**Status:** designed, not started. This doc is self-contained — you can pick it up cold.

---

## 1. Background: how editing works today

Two independent stores (read their header comments — they're good):

- **`core/store/edit-store.ts`** — the *open editor*. States: `idle | editing | submitting | error`.
  It already exposes `begin / setDraft / submitting / succeed / fail / cancel`.
  **`submitting`, `fail`, and the `error`/`submitting` states are currently DEAD** — nothing calls
  them. This feature wires up `fail()` + the `error` state. (`submitting` stays unused; it would only
  matter for a non-optimistic *async-in-editor* mode, which is out of scope — see §7.)
- **`core/store/pending-store.ts`** — the *async commit overlay* on the cell (spinner, then red-flash
  revert on rejection). This is alive and unrelated to validation. **Do not touch it.**

**Commit is optimistic (DECISIONS.md D10).** `useCellEditing.ts → startCommit` (~L99–141):

1. reads the edit snapshot,
2. calls `editStore.succeed()` **immediately** (closes the editor),
3. `pendingStore.setPending(...)` then runs the consumer's `onCommit`/`onCellCommit`,
4. on reject → `pendingStore.setError(...)` (the red flash), then clears.

`parseValue?(next, ctx)` (column.ts ~L90) **coerces** the draft (e.g. string→number) but **cannot
reject** — it just returns a value, which commits unconditionally.

**Commit triggers** (all eventually call into `useCellEditing`):

| trigger | wired via |
|---|---|
| Enter | `FloatingTextEditor` onKeyDown → `onEnter` → `commitAndMove('down')` |
| Tab | `FloatingTextEditor` onKeyDown → `onTab` → `commitAndMove('right')` |
| blur (default text editor) | `FloatingTextEditor` `onBlur` (~L88) → `api.commit()` → `commitCell()` |
| outside-click (any editor) | `EditorPortal` document `pointerdown` listener (~L187–196) → `commit()` → `commitCell()` |
| select pick / custom editor | editor calls `ctx.commit()` → `commitCell()` |
| Escape | editor → `ctx.cancel()` → `cancelEdit()` |

`CellEditContext` (column.ts ~L39–49) is **public** — passed to custom `renderEdit(ctx)` and
`parseValue`. It already carries `status: EditStatus` and `error?: unknown`. The playground's AntD
editor (`src/playground/pages/GridPlayground.tsx` ~L149–150) already reads
`ctx.status === "error"` / `=== "submitting"` — those just never fire today.

---

## 2. The problem

The commit path never consults validity, and `parseValue` can't reject. So:

- invalid drafts commit, and
- implicit triggers (blur / outside-click) commit behind the editor's back — an editor that withholds
  `ctx.commit()` on Enter still can't stop a click-away from committing.

The fix is **not** "make blur cancel" (that would silently discard valid edits on click-away, which
regresses the spreadsheet save-on-blur convention this grid follows). The fix is to **validate inside
the commit path**, on every trigger, and branch on the result.

---

## 3. Design / contract

### New column hook

```ts
// core/types/column.ts — on Column<T>, near parseValue
/**
 * Validate the parsed value before commit. Return an error message to REJECT, or null/undefined to
 * accept. Receives the value AFTER parseValue (i.e. what would actually be committed). Runs only when
 * the value changed (an unchanged cell commits as a no-op without validating).
 */
validate?: (value: unknown, ctx: CellEditContext<T>) => string | null | undefined
```

### Behaviour matrix (recommended)

Split by *how the user is leaving* the cell. "Explicit" = the user is actively saving from inside the
editor (Enter / Tab / select-pick / a custom editor calling `ctx.commit()`). "Implicit" = focus left
the editor (blur / outside-click).

| trigger | valid | invalid |
|---|---|---|
| **explicit** (Enter/Tab/`ctx.commit`) | commit (+ move for Enter/Tab) | **stay open**, `editStore.fail(msg)` → `ctx.status='error'`, `ctx.error=msg`; do **not** move |
| **implicit** (blur / outside-click) | commit | **discard** (`editStore.cancel()`) and close |
| **Escape** | discard | discard |

Rationale: valid edits still save on click-away (no UX regression); an invalid click-away is discarded
rather than trapping the user or committing garbage; an explicit save shows the error and keeps the
editor open so they can fix it. Typing after an error retains the message while the latest draft is
revalidated after a short debounce; it returns `error → editing` only once validation passes.

> Simpler v1 alternative: invalid **always** stays open + shows error regardless of trigger (Escape to
> abandon). Avoids threading explicit/implicit. **Caveat:** on outside-click this leaves the editor
> floating over cell A while the click moves selection to cell B — a visual conflict. Prefer the
> matrix above; fall back to this only if the wiring proves too invasive.

---

## 4. Implementation steps

### 4a. `core/types/column.ts`
Add the `validate?` field (above). No other change — `status`/`error` already exist on
`CellEditContext`.

### 4b. `hooks/useCellEditing.ts` — the core change
Restructure `startCommit` to validate **before** `succeed()`, and return whether it committed. Add an
`implicit` flag.

```ts
// returns true if it committed (closed for save), false if it left the editor open or discarded
const startCommit = (implicit: boolean): boolean => {
  const snap = editStore.getSnapshot();
  if (snap.status === "idle") return false;
  const { cell, draft } = snap;

  const col = findColumn(cell.columnId);
  const row = rows[cell.rowIndex];
  if (!col || row == null) { editStore.succeed(); return true; }

  const ctx = /* build CellEditContext as today (previousValue, etc.) */;
  const nextValue = col.parseValue ? col.parseValue(draft, ctx) : draft;

  if (Object.is(nextValue, previousValue)) { editStore.succeed(); return true; } // no-op close

  const error = col.validate?.(nextValue, ctx);
  if (error) {
    if (implicit) editStore.cancel();        // discard on click-away
    else editStore.fail(error);              // keep open + show error on explicit save
    return false;
  }

  editStore.succeed();                        // valid → optimistic close + async (unchanged below)
  const handler = col.onCommit ?? onCellCommit;
  if (!handler) return true;
  pendingStore.setPending(cell, nextValue);
  Promise.resolve(handler({ rowId, row, columnId: col.id, previousValue, nextValue }))
    .then(() => pendingStore.clear(cell))
    .catch(() => { pendingStore.setError(cell); window.setTimeout(() => pendingStore.clear(cell), ERROR_FLASH_MS); });
  return true;
};
```

Then:
- `commitCell()` → the **implicit** entry: `startCommit(true)`. (Only blur/outside-click reach this;
  see 4c/4d. Don't `returnFocus()` when it returns false.)
- `commitAndMove(dir)` → **explicit**: `const ok = startCommit(false); if (ok) { move + returnFocus }`.
  On `!ok` the editor stays open (focused) — do **not** move or return focus.
- Expose an explicit commit for editors that commit from inside (select pick / custom `ctx.commit`):
  either reuse `commitCell` with an explicit variant or add `commitExplicit()` = `startCommit(false)`.
  **Decide:** what does `ctx.commit` map to? Recommended: **explicit** (a custom editor calling commit
  is the user actively saving). So `ctx.commit` → explicit, and only the grid's own blur/outside-click
  use the implicit path.

> Net: you need two commit entry points — explicit (Enter/Tab/`ctx.commit`) and implicit
> (blur/outside-click). Thread the `implicit` boolean from the two grid-owned triggers only.

### 4c. `editors/EditorPortal.tsx`
- The outside-click listener (~L187–196) currently calls `commit()`. Point it at the **implicit**
  commit instead (add a prop, e.g. `commitImplicit`, alongside the existing `commit`).
- `ctx.commit` (passed to editors) stays the **explicit** commit.
- `ctx` already forwards `status`/`error` (~L219–220) — leave as is.

### 4d. `editors/FloatingTextEditor.tsx` (default text editor)
- `onBlur` (~L88) currently calls `api.commit()`. Route it to the **implicit** commit (add an
  `onBlur`/`commitImplicit` callback prop from `EditorPortal`). Keep Enter/Tab on the explicit path.
- **Add error UI:** when `api.status === 'error'`, show a red border on the `<textarea>` and render
  `String(api.error)` below it. Today the editor has no error affordance (it was "editing-only").
- `NativeSelectEditor`: lower priority (options are constrained). At minimum respect the same path; a
  select pick is explicit.

### 4e. `data-grid.tsx`
- Pass the new explicit/implicit commit callbacks down to `EditorPortal` (mirrors the existing
  `commit`/`cancel`/`commitAndMove` wiring around the `<EditorPortal .../>`).
- Fix the `onCellCommit` docstring (~L97–101): it currently says the promise drives the editor's
  "submitting/error states" — it actually drives the **cell's** pending overlay. Validation is a
  separate synchronous concern.

### 4f. `src/playground/pages/GridPlayground.tsx` (demo)
- Add a `validate` to a numeric column, e.g. `validate: (v) => { const n = Number(v); return n >= 10 && n <= 100 ? null : "Must be 10–100"; }`.
- The AntD editor already reads `ctx.status === "error"` for its red styling — confirm it now lights up
  on an explicit invalid commit. The `ctx.status === "submitting"` prop stays dead (async is optimistic);
  either leave it or drop it.

---

## 5. Tests

Existing `__tests__/core/store/edit-store.test.ts` covers `fail()` plus corrective error retention
and clearing — keep them.

Add behavior tests (`__tests__/data-grid.behavior.test.tsx`, an editable column with a `validate`):
- explicit invalid (Enter) → editor stays open, `onCellCommit` NOT called, error text shown.
- explicit valid (Enter) → commits + moves down.
- implicit invalid (blur / click another cell) → editor closes, value discarded, `onCellCommit` NOT called.
- implicit valid (blur) → commits.
- typing after an error → error remains until debounced validation accepts the corrected draft.
- `validate` receives the **parsed** value (use `parseValue: Number` + a numeric range, assert the arg).
- unchanged value → no-op close, `validate` NOT called.

Optionally a focused `useCellEditing` unit/interaction test for the explicit-vs-implicit branch.

---

## 6. Gotchas

- **Validate the parsed value, not the raw draft** (so `parseValue: Number` + range validation works,
  and NaN from a non-numeric draft is catchable).
- **Don't break save-on-blur for valid edits** — only the *invalid* implicit case discards.
- **`commitAndMove` must not move on failed validation** — that's why `startCommit` returns a boolean.
- **Don't `returnFocus()` when staying open** — the editor must keep focus to show/fix the error.
- **Pre-existing invalid data:** validation runs only when the value changed, so opening and closing an
  already-invalid cell (no edit) won't trap the user.
- **D1/D6 perf is safe:** all of this touches only the edit store + `EditorPortal` leaf; the windowed
  body never re-renders on edit. No virtualization impact.
- **`submitting` stays unused** after this. Leave it, or remove it separately — but it is *not* part of
  this feature.

---

## 7. Out of scope (confirm before expanding)

- **Async-in-editor / `submitting`**: keeping the editor open with a spinner *during* the async commit
  (non-optimistic). Would revive `submitting` and change commit UX. Not needed for validation.
- Cross-field / row-level validation; debounced/async validation; i18n of messages.
- Controlled validation state from the integrator.

---

## 8. Reference points (HEAD baseline)

- `hooks/useCellEditing.ts` — `startCommit` ~L99–141, `commitCell` ~L143, `commitAndMove` ~L150.
- `core/store/edit-store.ts` — `fail` ~L82, `error` state, `setDraft` error-clearing ~L66.
- `core/types/editing.ts` — `EditStatus` / `EditState`.
- `core/types/column.ts` — `CellEditContext` ~L39, `parseValue` ~L90 (add `validate` nearby).
- `editors/EditorPortal.tsx` — outside-click ~L187–196, ctx build ~L209–223.
- `editors/FloatingTextEditor.tsx` — `onKeyDown` ~L64, `onBlur` ~L88, `DefaultEditorApi` ~L22.
- `DECISIONS.md` — D4 (editing model), D10 (optimistic commit). Read these first.

**Estimate:** ~half a day. ~6 files + tests. No perf risk.
