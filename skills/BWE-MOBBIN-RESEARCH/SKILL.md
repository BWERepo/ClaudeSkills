---
name: BWE-MOBBIN-RESEARCH
description: Design research and planning with Mobbin MCP for any website or web app project. Reads the project, searches Mobbin for real screens, flows and sections (including adjacent industries), scores candidates on a weighted rubric, narrows them to a ranked 5-8 reference shortlist, proposes three genuinely distinct design directions, STOPS for the user's approval, then writes a developer-ready docs/design/BWE-DESIGN-SPEC.md. Modes research (default), audit, refresh, compare, handoff. Never fabricates Mobbin results and never edits application code. Use when the user says "Mobbin research", "find design references", "research designs before we build", "design directions", "design spec", or invokes /BWE-MOBBIN-RESEARCH, in any project.
---

# BWE-MOBBIN-RESEARCH: decide what to build, before building it

Generic and portable: nothing here names a client, site, colour or business type. The project's own instructions (`CLAUDE.md`, `AGENTS.md`, `README`, design docs) win where they conflict with this file.

This skill **researches and plans**. It does not generate or modify website code. Building happens in a separate, approved request from the spec it writes; visual refinement after the build belongs to the Impeccable skills (`impeccable`, `BWE-IMPECCABLE`). Do not duplicate their work.

Reference files in this folder (read the ones a step names):

| File | Use |
|---|---|
| `reference/mobbin-mcp.md` | Find and test the Mobbin tools; search tactics; fallback when unavailable |
| `reference/research-methodology.md` | Stages A-D in detail, query planning, adjacent industries |
| `reference/evaluation-rubric.md` | Criteria, weights, scoring anchors, duplicate and diversity rules |
| `reference/design-directions.md` | How to make three directions genuinely different |
| `reference/design-handoff.md` | Spec contents, approval record, prototype brief, Impeccable/SEO hand-offs |
| `reference/website-workflow.md` | The full BWE website workflow this skill sits in, with a worked event-rental example |
| `reference/installation.md` | Mobbin subscription, connector setup (desktop, CLI, cloud), troubleshooting, updates |
| `reference/test-scenarios.md` | Validation procedures and the three example scenarios |
| `templates/*.md` | Brief, report, scorecard, spec, and a chat-research prompt for the fallback |
| `scripts/score.mjs` | Weighted scores, ranking, duplicates, shortlist diversity, spec check (Node 18+) |

`<S>` below means `node <this skill's folder>/scripts/score.mjs`.

## Invocation

`/bwe-skills:BWE-MOBBIN-RESEARCH [mode] [details]`. Claude Code passes everything after the name as free text, so read the arguments as natural language. `--flag value` forms are accepted but not required.

| Example | Meaning |
|---|---|
| `/BWE-MOBBIN-RESEARCH` | Research mode for the current project |
| `... --industry "event rentals"` / `... for an event rental company` | Research with that industry |
| `... --industry "dental practice" --style "modern premium"` | Industry plus a style hint (a hint, not a decision) |
| `... --mode audit` / `... audit the current site` | Audit mode |
| `... --mode refresh` | Refresh mode |
| `... --mode compare` | Compare mode |
| `... handoff` | Handoff mode |
| `... --weights visual=25,relevance=30,usability=20,mobile=15,distinct=10` | Override rubric weights for this project (must total 100) |

Unrecognized words are context for the brief. If two modes are named, ask which one.

| Mode | Does |
|---|---|
| **research** (default) | New design: discovery, scoring, shortlist, three directions, approval gate, spec |
| **audit** | Inspect the existing site (pages, screenshots if the user or tools can provide them), name its weakest patterns, research better ones, same gate |
| **refresh** | Re-run searches for the approved direction, replace expired or weaker references, re-score; the approved direction stays unless the user reopens it |
| **compare** | Score the user's prototypes, live pages or competing directions on the same rubric, side by side, with a recommendation; no new directions unless asked |
| **handoff** | From an existing approval, write or update `BWE-DESIGN-SPEC.md` (and optionally a three-concept prototype brief); refuses without a recorded approval |

## Rules that never bend

