#!/usr/bin/env node
// BWESEO Local SEO / Google Business Profile — developer CLI (Node 18+). Manual mode: needs no Google access and makes no network call.
//
//   node seo/tools/seo-local-gbp.mjs status                          where this business stands and the one next action
//   node seo/tools/seo-local-gbp.mjs questions                       the eligibility questions to ask the administrator
//   node seo/tools/seo-local-gbp.mjs eligibility --answers a.json --by "<name>"
//   node seo/tools/seo-local-gbp.mjs discover --method "<where you looked>" --by "<name>" [--candidates c.json]
//   node seo/tools/seo-local-gbp.mjs discover --resolve <key> --resolution connect-existing|claim|different-business|ignore-possible --reason "<why>" --by "<name>"
//   node seo/tools/seo-local-gbp.mjs draft [--init]                  build/refresh the profile draft from seo/business-profile.json
//   node seo/tools/seo-local-gbp.mjs check                           validate the draft, readiness preview and completeness
//   node seo/tools/seo-local-gbp.mjs schema                          LocalBusiness JSON-LD for the website (verified facts only)
//   node seo/tools/seo-local-gbp.mjs audit --html page.html [--html other.html]   profile/website consistency
//   node seo/tools/seo-local-gbp.mjs approve --by "<name>"           approve the exact draft (any later edit voids it)
//   node seo/tools/seo-local-gbp.mjs created --by "<name>" [--url <profile url>]  you created the profile in Google's interface
//   node seo/tools/seo-local-gbp.mjs verification --status <state> --by "<name>" [--method <m>] [--note "<text>"]
//
//   node seo/tools/seo-local-gbp.mjs recommend [--html page.html]    queue prioritised recommendations (no duplicates; rejected ones are not re-queued)
//   node seo/tools/seo-local-gbp.mjs queue [--move <id> --to <state> --by "<name>" --note "<why>" --evidence "<what you saw>"] [--sync]
//        --sync adds/updates "gbp-…" entries (area local) in seo/content-inventory.json, the shared improvement queue
//   node seo/tools/seo-local-gbp.mjs reviews [--import reviews.json --by "<name>"] [--unanswered] [--draft <id>] [--approve <id> --by "<name>"] [--posted <id> --by "<name>"]
//   node seo/tools/seo-local-gbp.mjs review-request [--channel email|text|website] [--link <your Google review link>]
//   node seo/tools/seo-local-gbp.mjs posts [--suggest] [--add post.json --by "<name>"] [--approve <id> --by "<name>"] [--schedule <id> --when YYYY-MM-DD] [--posted <id> --by "<name>"]
//   node seo/tools/seo-local-gbp.mjs performance [--import figures.csv|json --by "<name>"]   manual import; never estimated, never mixed with Search Console
//
// Data: reads seo/business-profile.json; writes only seo/data/local-gbp/ (private, git-ignored). It never changes the website and
// never submits anything to Google. Creating and verifying a profile in manual mode is the owner's action in Google's own interface.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeJsonAtomic } from "./safe-write.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eligibilityQuestions } from "./gbp-eligibility.mjs";
import { candidateKey, claimGuidance } from "./gbp-discovery.mjs";
import { generateDescription, profileFromBusinessProfile, validateProfile, completeness, preview, suggestCategories, recommendImages } from "./gbp-profile.mjs";
import { buildLocalBusinessSchema, auditConsistency, extractSiteFacts } from "./gbp-schema.mjs";
import * as Q from "./gbp-queue.mjs";
import * as R from "./gbp-reviews.mjs";
import * as P from "./gbp-posts.mjs";
import * as F from "./gbp-performance.mjs";
import { loadState, setEligibility, recordSearch, resolveCandidate, creationGate, approve, reportCreation, setVerification, verificationGuidance, summarize, VERIFICATION_STATES } from "./gbp-state.mjs";

const dirOf = (project) => join(project, "seo", "data", "local-gbp");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const readIf = (p) => (existsSync(p) ? readJson(p) : null);
const writeJson = (p, v) => writeJsonAtomic(p, v);

