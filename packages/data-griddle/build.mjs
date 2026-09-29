import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { build, context } from "esbuild";

const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  packages: "external",
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "dist/index.js",
  banner: { js: '"use client";' },
  logLevel: "info",
};
function declarations() {
  writeFileSync("dist/styles.css.d.ts", "export {};\n");
  execFileSync("tsc", ["-p", "tsconfig.build.json"], { stdio: "inherit" });
  // Make the declarations consumable with NodeNext as well as bundler resolution.
  for (const file of readdirSync("dist", { recursive: true }).filter((f) =>
    f.endsWith(".d.ts")
  )) {
    const path = `dist/${file}`;
    writeFileSync(
      path,
      readFileSync(path, "utf8")
        .replace(
          /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
          (_, start, spec, end) =>
            start +
            spec +
            (existsSync(resolve(dirname(path), spec + ".d.ts"))
              ? ".js"
              : "/index.js") +
            end
        )
        .replace(/^import ["'].*\.css["'];?\n/gm, "")
    );
  }
}
rmSync("dist", { recursive: true, force: true });
await build(options);
renameSync("dist/index.css", "dist/styles.css");
declarations();
if (process.argv.includes("--watch")) {
  options.plugins = [
    {
      name: "finish",
      setup(b) {
        b.onEnd((result) => {
          if (!result.errors.length) {
            renameSync("dist/index.css", "dist/styles.css");
            declarations();
          }
        });
      },
    },
  ];
  await (await context(options)).watch();
}
