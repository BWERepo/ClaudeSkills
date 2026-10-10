// The operating guide (docs/OPERATING-GUIDE.md) must never silently disagree with the engine. These tests run the real checker
// against the real engine, and against tampered copies to prove it catches drift in both directions.

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const G = await import(pathToFileURL(join(ROOT, "scripts", "show-guide.mjs")).href);

// A copy of just what the checker reads, so tampering never touches the real engine.
const withCopy = (tamper) => {
  const d = mkdtempSync(join(tmpdir(), "bweseo-guide-"));
  try {
    for (const p of ["docs", "scripts", "src", "installer", "templates", "skills", ".claude", "package.json", "README.md", "PROJECT_STATUS.md", "BWESEO-SKILLS-AND-PROCEDURES.md"])
      cpSync(join(ROOT, p), join(d, p), { recursive: true });
    tamper(d);
    return G.checkGuide(d);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
};
const edit = (d, p, fn) => writeFileSync(join(d, p), fn(readFileSync(join(d, p), "utf8")));

describe("operating guide — docs/OPERATING-GUIDE.md", () => {
  it("matches the real engine", () => {
    expect(G.checkGuide(ROOT)).toEqual([]);
  });

  it("is portable: no drive-letter or personal path", () => {
    const guide = readFileSync(join(ROOT, G.GUIDE_PATH), "utf8");
    expect(guide).not.toMatch(/\b[A-Za-z]:[\\/]/);
    expect(guide).not.toMatch(/\/(home|Users)\/[a-z]/i);
  });

  it("catches a command the guide names that no longer exists", () => {
    const p = withCopy((d) => edit(d, G.GUIDE_PATH, (t) => t + "\nRun `node scripts/gone.mjs` and `npm run gone`.\n"));
    expect(p.join("\n")).toContain("scripts/gone.mjs");
    expect(p.join("\n")).toContain('npm run gone"');
  });

  it("catches a seo/tools subcommand or flag the tool does not have", () => {
    const p = withCopy((d) => edit(d, G.GUIDE_PATH, (t) => t + "\n`node seo/tools/seo-keywords.mjs frobnicate --sideways`\n"));
    expect(p.join("\n")).toContain('subcommand "frobnicate"');
    expect(p.join("\n")).toContain("--sideways");
  });

  it("catches a new script, npm script or seo/tools command that the guide does not mention", () => {
    const p = withCopy((d) => {
      writeFileSync(join(d, "scripts", "new-thing.mjs"), "// new\n");
      edit(d, "package.json", (t) => t.replace('"test":', '"lint": "node scripts/new-thing.mjs",\n    "test":'));
      writeFileSync(join(d, "src", "new-tool.mjs"), "// Usage: node seo/tools/new-tool.mjs\n");
    });
    expect(p.join("\n")).toContain("scripts/new-thing.mjs is not in the guide");
    expect(p.join("\n")).toContain('npm script "lint"');
    expect(p.join("\n")).toContain("seo/tools/new-tool.mjs is not in the guide");
  });

  it("catches a new installer flag that the guide does not mention", () => {
    const p = withCopy((d) => edit(d, "installer/bweseo-install.mjs", (t) => t.replace("//   options: --project <dir>", "//   options: --brand-new  --project <dir>")));
    expect(p).toContain("the installer flag --brand-new is not in the guide");
  });
});
