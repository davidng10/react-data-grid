import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const out = new URL("../apps/docs/out/", import.meta.url);
const html = readFileSync(new URL("index.html", out), "utf8");
assert.equal((html.match(/role="grid"/g) ?? []).length, 1);
assert.doesNotMatch(html, /<nav|<header|<h1|<article|<pre/);
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const url = `http://127.0.0.1:${port}`;
const marker = new URL(`docs-${randomUUID()}.txt`, out);
writeFileSync(marker, marker.pathname);
const server = spawn(
  "python3",
  [
    "-m",
    "http.server",
    String(port),
    "--bind",
    "127.0.0.1",
    "--directory",
    out.pathname,
  ],
  { stdio: "ignore" }
);
const browser = await chromium.launch();
const evidence = mkdtempSync(join(tmpdir(), "data-griddle-docs-"));
try {
  for (let n = 0; n < 80; n++) {
    assert.equal(server.exitCode, null, "docs server must remain alive");
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    await (await fetch(`${url}/${marker.pathname.split("/").pop()}`)).text(),
    marker.pathname,
    "this run serves the current docs export"
  );
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (/hydrat/i.test(m.text())) errors.push(m.text());
  });
  await page.goto(url);
  assert.equal(await page.getByRole("grid").count(), 1);
  assert.equal(
    await page.locator("body").evaluate((body) => {
      const copy = body.cloneNode(true);
      copy
        .querySelectorAll(".dgr-root, script, style, next-route-announcer")
        .forEach((el) => el.remove());
      return copy.textContent.trim();
    }),
    "",
    "no text outside the grid"
  );
  const grid = page.getByRole("grid", { name: "People example" });
  await grid.getByRole("gridcell", { name: "Ada", exact: true }).click();
  await page.keyboard.press("Enter");
  await page
    .getByRole("textbox", { name: "Name, row 1" })
    .fill("Documentation edit");
  await page.keyboard.press("Enter");
  await page.getByRole("gridcell", { name: "Documentation edit" }).waitFor();
  await page.screenshot({ path: join(evidence, "home.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    "docs fit narrow viewport"
  );
  await page.screenshot({ path: join(evidence, "mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    `Single-grid page, no surrounding text, hydration, editing and narrow layout passed. Screenshots: ${evidence}`
  );
} finally {
  await browser.close();
  server.kill();
  unlinkSync(marker);
}
