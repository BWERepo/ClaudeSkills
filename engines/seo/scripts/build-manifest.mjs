#!/usr/bin/env node
// Regenerates engine-manifest.json from the files in this engine. ALLOWLIST semantics: every file must match an
// explicit classification rule (installer/bweseo-install.mjs → RULES); a file with no rule is an error — it is never
// packaged by default. Records the sha256 of every file. Run after ANY change to an engine file.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_NAME, buildManifest } from "../installer/bweseo-install.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { manifest, problems } = buildManifest(root);
if (problems.length) {
  problems.forEach((p) => console.error(`✗ ${p}`));
  process.exit(1);
}
writeFileSync(join(root, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n");
console.log(`✓ ${MANIFEST_NAME}: ${manifest.files.length} files · engine v${manifest.engineVersion} · schema ${manifest.schemaVersion} · ${manifest.requiredSkills.length} skills`);
void readFileSync;
