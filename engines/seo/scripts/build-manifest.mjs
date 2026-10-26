#!/usr/bin/env node
// Regenerates engine-manifest.json from the files in this engine. ALLOWLIST semantics: every file must match an
// explicit classification rule (installer/bweseo-install.mjs → RULES); a file with no rule is an error — it is never
// packaged by default. Records the sha256 of every file. Run after ANY change to an engine file.
//   node scripts/build-manifest.mjs            regenerate engine-manifest.json
//   node scripts/build-manifest.mjs --check    verify only: exit 1 if the committed manifest is stale (never writes; used by pull-request checks)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_NAME, buildManifest } from "../installer/bweseo-install.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { manifest, problems } = buildManifest(root);
if (problems.length) {
  problems.forEach((p) => console.error(`✗ ${p}`));
  process.exit(1);
}
const text = JSON.stringify(manifest, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const file = join(root, MANIFEST_NAME);
  if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
    console.error(`✗ ${MANIFEST_NAME} is stale: it does not match the files in this engine. Run: node scripts/build-manifest.mjs`);
    process.exit(1);
  }
  console.log(`✓ ${MANIFEST_NAME} is current: ${manifest.files.length} files · engine v${manifest.engineVersion}`);
  process.exit(0);
}
writeFileSync(join(root, MANIFEST_NAME), text);
console.log(`✓ ${MANIFEST_NAME}: ${manifest.files.length} files · engine v${manifest.engineVersion} · schema ${manifest.schemaVersion} · ${manifest.requiredSkills.length} skills`);
