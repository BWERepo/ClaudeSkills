# Google Business Profile module — implementation inventory

Written at the start of the Local SEO / Google Business Profile work (engine 1.10.0). Customer-neutral.

## Architecture facts that shape the design
- The engine is a **library plus per-site data**: zero-dependency pure modules in `src/` (installed into a site's `seo/tools/`), CLIs, schemas, skills.
  There is no server, database, dashboard or authentication in this repository. Those belong to each customer site (the 1.9/1.10 monitors ship a
  storage-adapter pattern: `kvStore` / `memoryStore`, thin site adapters, scheduler called from the site's own cron).
- **Multi-tenancy = one project per client.** Each client's data lives only in its own `seo/` and `seo/data/`. Isolation is by construction; the
  module adds no shared store.
- No schema change is needed: the module's state is a new private file `seo/data/local-gbp/state.json` (git-ignored by the installer's `seo/data/` rule).

## Existing capabilities (reused, not duplicated)
| Area | Existing | Used by the module |
|---|---|---|
| Business facts | `seo/business-profile.json` Facts with provenance (`verified`, `public`) | Only verified, public facts feed profile, description, schema |
| Local SEO | `/BWESEOLocal`, `docs/methodology/local-seo.md` (NAP, address type, location pages, doorway rules) | Extended with a `gbp` mode; same rules |
| Schema | `/BWESEOSchema` | LocalBusiness generator follows the same verified-only rule |
| Google | `gsc-client.mjs`, `seo-google.mjs`, `index-monitor*.mjs` (service-account Search Console) | Phase 3 Search Console integration (kept separate from GBP metrics) |
| Improvement queue | `content-inventory.json` `issues[]` (open → approved → fixed → verified, deferred, wont-fix) | Phase 3 recommendations use this queue |
| Scheduler/alerts | site-side cron calling `*-run.mjs`, `deriveAlerts` pattern | Phase 4 |
| State machine | `seo-state-core.mjs` | `/BWESEO` will read a local-GBP summary in Phase 3 |
| Installer | allowlist RULES (`src/*.mjs` → `seo/tools/`) | New files classified by existing rules |
| Security | validator credential scan, secret scan, isolation scan | Tokens will be referenced by name only |

## Gaps (new components)
Phase 1 (done in manual mode): eligibility, existing-profile discovery/duplicate gate, profile builder/validation/description, completeness, LocalBusiness
schema, website consistency audit, approval + manual verification assistant, CLI.
Phase 2+: OAuth + API-access detection, sync, authorized edits, review/post management, performance import, competitor analysis, monitoring, alerts,
dashboard section, monthly report.

## Dependencies and costs
No new runtime dependency. No paid service. Google Business Profile APIs are free but need an application/approval per Cloud project; Maps Platform
calls (if ever used) are billable and are not assumed free.