- **Never fabricate research.** No invented Mobbin results, app names, screenshots, URLs, image links, scores presented as measurements, or metadata. Every reference is either `mobbin` (retrieved by a Mobbin tool in this session), `mobbin-chat` (the user brought it from a Claude chat that had the connector), or `manual` (the user supplied the link, screenshot or description). Label every reference with its source.
- **Never claim Mobbin research ran** unless a Mobbin tool call in this session returned real results.
- **Never edit application code, configuration, SEO files or other skills.** This skill writes only under the project's `docs/design/` folder (or the project's existing design-docs folder), and only the files listed in Outputs.
- **Two approval gates:** the design direction (step 6) and, before writing the spec over an existing one, overwrite confirmation. Silence, a thumbs-up on research, or "looks good" about one section is not approval of a direction. Never auto-approve.
- **Inspiration, not copying.** Adapt patterns; never reproduce a whole site's design, copy, logos, illustrations or code. Do not commit Mobbin images into the repository; link them.
- **Project isolation.** Use only this project's files and this session's research. Never reuse another client's research, palette or decisions, even if found on disk.
- **Ask only what the project cannot answer.** Infer first; ask at most one short batch of essential questions.

## Approval and input blocks

When a decision blocks work, put the block at the top of the message and stop.

```
========================================
  USER APPROVAL REQUIRED — DESIGN DIRECTION
========================================
1. Approve the recommended direction (<name>)
2. Approve a different direction (<names>)
3. Combine: name the references or elements to merge
4. More research: say what is missing
5. Reject all three directions
6. Custom instructions
Recommendation: <choice and one-line reason>
Awaiting your response. No code or files will change until you answer.
```

Use AskUserQuestion where available (options 1, 2, 4 as buttons; 3, 5, 6 through "Other"), otherwise print the block and wait. For a missing fact use the same frame titled `USER INPUT NEEDED`.

## Workflow

### 0. Resume check
Look for `docs/design/mobbin-research/*/state.json` (newest first). If a run is `awaiting-approval`, re-show its gate and wait. If `approved`, offer handoff or refresh. Otherwise start a new run folder `docs/design/mobbin-research/<YYYY-MM-DD>-<mode>/` (`<R>`).

### 1. Project discovery
Read, never write: project instructions, `README`, package/framework files, existing pages and routes, CSS tokens / Tailwind config / theme files, fonts, logo and brand assets, any `docs/design/` content, SEO engine config if present (`seo/`, `bwe-seo*`), accessibility notes. Detect whether `impeccable`/`BWE-IMPECCABLE` and BWE-SEO are installed (skill list, `seo/` folder).

Fill `templates/project-brief.md` into `<R>/brief.md`: project name, project type (business site, e-commerce, SaaS, dashboard, consumer tool, nonprofit, other), audience, offerings, primary conversion actions, existing brand (colours, type, logo; mark "none found" honestly), pages, framework and UI library, accessibility target (default WCAG 2.1 AA), mobile priority, constraints. Then ask only for gaps that change the research, for example the industry or the main conversion action. State the brief back in five lines before searching.

### 2. Mobbin connection check (`reference/mobbin-mcp.md`)
Find tools whose names end in `search_screens`, `search_flows`, `search_sections` (and `list_collections`, `get_collection_contents`). If they are deferred, load them with ToolSearch (`search_screens`). Run one small real search related to the brief and confirm it returns results.

- **Works:** record the tool names and the test query in `<R>/state.json` and continue.
- **Missing or failing:** say so plainly, give the matching setup steps from `reference/installation.md` for this environment (desktop/CLI vs cloud session), and offer:
  1. Fix the connection and re-run,
  2. Research in a Claude chat that has the Mobbin connector using `templates/chat-research-prompt.md`, then paste or upload the result here (`mobbin-chat`),
  3. Manual references: the user supplies Mobbin URLs, screenshots or descriptions (`manual`).
  Never continue as if Mobbin were connected.

### 3. Stage A — industry analysis
Per `reference/research-methodology.md`: audience expectations, customer journeys, key conversion actions, visual positioning, functional needs, and 3-5 adjacent industries worth mining (with a one-line reason each). Write the query plan into `<R>/brief.md`: which tool (screens, flows, sections), which query, why.

