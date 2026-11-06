---
name: BWE-SEO-REQUEST-INDEXING
description: "Requests indexing in Google Search Console for a list of production URLs the owner gives, by driving the Search Console website (URL Inspection, then Request indexing) in a real browser on the owner's computer, with the bundled tool tools/gsc-request-indexing. The owner signs in to Google once in that browser and the session is reused; Claude never types or stores a password. Picks the right property per site, stops for a property when Google's daily quota (about 10-12 requests) is reached, skips URLs already requested in the last 24 hours, and reports each URL as requested, rejected, quota reached or error, with screenshots for problems. Local-only: needs the owner's machine and Google Chrome. Use when the user says \"request indexing\", \"submit these URLs to Google\", \"ask Google to index these pages\", or invokes /BWE-SEO-REQUEST-INDEXING. Only on the owner's direct request: other BWE-SEO skills never call it."
---

# BWE-SEO-REQUEST-INDEXING

Click **Request indexing** in Google Search Console for each URL the owner gives. Google has no API for that button, so the bundled tool drives the Search Console website with Playwright in a browser window on the owner's computer.

> **Local-only:** this needs the owner's machine, Google Chrome and a visible browser window for the one-time sign-in. In a cloud Claude Code session, do not attempt it: say that it is local-only, give the owner the commands from step 5 to run on their own computer, and stop.

`$TOOL_SRC` = `${CLAUDE_PLUGIN_ROOT}/tools/gsc-request-indexing`, the tool bundled in this plugin (if that variable is not set, `../../tools/gsc-request-indexing` relative to this skill's base directory, resolved to an absolute path). `$TOOL_HOME` = `~/.bwe/gsc-request-indexing`, a stable working folder outside the plugin (plugin updates replace the plugin folder, so the tool's dependencies, log and screenshots live here). Use absolute paths. On Windows, run the commands in Git Bash or translate them to PowerShell.

## Do

1. **Collect the URLs.** Use the URLs in the owner's message, or a `.txt` / `.csv` file they name (one URL per line; every `http(s)://` URL on a line is used; `#` lines are ignored). If the owner refers to pages without listing them (for example "the pages I published today" in a website project), propose the production URLs you can confirm from the project and let the owner approve the list. Never invent URLs.
2. **Check the list.** Keep production URLs only. Drop staging, preview, `localhost`, `*.pages.dev` / `*.workers.dev` previews and anything not on the live domain, and say which ones you dropped. Write the final list to `$TOOL_HOME/urls-<yyyyMMddHHmm>.txt`.
3. **Prepare the tool** (first run, and after a plugin update):
   ```bash
   mkdir -p "$TOOL_HOME"
   cp "$TOOL_SRC/gsc-request-indexing.mjs" "$TOOL_SRC/package.json" "$TOOL_HOME/"
   cd "$TOOL_HOME" && [ -d node_modules/playwright ] || npm install --no-audit --no-fund
   ```
   It needs Node.js 18 or newer and Google Chrome. If Chrome is missing, use `--channel msedge`, or `--channel bundled` after `npx playwright install chromium`.
4. **Preview:** `cd "$TOOL_HOME" && node gsc-request-indexing.mjs <list file> --dry-run`. Show the owner the URLs, the properties that will be tried, and how many were already requested in the last 24 hours. Remind them that Google allows about 10-12 requests per property per day. Continue only when the owner agrees. If they named a property (for example `sc-domain:example.com`), pass `--property` in steps 5 and 6.
5. **Sign in (first time, or when the session has expired):** `cd "$TOOL_HOME" && node gsc-request-indexing.mjs --login`. A Chrome window opens. Tell the owner to sign in there to the Google account that has their Search Console properties. The window closes by itself once they are signed in, and the command exits (it waits up to 10 minutes). Never type, ask for or handle the owner's password or 2-step codes.
6. **Run:** `cd "$TOOL_HOME" && node gsc-request-indexing.mjs <list file>`. Each URL takes about 1-2 minutes plus a 20-second pause, so start it in the background and report when it finishes; do not poll it in a tight loop. If the output says the owner is not signed in, go back to step 5.
7. **Report** from the output and `$TOOL_HOME/gsc-indexing-log.csv`: one line per URL with its status, then the totals. Explain each status in plain words:
   - `requested`: Google accepted the request. This is **not** proof of indexing. Google decides whether and when to index, usually within days. To check later, use `/BWE-SEO-SEARCH-CONSOLE` (URL Inspection).
   - `quota_exceeded` or `left_for_tomorrow`: the property's daily quota was used up. Offer to run the same list again tomorrow; URLs already requested are skipped automatically.
   - `rejected`: Google's live test found a problem (for example noindex, robots.txt blocking, a 404 or a redirect). Show the screenshot path and suggest `/BWE-SEO-TECHNICAL` to find the cause.
   - `not_in_property` / `no_access` / `inspect_failed`: no property the owner can use matched. Ask for the exact property and rerun with `--property`.
   - `error`: show the detail and the screenshot path from `$TOOL_HOME/gsc-screenshots/`. If the page wording looks changed, say that the tool's matching text may need updating.

## Options worth knowing
`--property <id>`, `--max <n>` (stop after n successful requests), `--delay <sec>` (default 20), `--force` (request again even if requested in the last 24h; only when the owner asks), `--headless` (only after a successful `--login`). The full list is in `$TOOL_SRC/README.md`.

## Do not
- Do not run without the owner's direct request and their agreement to the previewed list. Other skills must not call this skill.
- Do not type, request, store or print passwords, 2-step codes, cookies or the browser profile's contents.
- Do not submit staging, preview or local URLs, or URLs on sites the owner has not named.
- Do not retry after `quota_exceeded` on the same day, loop the run, lower `--delay` below 10 seconds, or use `--force` unless the owner asks.
- Do not use Google's Indexing API: it is only for job-posting and livestream pages.
- Do not report a URL as indexed. `requested` only means the request was accepted.
- Do not commit the log, screenshots or URL lists to any repository, and do not change website files.
