---
name: BWE-SEO
description: The SEO front door — the state-aware, environment-aware master controller of the BWE-SEO engine. Inspects the current website project's real SEO state (setup, business profile and open questions, audit, opportunities, roadmap, and every page's approval, build, SEO QA, staging deployment, staging review, the owner's staging approval, production deployment, post-publication check, Search Console, Google index monitoring (what Google has indexed, sitemap health, URLs needing attention) and 7/30/90-day monitoring status, plus site issues, with read-only live checks of production AND staging), shows a short status dashboard in plain language that always starts with the environment being evaluated (LOCAL / STAGING / PRODUCTION, production and staging domains, whether indexing actions are allowed) and recommends the ONE best next action and the specialized BWE-SEO skill that does it, then asks before proceeding. Never skips an approval gate, never recommends indexing for a staging URL; says "wait" when waiting is right. Recognizes projects with no SEO yet and offers setup. Use when the user says "SEO", "work on SEO", "what's next for SEO", "SEO status", "where are we with SEO", "run SEO", "SEO workflow", "what SEO should we do", or invokes /BWE-SEO, in any website project. "show details" / "full SEO status" gives the detailed view. "/BWE-SEO keyword <phrase>" analyzes one Google keyword from the site's own Search Console data (target page, indexing, impressions, clicks, CTR, average position, wrong-page and cannibalization checks, the next action) - it is not a Google search.
---

> `$BWESEO_ENGINE` = the BWE-SEO engine bundled in this plugin: `../../engines/seo`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first).
> Engine code lives in `$BWESEO_ENGINE/src`, methodology in `$BWESEO_ENGINE/docs/methodology`, schemas in `$BWESEO_ENGINE/schemas`, adapters in `$BWESEO_ENGINE/adapters`. No separate engine checkout is needed.

# BWE-SEO — the SEO front door

**If you don't know what to do next, run `/BWE-SEO`.** It inspects the project, says which
environment it's describing, and tells you the next step. The other BWE-SEO skills are specialized
tools; they still work directly, but nobody has to remember them.

```
SEO DEVELOPMENT WORKFLOW:  LOCAL → STAGING → HUMAN REVIEW → PRODUCTION → GOOGLE
LOCAL = build it · STAGING = test it · PRODUCTION = customers and search engines see it
GOOGLE = request discovery / indexing and monitor results
```

**STAGING MUST NEVER BE SUBMITTED TO SEARCH ENGINES FOR INDEXING** — no Request Indexing, sitemap
submission, IndexNow or Bing submission for a staging, preview, local or unknown URL. Rules:
`docs/methodology/environments.md`.

Engine: `$BWESEO_ENGINE/` — read `docs/ENGINE.md` (the rules) and
`docs/methodology/workflow-state.md` (how state is decided and recorded). Project data lives in
the current repo's `seo/` and `docs/seo/`. Nothing in this skill is specific to one business:
names, URLs, prices and places always come from the project's own files.

## Step 0 — Project guard (every BWE-SEO skill starts here)

1. Find the repo root (`git rev-parse --show-toplevel`). Read `seo/seo-config.json` there.
   Missing → this project isn't set up. First ask **is the engine installed?** (`seo/bweseo-install.json` exists):
   **no** → the next step is **`/BWE-SEO-ENGINE install`** ("BWE-SEO is not installed. Run /BWE-SEO-ENGINE install."); **yes** →
   the next step is **`/BWE-SEO-SETUP`** ("Engine installed. Project setup required.") — confirm the business
   and site with the user before creating anything.
2. Check `repo.gitRemote` is contained in `git remote get-url origin` (or `repo.rootFolderName`
   equals the repo folder name when there is no remote). Mismatch → STOP and tell the user; never
   read or write another project's `seo/` data.
3. Run `node seo/tools/validate-seo-data.mjs`. Fix data errors before analysis (ask the user when
   a fix needs a fact).
4. Read `seo/business-profile.json`, `seo/content-inventory.json`, and the adapter
   `adapters/<config.adapter>.md`.
5. Before finishing, record progress in the inventory/profile fields listed in
   `docs/methodology/workflow-state.md` → "Where state lives", so `/BWE-SEO` knows the new state
   next session.

`seo-state.mjs` performs 1–3 itself; `/BWE-SEO` runs it instead of repeating them by hand.

## Step 1 — Read the state (never from memory alone)

From the repo root (`git rev-parse --show-toplevel`):