### 4. Stage B — broad discovery
Run the query plan. Target 20-30 relevant candidates across sections, screens and flows, minimum 12 before presenting; if fewer than 12 relevant results exist, say so and show what exists. Prefer pattern diversity to volume; skip near-duplicates as you go. Record every kept candidate in `<R>/candidates.json` (shape in `templates/reference-scorecard.md`): id, name/app, source, tool, query, kind, category, pattern, Mobbin link if returned, `image_url` if returned, retrieved date, notes. Record only fields the tool actually returned.

### 5. Stage C/D — evaluate and shortlist
Score each candidate 1-10 on the rubric (`reference/evaluation-rubric.md`; project weights from arguments or `docs/design/rubric.json` if present). One short reason per score. Then:

```
<S> rank <R>/candidates.json --md      # weighted scores, ranking, duplicate warnings
<S> shortlist <R>/candidates.json --md # top 5-8, diversity rules, uncovered categories
```

Fix flagged duplicates and re-run. Scores are this reviewer's judgment for this brief, not performance data; say that in the report.

### 6. Report, directions, gate
Write `<R>/report.md` from `templates/research-report.md`: references grouped by website function (homepage, navigation, catalog/services, detail, forms/inquiry, journey, mobile, conversion), each with rank, name, source label, link, image (`![](image_url)` when returned; note that Mobbin image links expire after 30 days), kind, score, strengths, weaknesses, where to apply it, elements to adapt. Then three directions per `reference/design-directions.md`, each tied to specific shortlist references, and a recommendation with reasons.

In chat, show a compact visual summary: the shortlist table, the images (Mobbin results also render as a gallery in Claude Desktop/web), the three directions in a comparison table, the recommendation, and the report path. Set `state.json` to `awaiting-approval` and show the **USER APPROVAL REQUIRED — DESIGN DIRECTION** block. **Stop.**

### 7. Record the decision
On the answer: for 1-3 or 6, write the decision, chosen references, combinations and any custom instructions to `<R>/decision.md` and append a dated entry to `docs/design/design-decisions.md` (approval history). For 4, run the requested extra research and return to step 6. For 5, record the rejection and ask what was wrong before searching again. Set `state.json` to `approved` only after an explicit approval.

### 8. Design specification (handoff)
Per `reference/design-handoff.md` and `templates/design-specification.md`, write `docs/design/BWE-DESIGN-SPEC.md` (or the project's existing design-docs folder). If a spec already exists, show what would change and ask before replacing it. Mark every item **Approved** or **Recommendation (not approved)**. Run `<S> check-spec docs/design/BWE-DESIGN-SPEC.md` and fix what it reports.

If the user wants competing prototypes, also write `docs/design/prototype-brief.md`: three homepage concepts, same content, different approved treatments, desktop and mobile, built only after a separate go-ahead.

### 9. Close
Report: files written, the approved direction, open questions, and next steps:
1. Build from the spec (a separate request; three homepage concepts first if a prototype brief exists),
2. After the build, run Impeccable (`/bwe-skills:BWE-IMPECCABLE` or `/impeccable`) for refinement with before/after screenshots and approval,
3. Re-run this skill in `compare` mode to choose between prototypes, or `refresh` mode before image links expire.

Never commit, push or deploy. Say which files are new so the user can commit them.

## Outputs (all in the current project)

| Path | Content |
|---|---|
| `docs/design/mobbin-research/<run>/brief.md` | Project brief and query plan |
| `docs/design/mobbin-research/<run>/candidates.json` | Every candidate with scores and sources |
| `docs/design/mobbin-research/<run>/report.md` | Research report and three directions |
| `docs/design/mobbin-research/<run>/decision.md`, `state.json` | Approval record and run state |
| `docs/design/design-decisions.md` | Running approval history for this project |
| `docs/design/BWE-DESIGN-SPEC.md` | Developer-ready spec (after approval) |
| `docs/design/prototype-brief.md` | Optional three-concept prototype brief |

## With other BWE skills
- **Impeccable / BWE-IMPECCABLE:** refines what was built. This skill never runs them and never applies visual changes. Recommend them after implementation.
- **BWE-SEO:** if present, the spec must preserve metadata, canonical URLs, structured data, internal links, sitemap, heading hierarchy and accessible navigation. Never change SEO configuration or the SEO engine.
- **BWE-WOW:** page-level visual enhancement of existing pages; it can consume the spec as its direction.
