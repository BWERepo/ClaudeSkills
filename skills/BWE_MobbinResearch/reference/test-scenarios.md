# Validation and test scenarios

Automated: `node --test skills/BWE_MobbinResearch/scripts/score.test.mjs` from the catalog root (scoring, ranking, duplicates, shortlist diversity, spec check, skill structure). Everything else is a manual procedure: run it in a real session and record the result with the date. Never record a pass that was not observed.

## Procedures

| # | Area | Procedure | Pass when |
|---|---|---|---|
| 1 | Discovery and invocation | Install the plugin; type `/bwe-skills:BWE_MobbinResearch` | Skill loads and starts at step 0 |
| 2 | Arguments | Invoke with `--industry "dental practice" --style "modern premium"`, then `audit the current site`, then `handoff` | Mode and hints read correctly; two modes in one call trigger a question |
| 3 | Project discovery | Run in a project with a theme file and CLAUDE.md | Brief lists the real colours/fonts; no project file changed |
| 4 | Mobbin available | Run with the connector on | Tool names and a real test search recorded in `state.json` |
| 5 | Mobbin missing | Run with the connector off | Plain explanation, setup steps, three fallback options; no claim of research |
| 6 | Evaluation | Automated (`score.test.mjs`) | Weighted scores match hand calculation |
| 7 | Ranking | Automated | Order by weighted score, ties broken by relevance then usability |
| 8 | Duplicates | Automated | Same link, same image or same app+pattern flagged |
| 9 | Report | Inspect `report.md` | Grouped by function; every reference has a source label; images only where returned |
| 10 | Approval gate | Reply "nice research" | Skill keeps waiting; no spec written |
| 11 | Spec | Approve, then run handoff; `score.mjs check-spec` | All required sections; approved vs recommendation marked |
| 12 | Isolation | Run in project B after project A | No file, palette or reference from A appears in B |
| 13 | BWE integrations | Run in a project with BWESEO and Impeccable | Spec includes SEO preservation; next steps recommend Impeccable; neither is invoked |
| 14 | Cloud | Run in a Claude Code cloud session | Connector status reported truthfully; chat-research fallback works |

## Example scenarios

### 1. Premium event rental website
See the worked example in `website-workflow.md`. Expect adjacent-industry research (luxury home goods, wedding services, furniture, hospitality), a shortlist covering homepage, catalog, product detail, wishlist and inquiry, and three directions along the lines of Timeless Luxury / Modern Editorial / Romantic Boutique. The spec must keep inventory behind an adapter and describe the wishlist as an inquiry.

### 2. Local dental practice website
Brief: a two-dentist family and cosmetic practice. Conversions: book an appointment, call. Audience: local families, anxious patients, cosmetic-treatment shoppers. Adjacent: wellness brands, boutique fitness booking, hospitality. Expect coverage of homepage, services, team/trust, booking flow, insurance/pricing information, location, and mobile tap-to-call. Directions should differ (for example calm clinical, warm neighbourhood, premium cosmetic). Accessibility weighs heavily; consider raising `usability` weight.

### 3. Consumer calculator or utility website
Brief: a free tool site where each page is one calculator. Conversion: complete the calculation, then use a related tool. Adjacent: fintech, tax and budgeting apps, developer tools. Expect `search_screens` for input forms and results, `search_sections` for tool directories, no product-detail function (set `required` accordingly). Suggested weights: `usability` 30, `mobile` 20, `visual` 20, `relevance` 20, `distinct` 10.

Fixtures for these scenarios live in `scripts/fixtures/`. They are synthetic, labelled `fixture`, and are not Mobbin data.
