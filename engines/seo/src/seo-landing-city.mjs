#!/usr/bin/env node
// BWESEO City Landing Pages — developer CLI (Node 18+). Never deploys, publishes, redirects or submits anything.
// Steps (the wizard): add -> brief -> draft -> package -> approve -> (owner deploys) -> published -> verify
//
//   node seo/tools/seo-landing-city.mjs add "<City>" <ST> [--service web-design] [--path /x] [--home-base "<Place>"]
//   node seo/tools/seo-landing-city.mjs brief <id> --file brief.json          research brief (facts, sources, availability)
//   node seo/tools/seo-landing-city.mjs draft <id> --page page.json           page content; runs the quality gate and readiness checks
//   node seo/tools/seo-landing-city.mjs status                                registry table
//   node seo/tools/seo-landing-city.mjs package --origin <url> --sitemap sitemap.xml --robots robots.txt [--prices "$1,$2"] [--cta "<text>"] [--existing "/a,/b"]
//   node seo/tools/seo-landing-city.mjs approve --package <hash> --by "<name>"   approval is bound to that exact package
//   node seo/tools/seo-landing-city.mjs published <id> --by "<name>"             record that the owner deployed it (needs a matching approval)
//   node seo/tools/seo-landing-city.mjs verify --origin <url>                 fetch the live pages, sitemap and robots.txt and report
//
// Data: seo/data/landing/cities.json (private). Reports: docs/seo/reports/city-*.json.
import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "./safe-write.mjs";
import { dirname, join, resolve } from "node:path";
import { upsertEntry, checkBrief, cityReadiness, stampPublicChange, cityId, releasePackage, normalizePath } from "./landing-city.mjs";
import { checkPage } from "./landing-quality.mjs";
import { extractHead, parseSitemap, parseRobots, robotsAllows } from "./post-publish-check.mjs";

const flag = (a, n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d);
const statePath = (cwd) => join(cwd, "seo", "data", "landing", "cities.json");
const write = (p, text) => writeFileAtomic(p, text);
const today = (now) => now.toISOString().slice(0, 10);

export function loadCities(cwd) { return readJson(statePath(cwd), { version: 1, entries: [], briefs: {}, approval: null }); }
const save = (cwd, s) => write(statePath(cwd), JSON.stringify(s, null, 2) + "\n");

