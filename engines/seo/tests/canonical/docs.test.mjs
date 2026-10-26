// The master manual (BWESEO-SKILLS-AND-PROCEDURES.md) and the README must never silently disagree with the actual
// skills. These tests run the real checker against the real engine, and against tampered copies to prove it
// catches drift.

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const M = await import(pathToFileURL(join(ROOT, "scripts", "build-manual.mjs")).href);
const manual = readFileSync(join(ROOT, M.MANUAL_NAME), "utf8");
const skills = readdirSync(join(ROOT, "skills")).filter((n) => existsSync(join(ROOT, "skills", n, "SKILL.md"))).sort();

// A copy of just what the checker reads, so tampering never touches the real engine.
const copy = () => {
  const d = mkdtempSync(join(tmpdir(), "bweseo-docs-"));
  for (const p of ["skills", "docs", "src", "README.md", "VERSION", M.MANUAL_NAME]) cpSync(join(ROOT, p), join(d, p), { recursive: true });
  return d;
};

describe("master manual — BWESEO-SKILLS-AND-PROCEDURES.md", () => {
  it("exists, carries the engine and schema versions and says how the engine is located (no machine path)", () => {
    const version = readFileSync(join(ROOT, "VERSION"), "utf8").trim();
    expect(manual).toMatch(/^# BWESEO Skills and Procedures/);
    expect(manual).toContain(`Engine Version: ${version}`);
    expect(manual).toMatch(/Schema Version: \d+/);
    expect(manual).toMatch(/Last Updated: \d{4}-\d{2}-\d{2}/);
    expect(manual).toContain("BWESEO_ENGINE_HOME");
    expect(manual).not.toMatch(/\b[A-Za-z]:[\\/]/); // portable: no drive-letter path
  });

  it("documents EVERY actual skill, with every required field", () => {
    expect(skills.length).toBeGreaterThan(0);
    for (const s of skills) {
      expect(manual, s).toContain(`### ${s}`);
      const section = manual.slice(manual.indexOf(`### ${s}\n`)).split(/\n### |\n## /)[0];
      for (const f of ["SKILL NAME", "PURPOSE", "WHEN TO USE", "SYNTAX", "ARGUMENTS", "EXAMPLES", "INPUTS", "OUTPUTS", "AUTOMATIC ACTIONS", "HUMAN APPROVAL REQUIREMENTS", "EXTERNAL ACTIONS", "SAFETY RULES", "NEXT TYPICAL STEP"]) expect(section, `${s} / ${f}`).toContain(`**${f}`);
    }
  });

  it("lists every skill in the command quick-reference table, generated from the skill catalog", () => {
    const table = manual.slice(manual.indexOf("## Command Quick Reference"), manual.indexOf("## Master SEO Procedure"));
    expect(table).toContain("| Command | Purpose | Typical Usage | Arguments | Human Approval? | External Effect? |");
    for (const s of skills) expect(table, s).toContain(`| \`/${s}\` |`);
  });

  it("contains no nonexistent skill", () => {
    const known = new Set(skills);
    for (const c of new Set(manual.match(/\/BWESEO[A-Za-z]*/g) ?? [])) expect(c === "/BWESEO" || known.has(c.slice(1)), `${c} is not a skill`).toBe(true);
  });

  it("has every required section, in a table of contents", () => {
    for (const h of ["Quick Start", "Complete Skill Catalog", "Command Quick Reference", "Master SEO Procedure", "Adding a New SEO Page", "Page-Specific /BWESEO", "Installing BWESEO on a New Customer Website", "Updating BWESEO on an Existing Website", "Google Search Workflow", "Live Site Health", "SEO Opportunity Procedure", "Content Creation Procedure", "Technical SEO Procedure", "Local SEO Procedure", "Monitoring Procedure", "Content Refresh Procedure", "Troubleshooting", "Human Approval Gates", "State Model Reference", "Directory Reference", "Engine Maintenance", "What Do I Run?"]) {
      expect(manual, h).toContain(`## ${h}`);
      expect(manual.slice(0, manual.indexOf("## Quick Start")), `TOC: ${h}`).toContain(`[${h}]`);
    }
  });

  it("states the permanent Google rules and the lifecycle-vs-health rule", () => {
    for (const s of ["PUBLISHED ≠ DISCOVERED", "DISCOVERED ≠ CRAWLED", "CRAWLED ≠ INDEXED", "INDEXING REQUESTED ≠ INDEXED", "SITEMAP SUCCESS ≠ INDEXED", "LIVE URL TEST PASSED ≠ INDEXED"]) expect(manual, s).toContain(s);
    expect(manual).toMatch(/must never automatically reverse a completed lifecycle milestone/);
    for (const c of ["200", "301 / 302", "404 / 410", "429", "502", "504", "Cloudflare 52x", "Timeout, DNS failure, connection failure"]) expect(manual, c).toContain(c);
  });

  it("documents every troubleshooting scenario asked for, each with what NOT to do", () => {
    for (const t of ["Page not indexed", "Page not discovered", "Sitemap missing a URL", "Sitemap error", "Production 404", "Production 522", "Incorrect canonical", "Robots blocking a page", "Noindex on production", "Search Console API unavailable", "Search Console permissions failure", "Analytics unavailable", "Staging appears in Google", "BWESEO state disagrees with the live site", "Engine version mismatch", "/BWESEOInstall verification failure"]) expect(manual, t).toContain(`### ${t}`);
    expect((manual.match(/\*\*Do not/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });

  it("uses fictional examples only and carries no secret or customer data", () => {
    expect(manual).toContain("acme-plumbing.example");
    expect(manual).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|ya29\./);
  });
});

describe("documentation validation — the manual cannot silently go stale", () => {
  it("the real engine passes every check", () => {
    expect(M.checkManual(ROOT)).toEqual([]);
  });

  it("README.md links to the master manual", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain("(BWESEO-SKILLS-AND-PROCEDURES.md)");
    const flat = readme.replace(/\s*\n>?\s*/g, " "); // the sentence is wrapped in a block quote
    expect(flat).toMatch(/complete command reference, SEO lifecycle, installation instructions, Google workflow, troubleshooting, and operating procedures/);
    for (const h of ["What BWESEO is", "Architecture", "Quick install", "Updating", "Verifying", "Security", "Customer isolation", "Versioning", "Development", "Backup / recovery"]) expect(readme, h).toContain(`## ${h}`);
  });

  it("a skill that exists but is undocumented is reported", () => {
    const d = copy();
    try {
      cpSync(join(d, "skills", "BWESEOAudit"), join(d, "skills", "BWESEOBrandNew"), { recursive: true });
      writeFileSync(join(d, "skills", "BWESEOBrandNew", "SKILL.md"), readFileSync(join(d, "skills", "BWESEOBrandNew", "SKILL.md"), "utf8").replace("name: BWESEOAudit", "name: BWESEOBrandNew"));
      expect(M.checkManual(d).join("\n")).toMatch(/skill BWESEOBrandNew exists but is undocumented/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("documentation that references a nonexistent skill is reported", () => {
    const d = copy();
    try {
      const f = join(d, "docs", "skills-reference.json");
      const j = JSON.parse(readFileSync(f, "utf8"));
      j.skills.BWESEOGhost = j.skills.BWESEOAudit;
      writeFileSync(f, JSON.stringify(j));
      expect(M.checkManual(d).join("\n")).toMatch(/documentation references nonexistent skill BWESEOGhost/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("documented syntax that the skill does not support is reported", () => {
    const d = copy();
    try {
      const f = join(d, "docs", "skills-reference.json");
      const j = JSON.parse(readFileSync(f, "utf8"));
      j.skills.BWESEOInstall.syntax.push("/BWESEOInstall --teleport");
      j.skills.BWESEOAudit.syntax.push("/BWESEOReport --wrong-skill");
      writeFileSync(f, JSON.stringify(j));
      const p = M.checkManual(d).join("\n");
      expect(p).toMatch(/BWESEOInstall: documented syntax "\/BWESEOInstall --teleport" uses --teleport/);
      expect(p).toMatch(/BWESEOAudit: documented syntax "\/BWESEOReport --wrong-skill" does not start with \/BWESEOAudit/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("a stale manual is reported, and a README without the link is reported", () => {
    const d = copy();
    try {
      writeFileSync(join(d, M.MANUAL_NAME), readFileSync(join(d, M.MANUAL_NAME), "utf8") + "\nstale edit\n");
      writeFileSync(join(d, "README.md"), "# BWESEO Engine\n");
      const p = M.checkManual(d).join("\n");
      expect(p).toMatch(/is stale/);
      expect(p).toMatch(/README\.md does not link to BWESEO-SKILLS-AND-PROCEDURES\.md/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("every top-level entry of the engine has a directory description (the reference cannot go stale)", () => {
    const top = readdirSync(ROOT).filter((n) => n !== ".git" && n !== "node_modules");
    for (const n of top) expect(M.DIRECTORY_DESCRIPTIONS[n], `top-level "${n}" has no description`).toBeTruthy();
  });
});

describe("PROJECT_STATUS.md current-status lines are validated against VERSION and skills/", () => {
  const withStatus = (edit) => {
    const d = copy(); cpSync(join(ROOT, "PROJECT_STATUS.md"), join(d, "PROJECT_STATUS.md"));
    const f = join(d, "PROJECT_STATUS.md"); writeFileSync(f, edit(readFileSync(f, "utf8")));
    return d;
  };
  it("the real status file agrees with the engine", () => {
    expect(M.checkStatusFacts(ROOT)).toEqual([]);
  });
  it("catches a stale current version", () => {
    const d = withStatus((t) => t.replace(/(Current engine version: \*\*)[^*]+/, "$11.10.0"));
    expect(M.checkStatusFacts(d).join(" ")).toMatch(/current engine version is 1\.10\.0, but VERSION is/);
    rmSync(d, { recursive: true, force: true });
  });
  it("catches a stale skill count and a skill missing from the list", () => {
    const d = withStatus((t) => t.replace(/## Skills \(\d+/, "## Skills (17").replace(" Landing,", ""));
    const msg = M.checkStatusFacts(d).join(" ");
    expect(msg).toMatch(/says 17 canonical skills/);
    expect(msg).toMatch(/does not mention BWESEOLanding/);
    rmSync(d, { recursive: true, force: true });
  });
  it("is part of checkConsistency", () => {
    const d = withStatus((t) => t.replace(/(Current engine version: \*\*)[^*]+/, "$10.0.1"));
    expect(M.checkConsistency(d).join(" ")).toMatch(/PROJECT_STATUS\.md/);
    rmSync(d, { recursive: true, force: true });
  });
});
