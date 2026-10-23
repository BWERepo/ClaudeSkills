---
name: BWE-FAQ
description: The FAQ front door and coordinator. Reads the current website's real FAQ Engine state (faq-engine status), shows a short status dashboard (stage, FAQ counts by status, what needs the owner, last validation), recommends the ONE best next step and the skill that does it, then asks before proceeding. Guides the owner through installing the engine and creating the FAQ pages step by step, never skipping a review gate, never publishing an answer the site does not support. Use when the user says "FAQ", "FAQs", "work on the FAQ page", "what's next for the FAQ", "FAQ status", "where are we with FAQs", or invokes /BWE-FAQ, in any website project.
---

> `$BWEFAQ_ENGINE` = the FAQ Engine bundled in this plugin: `../../engines/faq`, relative to this skill's base directory (printed when the skill loads; resolve it to an absolute path first). It is only needed to install or
> update. Once installed, everything runs from the site's own copy: `node faq/engine/src/cli.mjs <command>`.

# BWE-FAQ: the FAQ front door

**If you don't know what to do next, run `/BWE-FAQ`.** It reads the project, says where the FAQ run stands, and tells you the next step. The other BWE-FAQ
skills are specialized tools; nobody has to remember them.

```
INSTALL → CONFIGURE → SCAN → PROPOSE → REVIEW → APPLY → WIRE PAGE → BUILD → VALIDATE → PUBLISH
```

Nothing in this skill is specific to one business. Names, URLs, prices and policies always come from the site's own pages.

## Step 1: read the state (never from memory)

From the website's repository root:

1. If `faq/engine/INSTALL.json` does not exist, the engine is not installed. The next step is `/BWE-FAQ-ENGINE install` (start with `--dry-run`). Stop here and offer that one step.
2. Otherwise run `node faq/engine/src/cli.mjs status`. It is read-only. It prints the stages (✓ done, ▸ next, · to do), FAQ counts by status, the last validation result, whether the FAQ
   page is built with engine output, what needs the owner, and the next step with the skill and command.
3. Sanity-check it against this conversation. If the owner just told you something the files cannot show ("I published it"), say so and carry on; never edit state files to
   match a claim.

## Step 2: tell the owner where things stand (short)

Show the status output, then in two or three plain sentences: what is done, what is next, and why. Use this fixed shape when asked for status:

```
FAQ run status
Stage: <current>   Next: <next>
FAQs: <n> ACTIVE, <n> DRAFT, <n> NEEDS REVIEW, <n> RETIRED
Needs you:
- <item and why>
Last validate: <errors/warnings or not run>
Next step: <one concrete action>
```

## Step 3: recommend ONE next step and ask

Name the skill that does it, say what it will and will not change, and ask before proceeding. Map of stage to skill:

| Stage | Skill |
|---|---|
| INSTALL | `/BWE-FAQ-ENGINE install` |
| CONFIGURE | `/BWE-FAQ-SETUP` |
| SCAN, PROPOSE | `/BWE-FAQ-GENERATE` |
| REVIEW, APPLY | `/BWE-FAQ-REVIEW` |
| WIRE PAGE, BUILD, VALIDATE, PUBLISH | `/BWE-FAQ-PUBLISH` |
| later reruns after the site changes | `/BWE-FAQ-REFRESH` |

## Rules (always)

- Answers must be supported by text on the site. If the site does not say it, hold it as NEEDS REVIEW or point the visitor to the contact page. Never invent prices, policies,
  guarantees, specifications, availability, contact details, or legal, medical or financial claims.
- Show `.faq/proposal.md` before `apply`. Never overwrite a hand-edited answer. Retire FAQs; never delete them.
- Categories must start collapsed. Search appears only when the collection is large enough (`searchThreshold`).
- Do not deploy, commit or push unless the owner asks. After the FAQ page is built, remind the owner that it is not live until they publish the site.
- Keep messages short: current stage, what changed, what is needed from the owner.
