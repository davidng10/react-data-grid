// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataGrid } from "../index";

import type { Column } from "../index";

const columns: Column<{ id: number; name: string }>[] = [
  { id: "name", name: "Name", accessor: (row) => row.name, editable: true },
];
describe("server rendering", () => {
  it.each([{ rows: null }, { rows: [] }, { rows: [{ id: 1, name: "Ada" }] }])(
    "renders a named shell for %j without browser globals",
    ({ rows }) => {
      const html = renderToString(
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(row) => row.id}
          enableRowSelection
          aria-label="SSR grid"
        />
      );
      expect(html).toContain('role="grid"');
      expect(html).toContain('aria-label="SSR grid"');
    }
  );
  it("renders initial loading on the server", () => {
    expect(
      renderToString(
        <DataGrid
          rows={null}
          loading
          columns={columns}
          getRowId={(row) => row.id}
        />
      )
    ).toContain('aria-busy="true"');
  });
});
