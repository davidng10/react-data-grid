import { createElement } from "react";
import assert from "node:assert/strict";
import { DataGrid } from "data-griddle";
import { renderToString } from "react-dom/server";

const errors = [];
const original = console.error;
console.error = (...args) => errors.push(args.join(" "));
try {
  for (const rows of [null, [], [{ id: 1, name: "Ada" }]]) {
    const html = renderToString(
      createElement(DataGrid, {
        rows,
        loading: rows === null,
        columns: [{ id: "name", name: "Name", accessor: (row) => row.name }],
        getRowId: (row) => row.id,
        enableRowSelection: true,
        "aria-label": "Server grid",
      })
    );
    assert(html.includes('role="grid"'));
    assert(html.includes('aria-label="Server grid"'));
  }
} finally {
  console.error = original;
}
assert.deepEqual(errors, [], "SSR must not warn or access browser globals");
console.log("Direct Node SSR passed");
