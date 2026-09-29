# Packed-package verification

Run `pnpm exec playwright install chromium`, then `pnpm check:consumers` from the root.
These directories are templates, deliberately excluded from the pnpm workspace.
The script builds and packs the library, checks `npm pack --dry-run`, copies each
consumer and the shared example into an OS temporary directory, and installs the
actual tarball. There are no source aliases, workspace links or repository runtime
dependencies available to the consumer. Playwright runs from the root as the driver.

The matrix pins React/DOM 18.3.1 with types 18.3.31/18.3.7, or React/DOM 19.2.6
with types 19.2.14/19.2.3. Vite is 8.0.12, Next is 16.3.6, TypeScript is 6.0.2.
App Router runs React 19; Pages Router and Vite run both pairs. Next App Router
uses its framework-selected React implementation, so Vite and direct Node SSR are
the independent evidence for the declared React versions.

`locks/` pins transitive consumer dependencies. Subsequent runs use `npm ci` with
only the local tarball integrity updated to the newly built artifact. To deliberately
refresh a fixture lock, remove that matrix entry's lock and run the check again.
`CONSUMER_FILTER=vite-react18 pnpm check:consumers` selects a diagnostic subset;
a partial run does not establish the full matrix.

Checks: direct Node SSR without DOM globals or warnings; strict declaration checks
with Bundler and NodeNext resolution (strict library declarations independently of
Next Pages Router’s skipLibCheck setting; see docs/PACKAGE_VERIFICATION.md); production builds; initial Next HTML; Chromium
hydration without errors; stylesheet retention without docs CSS; keyboard focus and
offscreen scrolling; row selection; built-in editing; custom editor popup containment
and body portals; initial/refresh/empty states; navigation away and back, then editing.
Temporary directories retain install/build/type/SSR logs, lockfiles, screenshots and
exact-version results. This is desktop Chromium evidence, not a full browser/mobile/AT
support claim. No publish or deploy command runs.

## Editing shared examples locally

Root development dependencies on `data-griddle` and `next` expose the library's
public built exports and matching Next.js types to the editor. `fixtures/tsconfig.json` gives `shared/*.tsx`
an explicit TypeScript project; `pnpm lint:fixtures` checks it and all three framework
fixture projects. Each framework has a local `Example.tsx` forwarding entry; the
consumer runner replaces it with the shared implementation before installation. Run `pnpm build:lib`
after a fresh install, or use `pnpm dev` to keep declarations rebuilt while editing.

This local editor check is not package-consumer evidence. The parent fixture config
is not copied into isolated consumers; their dependencies still come from the actual
tarball and their own lockfiles. No source alias is used.
