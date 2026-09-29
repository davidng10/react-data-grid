import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "data-griddle-consumers-"));
const lib = join(root, "packages/data-griddle");
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
delete env.NODE_PATH;
for (const key of Object.keys(env))
  if (key.toLowerCase().startsWith("npm_config_")) delete env[key];
console.log(`Isolated consumers: ${scratch}`);
const dry = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: lib,
    env,
    encoding: "utf8",
  })
)[0];
const files = dry.files.map((f) => f.path);
for (const required of [
  "README.md",
  "LICENSE",
  "package.json",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/styles.css",
])
  assert(files.includes(required), `Missing ${required}`);
assert(
  files.every(
    (f) =>
      ["README.md", "LICENSE", "package.json"].includes(f) ||
      (f.startsWith("dist/") && !/__tests__|\.map$/.test(f))
  ),
  "tarball allowlist"
);
const packed = JSON.parse(
  execFileSync("npm", ["pack", "--json", "--pack-destination", scratch], {
    cwd: lib,
    env,
    encoding: "utf8",
  })
)[0];
const tarball = join(scratch, packed.filename);
writeFileSync(join(scratch, "pack.json"), JSON.stringify(dry, null, 2));
const matrix = [
  ["vite", "18"],
  ["vite", "19"],
  ["next-app", "19"],
  ["next-pages", "18"],
  ["next-pages", "19"],
];
const browser = await chromium.launch();
const results = [];
function run(cmd, args, cwd, log) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => {
      output += d;
    });
    child.stderr.on("data", (d) => {
      output += d;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      writeFileSync(log, output);
      code === 0
        ? resolveRun(output)
        : reject(
            new Error(
              `${cmd} ${args.join(" ")} failed (${code}); see ${log}\n${output.slice(-4000)}`
            )
          );
    });
  });
}
try {
  for (const [framework, major] of matrix) {
    const id = `${framework}-react${major}`;
    if (
      process.env.CONSUMER_FILTER &&
      !id.includes(process.env.CONSUMER_FILTER)
    )
      continue;
    const dir = join(scratch, id);
    mkdirSync(dir);
    cpSync(join(root, "fixtures", framework), dir, { recursive: true });
    cpSync(join(root, "fixtures/shared"), dir, { recursive: true });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json")));
    const react = major === "18" ? "18.3.1" : "19.2.6";
    Object.assign(pkg.dependencies, {
      react,
      "react-dom": react,
      "data-griddle": "file:./data-griddle.tgz",
    });
    Object.assign(pkg.devDependencies, {
      "@types/react": major === "18" ? "18.3.31" : "19.2.14",
      "@types/react-dom": major === "18" ? "18.3.7" : "19.2.3",
    });
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    cpSync(tarball, join(dir, "data-griddle.tgz"));
    const lockPath = join(root, "fixtures/locks", `${id}.json`);
    const locked = existsSync(lockPath);
    if (locked) {
      const lock = JSON.parse(readFileSync(lockPath));
      lock.packages["node_modules/data-griddle"].integrity = packed.integrity;
      writeFileSync(
        join(dir, "package-lock.json"),
        JSON.stringify(lock, null, 2)
      );
    }
    console.log(
      `${id}: ${locked ? "clean locked install" : "install and record lock"}`
    );
    await run(
      "npm",
      [locked ? "ci" : "install", "--no-audit", "--no-fund"],
      dir,
      join(dir, "install.log")
    );
    if (!locked) {
      mkdirSync(join(root, "fixtures/locks"), { recursive: true });
      cpSync(join(dir, "package-lock.json"), lockPath);
    }
    assert(
      realpathSync(join(dir, "node_modules/data-griddle")).startsWith(
        realpathSync(dir)
      ),
      "library must be installed, not linked to workspace"
    );
    await run("node", ["ssr.mjs"], dir, join(dir, "ssr.log"));
    console.log(`${id}: types and production build`);
    await run("npm", ["run", "build"], dir, join(dir, "build.log"));
    await run(
      "npx",
      ["--no-install", "tsc", "--noEmit"],
      dir,
      join(dir, "types.log")
    );
    // Test strict NodeNext declaration resolution independently of framework types.
    await run(
      "npx",
      [
        "--no-install",
        "tsc",
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "false",
        "--jsx",
        "react-jsx",
        "--module",
        "NodeNext",
        "--target",
        "ES2022",
        "types.tsx",
      ],
      dir,
      join(dir, "types-nodenext.log")
    );
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const marker = `consumer-${randomUUID()}.txt`;
    mkdirSync(join(dir, "public"), { recursive: true });
    writeFileSync(join(dir, "public", marker), id);
    if (framework === "vite") writeFileSync(join(dir, "dist", marker), id);
    const server = spawn(
      "npm",
      ["run", "start", "--", "--port", String(port)],
      { cwd: dir, env, detached: true, stdio: "ignore" }
    );
    try {
      const url = `http://127.0.0.1:${port}`;
      let response;
      for (let n = 0; n < 120; n++) {
        assert.equal(
          server.exitCode,
          null,
          "new consumer server must remain alive"
        );
        try {
          response = await fetch(url);
          if (response.ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 250));
      }
      assert(response?.ok, "production server starts");
      assert.equal(
        await (await fetch(`${url}/${marker}`)).text(),
        id,
        "server must be this run’s isolated consumer"
      );
      const html = await response.text();
      if (framework !== "vite") {
        assert(html.includes("Server-rendered explanation"));
        assert(html.includes("Consumer grid"));
      }
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (
          m.type() === "error" ||
          (m.type() === "warning" &&
            /hydrat|server|layoutEffect/i.test(m.text()))
        )
          errors.push(m.text());
      });
      await page.goto(url);
      const grid = page.getByRole("grid", {
        name: "Consumer grid",
        exact: true,
      });
      await page
        .getByRole("button", { name: "Focus first", exact: true })
        .click();
      await page.waitForFunction(() =>
        document
          .querySelector('[aria-label="Consumer grid"]')
          ?.getAttribute("aria-activedescendant")
      );
      assert.equal(
        await grid.evaluate((el) => getComputedStyle(el).overflowY),
        "auto",
        "library CSS supplies scrolling"
      );
      assert(
        await page
          .locator(".dgr-root")
          .first()
          .evaluate((el) => getComputedStyle(el).position === "relative"),
        "structural CSS retained"
      );
      await page.keyboard.press("Enter");
      const input = page.getByRole("textbox", {
        name: "Name, row 1",
        exact: true,
      });
      await input.waitFor();
      assert(
        await input.evaluate(
          (el) => !!el.closest(".dgr-editor-host") && !el.closest(".dgr-root")
        ),
        "editor lives in body portal"
      );
      await input.fill("Packed edit");
      await input.press("Enter");
      await page
        .getByRole("gridcell", { name: "Packed edit", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Focus first", exact: true })
        .click();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await page.getByRole("textbox", { name: "Status draft" }).waitFor();
      await page.getByRole("button", { name: "Use Away" }).click();
      assert.equal(
        await page.getByRole("textbox", { name: "Status draft" }).inputValue(),
        "Away"
      );
      await page.getByRole("button", { name: "Save status" }).click();
      await page.getByRole("gridcell", { name: "Away", exact: true }).waitFor();
      await grid
        .getByRole("checkbox", { name: "Select row 1", exact: true })
        .check();
      assert(
        await grid
          .getByRole("checkbox", { name: "Select row 1", exact: true })
          .isChecked()
      );
      await page.getByRole("button", { name: "Focus row 80" }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="Consumer grid"]')?.scrollTop >
          1000
      );
      await page.getByRole("button", { name: "Toggle loading" }).click();
      assert.equal(await grid.getAttribute("aria-busy"), "true");
      await page.getByRole("button", { name: "Toggle loading" }).click();
      await page.getByRole("button", { name: "Empty rows" }).click();
      await page.getByText("No rows", { exact: true }).waitFor();
      await page.getByRole("link", { name: "Other page", exact: true }).click();
      await page
        .getByRole("heading", { name: "Other page", exact: true })
        .waitFor();
      await page.getByRole("link", { name: "Return to grid" }).click();
      await page
        .getByRole("button", { name: "Focus first", exact: true })
        .click();
      await page.keyboard.press("Enter");
      await page
        .getByRole("textbox", { name: "Name, row 1", exact: true })
        .waitFor();
      assert.deepEqual(errors, [], "no hydration or browser errors");
      await page.screenshot({
        path: join(dir, "consumer.png"),
        fullPage: true,
      });
      await page.close();
      const versions = JSON.parse(
        execFileSync("npm", ["ls", "--depth=0", "--json"], {
          cwd: dir,
          env,
          encoding: "utf8",
        })
      );
      results.push({
        id,
        passed: true,
        versions: Object.fromEntries(
          Object.entries(versions.dependencies).map(([name, dep]) => [
            name,
            dep.version,
          ])
        ),
      });
      console.log(`${id}: PASS`);
    } finally {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {}
    }
  }
} finally {
  await browser.close();
  writeFileSync(
    join(scratch, "results.json"),
    JSON.stringify(results, null, 2)
  );
  console.log(`Evidence retained: ${scratch}`);
}
