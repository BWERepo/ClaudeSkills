// Marks the CLI entry point executable after `tsc`, and copies the admin dashboard's static assets
// (tsc only emits .ts files; the admin server serves these next to its own compiled output).
import { chmodSync, copyFileSync, existsSync } from "node:fs";

const cli = new URL("../dist/cli/main.js", import.meta.url);
if (existsSync(cli)) chmodSync(cli, 0o755);

for (const name of ["index.html", "dashboard.css", "dashboard.js"]) {
  const src = new URL(`../src/admin/${name}`, import.meta.url);
  const dest = new URL(`../dist/admin/${name}`, import.meta.url);
  if (existsSync(src)) copyFileSync(src, dest);
}