export function parseArgs(argv) {
  const out = { _: [], html: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (["init", "sync", "unanswered", "suggest"].includes(k)) out[k] = true;
      else if (k === "html") out.html.push(argv[++i]);
      else out[k] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

export function context(project) {
  const d = dirOf(project);
  const bp = readIf(join(project, "seo", "business-profile.json"));
  const state = loadState(readIf(join(d, "state.json")));
  const draftSaved = readIf(join(d, "draft.json"));
  const base = profileFromBusinessProfile(bp, state.eligibility?.result);
  // the saved draft holds the administrator's edits (description, categories, hours, address, images…) and wins over the profile
  const values = { ...base.values, ...(draftSaved ?? {}), classification: state.eligibility?.result?.classification ?? base.values.classification, hideAddress: state.eligibility?.result?.hideAddress ?? base.values.hideAddress };
  const validation = validateProfile(values, { officialName: base.values.name });
  return { d, bp, state, values, base, validation, saveState: () => writeJson(join(d, "state.json"), state) };
}

const need = (label, items) => { if (items.length) { console.log(`\nUSER INPUT NEEDED — ${label}`); for (const i of items) console.log(`  • ${i}`); } };
const by = (a) => { if (!a.by) { console.error('Pass --by "<your name>" so the action is recorded.'); process.exit(3); } return a.by; };

const COMMANDS = {
  "recommend"(a, project) {
    const c = context(project);
    const comp = completeness(c.values);
    const pages = (a.html ?? []).map((f) => extractSiteFacts(readFileSync(resolve(f), "utf8"), f));
    const findings = pages.length ? auditConsistency(c.values, pages).findings : [];
    const reviews = readIf(join(c.d, "reviews.json")) ?? [];
    const queue = readIf(join(c.d, "recommendations.json")) ?? [];
    const m = Q.mergeRecs(queue, Q.recommend({ values: c.values, completeness: comp, auditFindings: findings, reviews }));
    writeJson(join(c.d, "recommendations.json"), m.queue);
    console.log(`Queued ${m.added.length} new recommendation(s); skipped ${m.skipped.length} (already queued, rejected or deferred).`);
    for (const r of m.queue.filter((x) => m.added.includes(x.id))) console.log(`  [${r.priority}] ${r.type}: ${r.reason}`);
    need("to act on the queue", [...new Set(m.queue.filter((r) => ["new", "review"].includes(r.state) && r.userInputNeeded).map((r) => r.userInputNeeded))]);
  },

  "queue"(a, project) {
    const c = context(project);
    const file = join(c.d, "recommendations.json");
    const queue = readIf(file) ?? [];
    if (a.move) {
      const rec = queue.find((r) => r.id === a.move);
      if (!rec) throw new Error(`No recommendation ${a.move}.`);
      Q.transition(rec, a.to, { by: a.by ?? null, note: a.note ?? "", evidence: a.evidence ?? null });
      writeJson(file, queue);
    }
    if (a.sync) {
      const invPath = join(project, "seo", "content-inventory.json");
      const inv = readIf(invPath);
      if (!inv) throw new Error("seo/content-inventory.json not found; nothing to sync into.");
      const r = Q.syncToInventory(inv, queue);
      writeJson(invPath, r.inventory);
      console.log(`Improvement queue: ${r.added} added, ${r.updated} updated in seo/content-inventory.json (issues[], area local).`);
    }
    for (const r of queue) console.log(`${r.id}  ${r.state.padEnd(12)} [${r.priority}] ${r.type}: ${r.reason}`);
    if (!queue.length) console.log("Queue is empty. Run 'recommend'.");
  },

  "reviews"(a, project) {
    const c = context(project);
    const file = join(c.d, "reviews.json");
    let reviews = readIf(file) ?? [];
    if (a.import) {
      const r = R.importReviews(readJson(resolve(a.import)), reviews, { by: by(a) });
      reviews = r.reviews; writeJson(file, reviews);
      console.log(`Imported ${r.added} review(s) (manual import, not live-synced).`);
      for (const e of r.errors) console.log(`  ✗ ${e}`);
    }
    const find = (id) => reviews.find((x) => x.id === id) ?? (() => { throw new Error(`No review ${id}.`); })();
    if (a.draft) {
      const rv = find(a.draft);
      const used = reviews.filter((x) => x.draft).map((x) => x.draft.opener);
      rv.draft = R.draftReply(rv, { businessName: c.values.name ?? "our team", usedOpeners: used });
      writeJson(file, reviews); console.log(`Draft for ${rv.id}:\n${rv.draft.text}`);
      for (const k of rv.draft.checks) console.log(`  ! ${k}`);
      need("review", ["Edit if needed, then approve the reply; it is not published by BWESEO."]);
    }
    if (a.approve) { R.approveReply(find(a.approve), { by: by(a) }); writeJson(file, reviews); console.log("Reply approved. Post it in Google's interface, then run --posted."); }
    if (a.posted) { R.markReplyPosted(find(a.posted), { by: by(a) }); writeJson(file, reviews); console.log("Recorded as posted by the owner (owner-reported)."); }
    const s = R.summary(reviews);
    console.log(`Reviews: ${s.total} · average ${s.average ?? "n/a"} · unanswered ${s.unanswered} (${s.source})`);
    for (const p of R.prioritize(a.unanswered ? R.filterReviews(reviews, { unanswered: true }) : reviews)) console.log(`  [${p.priority}] ${p.review.id} ${p.review.rating}★ ${p.review.date} (${p.ageDays}d)`);
  },

  "review-request"(a, project) {
    const c = context(project);
    const t = R.reviewRequestTemplate({ businessName: c.values.name ?? "our business", channel: a.channel ?? "email", reviewLink: a.link ?? null });
    console.log(t.text); for (const k of t.checks) console.log(`  ! ${k}`);
    console.log("\nRules:"); for (const r of t.rules) console.log(`  – ${r}`);
  },

  "posts"(a, project) {
    const c = context(project);
    const file = join(c.d, "posts.json");
    const posts = readIf(file) ?? [];
    const find = (id) => posts.find((x) => x.id === id) ?? (() => { throw new Error(`No post ${id}.`); })();
    if (a.suggest) {
      const inv = readIf(join(project, "seo", "content-inventory.json"));
      const pages = (inv?.pages ?? []).filter((p) => /^(published|live)/i.test(p.status ?? "")).map((p) => ({ path: p.url, title: p.title ?? p.name, publishedAt: p.addedOn }));
      const sug = P.suggestPosts(pages, posts);
      if (!sug.length) console.log("No recent pages to post about. Do not post just to look active.");
      for (const x of sug) console.log(`  ${x.sourcePath}: ${x.text}  (${x.evidence})`);
    }
    if (a.add) { const p = P.addDraft(posts, readJson(resolve(a.add)), { by: by(a) }); writeJson(file, posts); console.log(`Draft ${p.id} saved.`); for (const i of p.checks) console.log(`  ${i.level === "error" ? "✗" : "!"} ${i.message}`); }
    if (a.approve) { P.approvePost(find(a.approve), { by: by(a) }, posts); writeJson(file, posts); console.log("Approved. Nothing was published."); }
    if (a.schedule) { P.schedulePost(find(a.schedule), a.when); writeJson(file, posts); console.log("Intended date recorded. BWESEO does not publish; the owner posts it."); }
    if (a.posted) { P.markPosted(find(a.posted), { by: by(a) }); writeJson(file, posts); console.log("Recorded as posted by the owner (owner-reported)."); }
    for (const p of posts) console.log(`${p.id}  ${p.state.padEnd(15)} ${p.type}${p.scheduledFor ? ` · intended ${p.scheduledFor}` : ""}`);
  },

  "performance"(a, project) {
    const c = context(project);
    const file = join(c.d, "performance.json");
    let rows = readIf(file) ?? [];
    if (a.import) {
      const raw = readFileSync(resolve(a.import), "utf8");
      const r = F.importPerformance(/\.json$/i.test(a.import) ? JSON.parse(raw) : raw, rows, { by: by(a) });
      rows = r.rows; writeJson(file, rows);
      console.log(`Imported: ${r.added} new, ${r.replaced} replaced.`); for (const e of r.errors) console.log(`  ✗ ${e}`);
    }
    const s = F.summarize(rows);
    console.log(s.source);
    for (const [m, v] of Object.entries(s.metrics)) {
      if (!v.available) { console.log(`  ${m}: unavailable — ${v.note}`); continue; }
      console.log(`  ${m}: ${Object.entries(v.windows).map(([w, x]) => `${w}d ${x.available ? `${x.total}${x.changePct != null ? ` (${x.changePct >= 0 ? "+" : ""}${x.changePct}%)` : ""}${x.partial ? " partial" : ""}` : "n/a"}`).join(" · ")}`);
    }
  },

  "questions"() { for (const q of eligibilityQuestions()) console.log(`${q.key}: ${q.text}`); },

  "status"(a, project) {
    const c = context(project);
    const s = summarize(c.state, { values: c.values, validation: c.validation });
    console.log(`Mode: ${s.mode.toUpperCase()}${s.mode === "manual" ? " (no Google Business Profile API access confirmed; nothing here is live-synced)" : ""}`);
    console.log(`Eligibility: ${s.eligibility ? `${s.eligibility.eligible} (${s.eligibility.classification})` : "not assessed"}`);
    console.log(`Profile creation: ${s.creation} · Verification: ${s.verification.status} (${s.verification.source})`);
    if (s.completeness) console.log(`Completeness: ${s.completeness.score}% of the items we can check (${s.completeness.coverage}% of the checklist is visible without Google access)`);
    console.log(`\nNext action: ${s.primaryAction.label}`);
    need("complete before creating the profile", s.gate.userInputNeeded);
    console.log("\nNot available in manual mode:"); for (const u of s.unavailable) console.log(`  – ${u}`);
  },

  "eligibility"(a, project) {
    const c = context(project);
    if (!a.answers) { console.error("Pass --answers <file.json>. Run 'questions' for the keys."); process.exit(3); }
    setEligibility(c.state, readJson(resolve(a.answers)), by(a));
    c.saveState();
    const r = c.state.eligibility.result;
    console.log(`Eligible: ${r.eligible.toUpperCase()} · Classification: ${r.classification} · Next: ${r.nextAction}`);
    for (const b of r.blockers) console.log(`  ✗ ${b}`);
    for (const w of r.warnings) console.log(`  ! ${w}`);
    need("answer to continue", r.userInputNeeded.map((q) => q.question));
    if (r.alternatives.length) { console.log("\nWebsite SEO alternatives (no profile will be created):"); for (const x of r.alternatives) console.log(`  – ${x}`); }
  },

  "discover"(a, project) {
    const c = context(project);
    if (a.resolve) {
      resolveCandidate(c.state, a.resolve, { resolution: a.resolution, reason: a.reason, by: by(a) });
      c.saveState(); console.log(`Recorded: ${a.resolve} → ${a.resolution}`); return;
    }
    if (!a.method) { console.error('Pass --method "<where you searched>" --by "<name>" [--candidates file.json], or --resolve <key>.'); process.exit(3); }
    const cands = a.candidates ? readJson(resolve(a.candidates)) : [];
    recordSearch(c.state, { method: a.method, by: by(a), candidates: cands });
    c.saveState();
    const gate = creationGate(c.state, { values: c.values, validation: c.validation });
    console.log(`Search recorded (${cands.length} candidate listing(s)).`);
    c.state.discovery.candidates.forEach((cd, i) => console.log(`  ${candidateKey(cd, i)}: ${cd.name} — ${claimGuidance({ candidate: cd }).action}`));
    for (const b of gate.blockers.filter((x) => /existing/i.test(x))) console.log(`  ✗ ${b}`);
  },

  "draft"(a, project) {
    const c = context(project);
    const draftPath = join(c.d, "draft.json");
    const saved = readIf(draftPath) ?? {};
    const v = { ...c.base.values, ...saved };
    if (!v.description) v.description = generateDescription(v).text;
    if (!saved.categories) v.categories = { primary: null, secondary: [] };
    if (a.init || !existsSync(draftPath)) writeJson(draftPath, { description: v.description, categories: v.categories, hours: saved.hours ?? null, specialHours: saved.specialHours ?? [], address: saved.address ?? c.base.values.address ?? null, images: saved.images ?? {} });
    console.log(`Draft written to seo/data/local-gbp/draft.json. Edit it (description, categories, hours, address, images), then run 'check'.`);
    need("fill in", [...c.base.missing, ...(v.categories?.primary ? [] : [suggestCategories(v, null).needsInput])]);
  },

  "check"(a, project) {
    const c = context(project);
    const gate = creationGate(c.state, { values: c.values, validation: c.validation });
    const comp = completeness(c.values);
    const pv = preview(c.values, c.validation, !gate.blockers.some((b) => /existing|search/i.test(b)));
    console.log(`Readiness: ${pv.status.toUpperCase()} · Completeness ${comp.score}% (checklist coverage ${comp.coverage}%)`);
    for (const e of c.validation.errors) console.log(`  ✗ ${e.field}: ${e.message}`);
    for (const w of c.validation.warnings) console.log(`  ! ${w.field}: ${w.message}`);
    for (const i of comp.items) console.log(`  ${i.status === "pass" ? "✓" : i.status === "fail" ? "✗" : "?"} ${i.label}${i.status === "unknown" ? " — owner must check in Google's interface" : ""}`);
    need("before this profile can be created", gate.userInputNeeded);
    const images = c.values.images?.candidates ? recommendImages(c.values.images.candidates) : null;
    if (images?.problems?.length) console.log(`\nImage problems: ${images.problems.length}`);
  },

  "schema"(a, project) {
    const c = context(project);
    const s = buildLocalBusinessSchema(c.values);
    console.log(s.json);
    for (const w of s.warnings) console.error(`! ${w}`);
  },

  "audit"(a, project) {
    const c = context(project);
    if (!a.html.length) { console.error("Pass --html <saved page.html> (repeatable)."); process.exit(3); }
    const pages = a.html.map((f) => extractSiteFacts(readFileSync(resolve(f), "utf8"), f));
    const r = auditConsistency(c.values, pages);
    for (const f of r.findings) console.log(`[${f.severity}] ${f.id}: ${f.message}`);
    if (!r.findings.length) console.log("No inconsistencies found on the supplied pages.");
  },

  "approve"(a, project) {
    const c = context(project);
    const gate = creationGate(c.state, { values: c.values, validation: c.validation });
    if (!c.validation.valid) { console.error("Refusing to approve a profile with validation errors:"); for (const e of c.validation.errors) console.error(`  ✗ ${e.message}`); process.exit(1); }
    const ap = approve(c.state, { kind: "create-profile", values: c.values, by: by(a) });
    c.saveState();
    console.log(`Approved by ${ap.by} at ${ap.at}. This approval covers exactly the current draft (${ap.fingerprint}); editing it voids the approval.`);
    void gate;
  },

  "created"(a, project) {
    const c = context(project);
    const gate = creationGate(c.state, { values: c.values, validation: c.validation });
    if (!gate.canCreate) { console.error("The creation gate is not open:"); for (const b of gate.blockers) console.error(`  ✗ ${b}`); process.exit(1); }
    reportCreation(c.state, { by: by(a), profileUrl: a.url ?? null });
    c.saveState();
    console.log("Recorded as reported by the administrator. Google has not confirmed anything yet; verification is the next step.");
  },

  "verification"(a, project) {
    const c = context(project);
    if (a.status) { setVerification(c.state, { status: a.status, method: a.method ?? null, by: by(a), note: a.note ?? "" }); c.saveState(); }
    const g = verificationGuidance(c.state);
    console.log(`Verification: ${g.status} (${g.source === "manual" ? "owner-reported, not confirmed by Google" : g.source})`);
    for (const s of g.steps) console.log(`  – ${s}`);
    if (g.userInputNeeded) need("owner action", [g.userInputNeeded]);
    console.log(`\n${g.disclaimer}`);
    if (!a.status) console.log(`States: ${VERIFICATION_STATES.join(", ")}`);
  },
};

export function main(argv, project = process.cwd()) {
  const a = parseArgs(argv);
  const cmd = a._[0];
  const fn = cmd && Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : null;
  if (!fn) { console.error(`Usage: seo-local-gbp.mjs <${Object.keys(COMMANDS).join("|")}>  (see the header of this file)`); return 3; }
  try { fn(a, project); return 0; } catch (e) { console.error(`✗ ${e.message}`); return 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