export async function main(argv, { cwd = process.cwd(), out = (s) => console.log(s), fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const [cmd, ...rest] = argv;
  const s = loadCities(cwd);
  const inv = readJson(join(cwd, "seo", "content-inventory.json"), { pages: [] });
  const existingPaths = inv.pages.filter((p) => p.status !== "rejected" && p.status !== "idea").map((p) => p.url);
  const byId = (id) => s.entries.find((e) => e.id === id);

  if (cmd === "add") {
    const [city, state] = rest;
    if (!city || !state) { out('usage: add "<City>" <ST> [--service s] [--path /x] [--home-base "<Place>"]'); return 1; }
    const service = flag(rest, "--service") ?? "web-design";
    const r = upsertEntry(s, { city, state, service, path: flag(rest, "--path") ?? undefined, homeBase: flag(rest, "--home-base") ?? "", status: "draft", indexable: true }, { existingPaths });
    if (!r.ok) { out(`refused: ${r.reason}`); return 1; }
    save(cwd, { ...s, ...r.registry }); out(`${r.created ? "added" : "already registered"}: ${cityId(city, state, service)}`); return 0;
  }
  if (cmd === "status" || !cmd) {
    if (!s.entries.length) { out("no city pages registered. Run: add \"<City>\" <ST>"); return 0; }
    for (const e of s.entries) out(`${e.id} [${e.status}] ${e.path}  brief:${s.briefs[e.id] ? (checkBrief(s.briefs[e.id]).ok ? "ok" : "blocked") : "none"}  lastmod:${e.lastmod ?? "-"}  verified:${e.verifiedOn ?? "no"}`);
    return 0;
  }
  if (cmd === "package") {
    const origin = flag(rest, "--origin"); const sm = flag(rest, "--sitemap"); const rb = flag(rest, "--robots");
    if (!origin || !sm || !rb) { out("package needs --origin, --sitemap <file> and --robots <file> (copies of the live files)"); return 1; }
    const entries = s.entries.filter((e) => ["review-required", "approved", "published"].includes(e.status));
    if (!entries.length) { out("nothing to package: no entry is ready for review"); return 1; }
    const pkg = releasePackage({ entries: entries.map((e) => ({ ...e, status: "published" })), currentSitemapXml: readFileSync(resolve(cwd, sm), "utf8"), origin, today: today(now), robotsTxt: readFileSync(resolve(cwd, rb), "utf8"), existingPaths: [...existingPaths, ...(flag(rest, "--existing") ?? "").split(",").filter(Boolean)], approval: s.approval });
    const file = join(cwd, "docs", "seo", "reports", `city-release-${today(now)}.json`);
    write(file, JSON.stringify(pkg, null, 2) + "\n");
    s.pendingPackage = pkg.packageHash; save(cwd, s);
    out(`package ${pkg.packageHash}\n  sitemap: +${pkg.sitemap.adds?.length ?? 0} -${pkg.sitemap.removes?.length ?? 0}, ${pkg.sitemap.unrelatedKept ?? 0} unrelated kept${pkg.sitemap.ok === false ? " (SITEMAP PROBLEM: " + pkg.sitemap.reason + ")" : ""}\n  robots: ${pkg.robots.ok ? "ok" : pkg.robots.findings.join("; ")}\n  broken links: ${pkg.links.broken.length}\n  written: ${file}\nNothing is deployed. Approve with: approve --package ${pkg.packageHash} --by "<name>"`);
    return pkg.sitemap.ok === false || !pkg.robots.ok ? 1 : 0;
  }
  if (cmd === "approve") {
    const hash = flag(rest, "--package"); const by = flag(rest, "--by");
    if (!by?.trim()) { out("approval needs --by \"<name>\""); return 1; }
    if (!hash || hash !== s.pendingPackage) { out("refused: that is not the latest package (run package again; any change voids an approval)"); return 1; }
    s.approval = { packageHash: hash, by: by.trim(), on: today(now) };
    for (const e of s.entries) if (e.status === "review-required") e.status = "approved";
    save(cwd, s); out(`approved package ${hash} by ${by.trim()}. This does not deploy anything.`); return 0;
  }
  if (cmd === "verify") {
    const origin = flag(rest, "--origin");
    if (!origin || !fetchImpl) { out("verify needs --origin <url>"); return 1; }
    const targets = s.entries.filter((e) => e.status === "published");
    if (!targets.length) { out("no entry is recorded as published; nothing to verify"); return 1; }
    const get = async (u) => { try { const r = await fetchImpl(u, { redirect: "manual" }); return { status: r.status, text: await r.text(), headers: r.headers }; } catch (e) { return { status: 0, text: "", error: String(e.message ?? e), headers: new Headers() }; } };
    const [sm, rb] = [await get(origin + "/sitemap.xml"), await get(origin + "/robots.txt")];
    const smx = parseSitemap(sm.text); const robots = parseRobots(rb.text);
    const report = { generatedAt: now.toISOString(), origin, sitemapOk: sm.status === 200 && !smx.malformed, robotsReferencesSitemap: robots.sitemaps.includes(origin + "/sitemap.xml"), pages: [] };
    for (const e of targets) {
      const url = origin + e.path; const r = await get(url); const h = r.status === 200 ? extractHead(r.text) : null; const f = [];
      if (r.status !== 200) f.push(`status ${r.status}`);
      const canon = h?.canonicals ?? [];
      if (h && canon.length !== 1) f.push(`${canon.length} canonical tags`); else if (canon[0] && canon[0] !== url) f.push(`canonical ${canon[0]}`);
      if (/noindex/i.test(`${(h?.robots ?? []).join(" ")} ${r.headers.get?.("x-robots-tag") ?? ""}`)) f.push("noindex");
      if (!robotsAllows(robots, "Googlebot", e.path).allowed) f.push("blocked by robots.txt");
      const rows = smx.entries.filter((x) => x.loc === url);
      if (rows.length !== 1) f.push(`in sitemap ${rows.length} times`); else if (e.lastmod && rows[0].lastmod && rows[0].lastmod !== e.lastmod) f.push(`sitemap lastmod ${rows[0].lastmod} differs from ${e.lastmod}`);
      report.pages.push({ id: e.id, url, ok: f.length === 0, findings: f });
    }
    report.passed = report.sitemapOk && report.robotsReferencesSitemap && report.pages.every((p) => p.ok);
    const file = join(cwd, "docs", "seo", "reports", `city-verify-${today(now)}.json`); write(file, JSON.stringify(report, null, 2) + "\n");
    if (report.passed) for (const e of targets) e.verifiedOn = today(now);
    save(cwd, s);
    out(report.pages.map((p) => `${p.ok ? "PASS" : "FAIL"} ${p.url} ${p.findings.join("; ")}`).join("\n") + `\nsitemap ${report.sitemapOk ? "ok" : "PROBLEM"}, robots ${report.robotsReferencesSitemap ? "references sitemap" : "MISSING sitemap line"}\n${report.passed ? "VERIFIED" : "NOT VERIFIED"} (report: ${file}). Verified is not indexed: indexing is only known from Search Console.`);
    return report.passed ? 0 : 1;
  }

  const e = byId(rest[0]);
  if (!e) { out(`unknown city page "${rest[0] ?? ""}" (run status)`); return 1; }
  if (cmd === "brief") {
    const b = readJson(resolve(cwd, flag(rest, "--file") ?? ""), null);
    if (!b) { out("brief needs --file brief.json"); return 1; }
    s.briefs[e.id] = b; const c = checkBrief(b); e.status = c.ok ? "researching" : "draft"; save(cwd, s);
    out(c.findings.map((f) => `${f.level.toUpperCase()} ${f.id}: ${f.msg}`).join("\n") || "no findings"); out(c.ok ? "BRIEF OK" : "BRIEF BLOCKED"); return c.ok ? 0 : 1;
  }
  if (cmd === "draft") {
    const page = readJson(resolve(cwd, flag(rest, "--page") ?? ""), null); const brief = s.briefs[e.id];
    if (!page) { out("draft needs --page page.json"); return 1; }
    if (!brief) { out("add the research brief first (brief <id> --file ...)"); return 1; }
    const sibs = s.entries.filter((x) => x.id !== e.id && x.publicContent).map((x) => x.publicContent);
    const gate = checkPage({ ...page, path: e.path, type: "location" }, { others: sibs.map((p, i) => ({ ...p, path: "/other" + i })), verifiedPrices: flag(rest, "--prices")?.split(","), requiredCta: flag(rest, "--cta") ?? undefined, verifiedLocation: checkBrief(brief).ok, locationPages: sibs.map((p, i) => ({ ...p, path: "/other" + i })) });
    const next = stampPublicChange({ ...e, publicContent: { title: page.title, description: page.description, h1: page.h1, body: page.body, faq: page.faq ?? [], links: page.links ?? [] } }, today(now));
    const ready = cityReadiness(next, brief, s.entries.filter((x) => x.id !== e.id && x.publicContent));
    const ok = gate.ok && ready.ready;
    Object.assign(e, next, { status: ok ? "review-required" : "draft" }); save(cwd, s);
    out([...gate.findings.map((f) => `${f.level.toUpperCase()} ${f.id}: ${f.msg}`), ...ready.blockers.map((b) => `BLOCKER ${b}`)].join("\n") || "no findings");
    out(ok ? "READY FOR REVIEW" : "BLOCKED"); return ok ? 0 : 1;
  }
  if (cmd === "published") {
    const by = flag(rest, "--by");
    if (e.status !== "approved" || s.approval?.packageHash !== s.pendingPackage || !by?.trim()) { out("refused: needs an approved entry, an approval matching the latest package, and --by \"<name>\""); return 1; }
    e.status = "published"; e.publishedOn = today(now); e.publishedBy = by.trim(); save(cwd, s);
    out(`${e.id} recorded as published. This only records that you deployed it; run verify against the live site next.`); return 0;
  }
  out(`unknown command "${cmd}"`); return 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) main(process.argv.slice(2)).then((c) => process.exit(c));
