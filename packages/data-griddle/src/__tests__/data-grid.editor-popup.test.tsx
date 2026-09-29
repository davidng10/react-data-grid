import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataGrid } from "../index";

import type { DataGridHandle } from "../index";

describe("custom editor popup containment", () => {
  it("keeps a nested popup interaction inside the draft until an explicit save", () => {
    const onCellCommit = vi.fn();
    const ref = createRef<DataGridHandle>();
    const { container } = render(
      <DataGrid
        ref={ref}
        rows={[{ id: 1, name: "Ada" }]}
        getRowId={(row) => row.id}
        onCellCommit={onCellCommit}
        columns={[
          {
            id: "name",
            name: "Name",
            accessor: (row) => row.name,
            editable: true,
            renderEditor: (ctx) => (
              <div>
                <input
                  autoFocus
                  aria-label="Name draft"
                  value={String(ctx.draft)}
                  onChange={(event) => ctx.setDraft(event.target.value)}
                />
                <div
                  role="group"
                  aria-label="Suggestions"
                  style={{ position: "absolute", top: "100%" }}
                >
                  <button type="button" onClick={() => ctx.setDraft("Grace")}>
                    Use Grace
                  </button>
                  <button type="button" onClick={ctx.commit}>
                    Save
                  </button>
                </div>
              </div>
            ),
          },
        ]}
      />
    );
    act(() => {
      ref.current!.focusCell({ rowId: 1, columnId: "name" });
    });
    fireEvent.keyDown(container.querySelector("[data-grid-scroller]")!, {
      key: "Enter",
    });
    const pick = screen.getByRole("button", { name: "Use Grace" });
    expect(pick.closest(".dgr-editor-host")).not.toBeNull();
    fireEvent.pointerDown(pick);
    fireEvent.blur(screen.getByRole("textbox"), { relatedTarget: pick });
    fireEvent.click(pick);
    expect(onCellCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("Grace");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onCellCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: 1,
        columnId: "name",
        nextValue: "Grace",
      })
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
