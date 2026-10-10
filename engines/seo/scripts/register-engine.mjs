#!/usr/bin/env node
// Records where THIS canonical engine lives on this machine (~/.claude/bweseo/engine-location.json), so
// /BWESEOInstall and the skills can find it without any hard-coded path. Run once per machine, or after moving
// the engine. Refuses an engine whose manifest does not validate. Changes nothing inside the engine.
//
//   node scripts/register-engine.mjs           register this engine
//   node scripts/register-engine.mjs --check   read-only: show which engine would be used and how it was found
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { engineLocationFile, locateEngine, registerEngineLocation } from "../installer/bweseo-install.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.includes("--check")) {
  const found = locateEngine();
  if (!found) {
    console.log("✗ no BWESEO engine can be located — run: node " + resolve(root, "scripts/register-engine.mjs"));
    process.exit(1);
  }
  const same = resolve(found.dir).toLowerCase() === root.toLowerCase();
  console.log(`Engine ........ ${found.dir}`);
  console.log(`Found via ..... ${found.source}${found.deprecated ? "  ⚠ DEPRECATED — register the canonical engine" : ""}`);
  console.log(`Is this one ... ${same ? "yes" : "no (this script's engine is " + root + ")"}`);
  process.exit(found.deprecated ? 2 : 0);
}
const r = registerEngineLocation(root);
console.log(r.ok ? `✓ engine ${r.engineVersion} registered in ${engineLocationFile()}` : `✗ ${r.reason}`);
process.exit(r.ok ? 0 : 1);
