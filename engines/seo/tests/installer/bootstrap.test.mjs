import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const engine = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(engine, "scripts", "bootstrap.mjs");
const run = (project, args) => {
  const env = { ...process.env };
  delete env.BWESEO_ENGINE_HOME;
  return spawnSync(process.execPath, [script, "--project", project, ...args], { env, encoding: "utf8" });
};
const freshProject = () => {
  const dir = mkdtempSync(join(tmpdir(), "bweseo-boot-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
};

describe("scripts/bootstrap.mjs", () => {
  it("--dry-run changes nothing", () => {
    const dir = freshProject();
    try {
      const r = run(dir, ["--dry-run"]);
      expect(r.status).toBe(0);
      expect(existsSync(join(dir, "seo"))).toBe(false);
      expect(existsSync(join(dir, ".claude"))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("installs the engine and the skills into a project", () => {
    const dir = freshProject();
    try {
      const r = run(dir, []);
      expect(r.status).toBe(0);
      expect(existsSync(join(dir, "seo", "bweseo-install.json"))).toBe(true);
      expect(existsSync(join(dir, ".claude", "skills", "BWESEO", "SKILL.md"))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
