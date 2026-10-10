#!/usr/bin/env node
// One-command install of BWESEO into a website project: syncs the Claude skills into the project's
// .claude/skills, installs the engine, then verifies. The engine is this checkout (found from this file's
// location), so BWESEO_ENGINE_HOME does not need to be set.
//
//   node <engine>/scripts/bootstrap.mjs [--project <dir>] [--dry-run] [--user-skills]
//     --dry-run      show the plan for the skills and the engine install; change nothing
//     --user-skills  put the skills in the user-level ~/.claude/skills instead of the project
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const engine = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const pi = args.indexOf("--project");
const project = resolve(pi >= 0 && args[pi + 1] ? args[pi + 1] : process.cwd());
const dry = flag("--dry-run");
const installer = join(engine, "installer", "bweseo-install.mjs");
const env = { ...process.env, BWESEO_ENGINE_HOME: engine };
if (flag("--user-skills")) delete env.BWESEO_SKILLS_DIR;
else env.BWESEO_SKILLS_DIR = join(project, ".claude", "skills");

const run = (label, extra) => {
  console.log(`\n== ${label} ==`);
  const r = spawnSync(process.execPath, [installer, ...extra], { cwd: project, env, stdio: "inherit" });
  return r.status ?? 1;
};

// Engine first: the installer refuses a project with uncommitted changes, and syncing the skills creates some.
const steps = [["Engine install", dry ? ["--dry-run"] : []], ["Skills", ["--sync-skills", ...(dry ? ["--dry-run"] : [])]]];
if (!dry) steps.push(["Verify", ["--verify"]]);
for (const [label, extra] of steps) {
  const code = run(label, extra);
  if (code !== 0) {
    console.error(`\n✗ ${label} stopped with exit code ${code}; nothing further was run.`);
    process.exit(code);
  }
}
console.log(dry ? "\nDry run complete. Run again without --dry-run to install." : "\n✓ BWESEO installed. Next: open the project in Claude Code and run /BWESEOSetup, then /BWESEO.");
