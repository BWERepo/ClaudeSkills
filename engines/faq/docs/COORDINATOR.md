# The FAQ Coordinator

The **FAQ Coordinator** is a Claude Code skill: **`/BWEFAQ`**. It guides a site owner from installing the engine to a published FAQ page, tracks where the run stands, lists what needs a human decision, and recommends one next step at a time. It follows the same pattern as the SEO engine's `/BWESEO` front door.

It does not replace the engine. It reads the engine's real state with `status`, then hands each stage to a dedicated skill that runs the engine's real commands. See [USER_MANUAL.md](USER_MANUAL.md).

## Getting the coordinator into your site

From the engine checkout:

```sh
node src/cli.mjs install /path/to/your-site            # engine into faq/engine/
node src/cli.mjs install /path/to/your-site --sync-skills   # skills into /path/to/your-site/.claude/skills
```

Then open your website's folder in Claude Code and type `/BWEFAQ`. Commit `.claude/skills/` if you want every checkout of the site to have the coordinator. After an engine update, run `--sync-skills` again (a skill file you edited by hand is reported as a conflict and left alone).

## How the coordinator works

1. If `faq/engine/INSTALL.json` is missing, it recommends `/BWEFAQInstall` and stops.
2. Otherwise it runs `node faq/engine/src/cli.mjs status` (read-only) and reads the stages, the FAQ counts by status, the last validation result, whether the FAQ page shows engine output, and what needs the owner.
3. It tells the owner in plain language what is done, what is next and why, names the one skill that does the next step, and asks before proceeding.
4. It never works from memory alone: in a new session it works out where you are from the files.

## Stages and skills

| Stage | Done when | Skill | Owner needed? |
|---|---|---|---|
| INSTALL | `faq/engine/` and the three `faq/*.json` files exist | `/BWEFAQInstall` | approve the dry run |
| CONFIGURE | site name, URL and adapter are set | `/BWEFAQSetup` | yes: categories, exclusions, structured-data policy |
| SCAN | `.faq/inventory.json` exists | `/BWEFAQGenerate` | check exclusions if the page count looks wrong |
| PROPOSE | a proposal exists or the registry has FAQs | `/BWEFAQGenerate` | no |
| REVIEW | no proposed FAQ is waiting for review | `/BWEFAQReview` | yes: every proposed FAQ |
| APPLY | at least one FAQ is ACTIVE and none is waiting | `/BWEFAQReview` | say go |
| WIRE PAGE | the built FAQ page contains engine output | `/BWEFAQPublish` | yes: template access |
| BUILD | `seo/faq-registry.json` is newer than the registry | `/BWEFAQPublish` | no |
| VALIDATE | `validate` reports 0 errors | `/BWEFAQPublish` | fix errors |
| PUBLISH | the owner publishes the site | owner | yes: deploying is the owner's action |

After the site changes, `/BWEFAQUpdate` reruns scan and propose, explains what changed, and walks review, apply, build and validate again.

## Status report format

```
FAQ run status
Stage: <current>   Next: <next>
FAQs: <n> ACTIVE, <n> DRAFT, <n> NEEDS REVIEW, <n> RETIRED
Needs you:
- <item and why>
Last validate: <errors/warnings or not run>
Next step: <one concrete action>
```

## Rules the coordinator and its skills follow

- Answers must come from text on the site. If the site does not say it, hold it as NEEDS REVIEW or point the visitor to the contact page.
- Quotes are copied exactly; a quote is never altered to make it match.
- The proposal is shown before `apply`. Hand-edited answers are never overwritten. FAQs are retired, never deleted.
- Nothing is deployed, committed or pushed unless the owner asks, and the owner is told the FAQ page is not live until they publish.

## Using it in a Claude Project without the skills installed

If the skills cannot be installed in the website folder, paste the contents of `skills/BWEFAQ/SKILL.md` (and the stage skills you need) into the Project's instructions. The engine commands are the same.