1. **No `seo/seo-config.json`** → run the engine copy:
   `node $BWESEO_ENGINE/src/seo-state.mjs --project .`
   It reports either **"Install the BWE-SEO engine"** (nothing installed → `/BWE-SEO-ENGINE install`, start with
   `--dry-run`) or **"Engine installed — project setup is next"** (→ `/BWE-SEO-SETUP`). Go to Step 2 and offer
   to start that one step; never assume the business, domain, services or Search Console details.
2. **Engine upgrade / installation state** — the dashboard's `BWE-SEO Engine` line shows the installed version,
   schema and whether the installed files still match the receipt (`Installation verified ✓`), modified or
   missing (⚠), an update available, or "installed before install receipts existed" (a legacy install). Never
   re-copy engine files by hand: an update is `/BWE-SEO-ENGINE install --dry-run --update` then `/BWE-SEO-ENGINE install --update`
   (engine only — the customer's profile, inventory and state are never touched). A legacy or modified install is
   a small note, never a blocker.
3. Run `node seo/tools/seo-state.mjs`. It checks the project guard (wrong repo → it says STOP), runs
   the validator, reads every piece of evidence, and makes read-only GET requests to production
   (what's really live, and is production indexable?) and to staging when the project has one (is
   this version there, is staging hidden from search engines?). Use `--offline` only if the network
   is unavailable, and say so — the dashboard then says the environment comes from the records only.
4. **Google indexing (engine 1.9.0)** — when the project declares `analytics.searchConsole.indexMonitor`, the
   dashboard has a **Google indexing** block (Search Console · Sitemap · Indexing · Indexing rate · Last Google
   check) built from the snapshot `seo/data/google-index/snapshot.json`. That file is written by
   `/BWE-SEO-SEARCH-CONSOLE index pull` (read-only, the developer's own login); `/BWE-SEO` only reads it, never calls
   Google for this and holds no secret. Rules: this is SEO health, **independent of website health** — an indexing
   problem never changes the live-site check, never creates a conflict and never recommends a redeploy; an
   unavailable Google API is "temporarily unavailable", never "not indexed"; Google's Search Console report is the
   only evidence of "indexed" (sitemap, crawl, traffic and deployment never imply it; zero impressions never means
   not indexed); the rate is a plain ratio (`indexed / production URLs`), never a score; a stale snapshot (older than
   `staleAfterDays`) is refreshed before advice is given. No `indexMonitor` → the block is simply absent. A
   `WARNING: staging appears indexable` line is surfaced as a staging-protection problem.
   Method: `docs/methodology/google-index-monitoring.md`.
4b. **Keyword performance (engine 1.10.0)** — when the project declares `analytics.searchConsole.keywordPerformance`, the dashboard has a
   **Keyword performance** block (keywords registered · with impressions · to fix · high opportunity · Google shows another page · competing pages ·
   unconfirmed indexing · too new to judge · new Google queries) built from `seo/data/keyword-performance/summary.json`, written by
   `/BWE-SEO-SEARCH-CONSOLE keywords pull` (or `refresh`). `/BWE-SEO` only reads it. The registry is `pages[].keywords` in
   `seo/content-inventory.json`. Rules: this is SEO health, **independent of website health** (never a conflict, never a redeploy); a keyword's
   target page, indexing, sitemap, impressions and clicks are **separate facts** — never claim one because another is true; indexing is **confirmed**
   (URL Inspection), **inferred** (impressions only) or **unknown**, and an inferred state is never reported as confirmed; zero impressions on a new
   page or site is "insufficient data", not a failure; "average position" is Search Console's average, never a live ranking; **never** scrape or simulate Google;
   a discovered query never creates a page; a wrong-page or competing-pages finding changes no URL, canonical or page until the owner decides.
   The next action follows the evidence: not indexed → resolve indexing/discovery; indexed but no impressions → review keyword targeting; impressions
   but weak position → improve relevance/content/internal links; good position, weak CTR → improve search-result presentation; strong → protect it and
   look at related queries; all new → wait. No `keywordPerformance` → the block is absent. Method: `docs/methodology/keyword-performance.md`.
   **`/BWE-SEO keyword <phrase>`**: run `node seo/tools/seo-keywords.mjs analyze "<phrase>"` and show its KEYWORD ANALYSIS screen as written — state plainly
   that it analyzes the site's own Search Console data, not a Google search; if no data has been pulled, say so and offer `keywords pull`.
5. **LIFECYCLE STATE AND LIVE SITE HEALTH ARE INDEPENDENT. A failed availability check must never automatically reverse a completed SEO lifecycle milestone.** Read the dashboard's lifecycle and its `Live site
   health` line as two separate things (`state.liveHealth` vs the page rows). A failed live check is not a lifecycle change. If the dashboard shows `LIVE SITE CHECK: FAILED /
   UNAVAILABLE` (5xx, 522, timeout, network), say so as a health problem, show the recorded lifecycle as it
   is, and never suggest republishing, re-deploying or editing pages because of it — retry later or
   confirm from outside the checker (e.g. `curl` the URL). Only a 404/410 is a content conflict, and even
   then it's an investigation first.
6. **The card's live check never runs from the site's own host** (`environments.health.strategy`: `browser` /
   `server` / `off`). If health says "not checked — share a zone / another origin", that is a skipped check, not a
   failure: the CLI's own check (this run) is the authoritative one for production and staging.
7. **Sanity-check it against this conversation.** The tool only knows what's recorded. If the
   user has just told you something it can't see ("I requested indexing yesterday", "I deployed
   it", "go"), record it as `workflow-state.md` → "Where state lives" says — only what the user
   actually said, with `source: "owner:<date> chat"` — then run the tool again. If the evidence
   contradicts a status field, trust the evidence and report the conflict.

## Step 2 — Tell the user where things stand (concise by default)

Show, in this order:

1. The **status dashboard** exactly as the tool printed it — it starts with the environment block
   (Environment · Production domain · Staging domain · Indexing actions); never make the user guess
   which environment is being inspected. Then project stages, **the pipeline lines** for the current
   page — done steps on one line (green), on-hold steps on the second (yellow), the rest (▸ next,
   ✗ blocked, … waiting) on a third. In chat, where colour can't render, prefix them 🟢 / 🟡 / ⚪,
   e.g. `🟢 Created ✓ → QA ✓ → Staging ✓`, `🟡 Production ⏸` — always show them, the current page's steps (including
   staging deployment, staging review, your staging approval, production deployment and Google
   indexing), other pages one line each, site issues. When present, show the **Google indexing** block verbatim
   too — and in plain words ("12 of 14 pages are in Google"), never as a score.
2. **NEXT RECOMMENDED STEP** — one action: the headline, the recommended skill, and who does it:
   **CLAUDE CAN DO THIS**, **USER MUST DO THIS** (manual action) or **YOUR DECISION** (approval).
3. **WHAT WE ARE DOING / WHY IT MATTERS / WHAT HAPPENS NEXT**, in plain language — no SEO jargon.
4. A manual action: the numbered steps and the exact URL, then "tell me when it's done". Blocked:
   only the question(s) that block it. WAIT: say no change is needed and give the next review
   date — don't invent work.
5. One question: **"Would you like me to go ahead?"** (or "Which one should we do?" for a page
   choice). Mention "ALSO WAITING ON YOU" items in one line each, if any.

Don't list every skill. Don't dump the full report unless asked.

**Detailed mode** — "show details", "full SEO status", "everything" or similar: run
`node seo/tools/seo-state.mjs --details` and summarize it (every page with its history, issues,
blockers, the full ordered action list, and for Google indexing every URL Google flagged with Google's own wording,
its last crawl and last check). For a performance / monthly report, route to
`/BWE-SEO-REPORT`.

**Page-specific mode** — `/BWE-SEO <page>`, where `<page>` is an inventory id, a site path (`/service-page`) or a
full URL on this project's own hosts (`/BWE-SEO https://example.com/service-page`): run
`node seo/tools/seo-state.mjs --page <page>` and show its **PAGE ASSESSMENT** as printed — the page's identity and
environment, its lifecycle (recorded history), its live health (a separate, current observation), the Google stages
(readiness, sitemap membership, discovered, crawled, indexed — each its own fact) and the next step for that page.
Query strings, fragments and trailing slashes are ignored. A URL on any other domain is refused ("nothing is
assessed for other sites") — never assess it; a page that is not in this project's SEO inventory is reported as not
found, never guessed. A staging URL resolves to the same page, and indexing actions stay disabled. If the page's next
step differs from the project-wide one, say both. Then ask the same single question as Step 2.

## Step 3 — On "yes": route to the specialized skill

Invoke the recommended skill with the Skill tool (skill name + the page id as args) and follow it.
The tool names the skill; this table is the reference:

| State | Skill |
|---|---|
| No SEO setup / setup incomplete / facts need re-checking | `/BWE-SEO-SETUP` (update mode never overwrites) |
| No baseline audit, or it's over 180 days old | `/BWE-SEO-AUDIT` |
| Audit done, no opportunities | `/BWE-SEO-OPPORTUNITIES` (optionally `/BWE-SEO-COMPETITORS`) |
| Opportunities, no roadmap | `/BWE-SEO-CONTENT-PLAN` |
| Roadmap, nothing approved | Present the top options; **the user picks ONE**; record it (`status: approved`, `approvedOn`, `approvedBy: "user"` on every entry of that roadmap item) |
| Approved / draft page | `/BWE-SEO-CREATE-PAGE <id>` |
| Created, no QA / QA failed / QA stale | `/BWE-SEO-QA <id>` |
| QA passed, not on staging | **Deploy to staging** through the project's staging workflow (`workflows.deployStaging`), following the project's standing rule for staging deploys (ask when there isn't one) |
| On staging, not reviewed (or changed since) | `/BWE-SEO-QA <id> staging` — the staging review |
| Staging review failed | Fix, redeploy to staging, review again |
| Staging review passed | **STAGING REVIEW PASSED** — the owner reviews the page on staging (desktop + mobile); record `staging.approval` only from their words. **PRODUCTION DEPLOYMENT REQUIRES YOUR APPROVAL** |
| Approved on staging (or QA passed and the project has no staging), not on production | **Production deploy approval** → the project's own deploy workflow (`seo-config.json` → `workflows`), only on the user's explicit go |
| On production, not verified | `/BWE-SEO-PUBLISH <id>` (production verification from scratch — staging checks don't count) |
| Production not indexable / staging not hidden | `/BWE-SEO-TECHNICAL` (a CRITICAL SEO ERROR for production) |
| Production ✓ recorded, but the live-site health check failed | **Re-check / investigate production availability** (read-only) — never deploy, QA, stage, re-approve, redo Search Console or request indexing again |
| Verified rollback / removal (`production.reversal`) | Report the verified change; the owner decides whether to redeploy; history kept |
| Production ✓, no Google readiness record | Run the Google readiness check (`/BWE-SEO-PUBLISH <id>`) — records `postPublication.google.readiness` (technically ready ≠ indexed) |
| Readiness failed / page not in the sitemap | Fix (site changes still need approval), then re-run readiness |
| Sitemap not registered (site-level), API usable | Register it once through the official API (`/BWE-SEO-SEARCH-CONSOLE sitemap`, dry run first) |
| Sitemap not registered, no API | Manual: confirm it in Search Console → Sitemaps, once for the whole site |
| Sitemap already registered | Nothing — never ask for it again |
| Indexed unverified, API usable, check due | Check Google's discovery / crawl / index status (`/BWE-SEO-SEARCH-CONSOLE <id>`, read-only) |
| Manual Request Indexing / Live URL test | **Optional accelerators** — never required, never repeated once recorded |
| Live, Search Console not set up (site) | Manual action: set up Search Console (owner's own Google account) — once per site |
| Live URL Test not done / failed | Manual action: URL Inspection → Test Live URL; a failure is fixed and retested |
| Live URL Test passed, indexing not requested | Manual action: Request Indexing (retry if it failed) |
| Requested, sitemap not verified (site) | Manual action: Search Console → Sitemaps |
| All Google steps done, indexing not verified | **Wait** — "Waiting for Google — not yet verified as indexed"; at the review date, ask the owner to check URL Inspection once |
| Verified indexed | Move to monitoring (`/BWE-SEO-SEARCH-CONSOLE` reviews) |
| Review due (7/30/90 days) | `/BWE-SEO-SEARCH-CONSOLE` (after the user's export, if one is needed) |
| Refresh evidence recorded | `/BWE-SEO-REFRESH <id>` |
| Google index monitoring: no snapshot / stale | `/BWE-SEO-SEARCH-CONSOLE index pull` (read-only; developer's own wrangler login) |
| Search Console not connected (monitor) | **Manual:** the site's `docs/google-search-console-setup.md` — never guess indexing without it |
| Sitemap not registered / pages missing from the sitemap (monitor) | Submit it from the site's admin once · `/BWE-SEO-TECHNICAL` repairs generation (needs approval) |
| Crawled / discovered but not indexed, blocked, canonical conflict (monitor) | `/BWE-SEO-SEARCH-CONSOLE index investigate` — Google's own evidence, diagnostic checks only |
| Indexed, no impressions (monitor) | `/BWE-SEO-SEARCH-CONSOLE index impressions` — query targeting, not an indexing problem |
| Keywords not registered / no keyword data / stale | `/BWE-SEO-SEARCH-CONSOLE keywords add` · `keywords pull` (read-only) |
| Target page not indexable, blocked, or not indexed (keywords) | `/BWE-SEO-SEARCH-CONSOLE keywords investigate` — resolve indexing/discovery first |
| Google shows a different page, or several pages, for a keyword | `/BWE-SEO-SEARCH-CONSOLE keywords analyze "<keyword>"` — review intent, titles, overlap, canonicals, links; nothing changes automatically |
| Good position, weak CTR / near page one / weak position (keywords) | `/BWE-SEO-SEARCH-CONSOLE keywords analyze "<keyword>"` — presentation, relevance and internal links, with the reasons |
| New Google queries nobody registered | `/BWE-SEO-SEARCH-CONSOLE keywords discovered` — ignore · monitor · add as keyword · investigate (never auto-creates a page) |
| Technical / structured-data / local / internal-link issue | `/BWE-SEO-TECHNICAL` · `/BWE-SEO-SCHEMA` · `/BWE-SEO-LOCAL` · `/BWE-SEO-INTERNAL-LINKS` |
| Content or legal issue | The project's normal change process, after approval |
| Overall summary | `/BWE-SEO-REPORT` |

When the specialized skill finishes, run `node seo/tools/seo-state.mjs` again and show the new next
step — **don't start it without asking.** One gate per yes.

## Approval gates — state awareness never removes them

Stop and wait for the user's explicit yes before: creating a new public SEO page · deploying ·
committing or pushing · major navigation changes · substantial changes to an existing page ·
adding any paid service · changing a verified business fact · changing pricing · publishing any
claim without a verified fact behind it. A page on hold stays paused until the user says go; then
remove the hold. An approval covers one action and never carries over to the next.

## Recording what the user tells you

- "It was rolled back / taken down / reverted" (a deliberate, verified event — never a failed request) →
  `production.reversal: { kind: "rollback" | "removed" | "reverted", date, source: "owner:<date> chat",
  evidence }` on the page. The milestone's history stays. A 522/timeout is never recorded this way.
- "I requested indexing" → `postPublication.searchConsole.indexingRequest: "REQUESTED"`,
  `requestedOn`, `requestSource: "owner:<date> chat"`. "I'd rather not" → keep `NOT REQUESTED`
  and put that decision in `requestSource`, so it stops coming up.
- "The sitemap shows Success" → config `analytics.searchConsole.sitemap { url, submitted: "yes", status,
  verifiedOn, lastRead, discoveredPages }` (and the legacy `sitemapSubmission: "verified"`). Site-level: once.
- "Search Console is set up / verified" → config `analytics.searchConsole.configured: "yes"`,
  `propertyType`, `verifiedProperty`, `verificationMethod`, `verifiedOn`. **Never record the verification
  token or any secret.**
- "The live test passed / failed" → `postPublication.searchConsole.liveUrlTest { result, testedOn,
  availableToGoogle, canBeIndexed, source }` — record exactly what Google reported.
- "The request failed" → `indexingRequest: "REQUEST FAILED"`.
- "URL Inspection says it's on Google" → `indexed { status: "INDEXED", verifiedOn, evidence, source }`.
  "It's not indexed yet" → `indexed { status: "NOT VERIFIED", lastCheckedOn, note }` (so the same review
  isn't asked again). **Never mark INDEXED from a request, a passed Live URL Test, a sitemap Success or a
  deployment.**
- "Pause this page" → `hold: { since, scope: "deploy" | "all", reason, source }` (`deploy` holds the
  production deploy only; staging work continues); "go" → remove it.
- "Looks good on staging" / "approved on staging" → `staging.approval: { approvedOn, source:
  "owner:<date> chat", sourceHash }` (hash from `node seo/tools/seo-state.mjs --hash <id>`). This is
  NOT permission to deploy to production — ask for that separately.
- A staging deploy the live check can't see (e.g. staging needs a sign-in) → `staging.deployedOn`.
- An answer to a blocking question → update the profile fact (verified, with its source), set the
  question's `answeredOn` (or remove it), and clear that id from any `blockedBy`.
- "Don't fix that" (a site issue) → `status: "deferred"` or `"wont-fix"`, with a note.

Then run `node seo/tools/validate-seo-data.mjs` and the state tool again.

## Never

Create more than one page per approval, mass-publish, deploy/push/commit without being asked, buy
or connect paid tools, handle credentials, fabricate facts, proof or history, promise rankings,
request indexing or change Search Console for the owner, rewrite a page just to create activity,
call a page indexable or "ready for Google" before `/BWE-SEO-PUBLISH` has verified it live on
production, let staging status stand in for production status, or recommend any search-engine
indexing action for a staging, preview or local URL. Never read or write another project's `seo/`
data.
