# GSC Request Indexing

Takes a list of URLs and clicks **URL Inspection → Request indexing** for each one in Google Search Console, then writes the result for every URL to a CSV log.

Google has no API for the "Request indexing" button. The URL Inspection API can only read status, and the Indexing API is limited to job-posting and livestream pages. So this script drives the Search Console website in a real browser (Playwright).

From Claude, use the **`/bwe-skills:BWE-SEO-REQUEST-INDEXING`** skill. It sets up this tool in `~/.bwe/gsc-request-indexing`, previews the list, and runs the tool for you.

## Setup (once)

You need Node.js 18 or newer and Google Chrome (or Edge).

```bash
cd tools/gsc-request-indexing
npm install
node gsc-request-indexing.mjs --login
```

`--login` opens a browser window. Sign in to the Google account that has access to your Search Console properties. The window closes by itself once you are signed in. The sign-in is saved in a separate browser profile (`~/.gsc-indexer-profile`) and used again on later runs. The script never sees or stores your password.

## Run

```bash
node gsc-request-indexing.mjs urls.txt
node gsc-request-indexing.mjs urls.txt --property sc-domain:example.com
node gsc-request-indexing.mjs https://example.com/a https://example.com/b
node gsc-request-indexing.mjs urls.txt --dry-run        # preview only
```

- **Input:** URLs and/or files. A `.txt` file has one URL per line; a `.csv` file also works because every `http(s)://` URL on each line is picked up. Lines starting with `#` are ignored and duplicates are removed. See `urls.example.txt`.
- **Property:** if you don't pass `--property`, the script tries `sc-domain:<host>`, then `sc-domain:<parent domain>` (for subdomains), then the URL-prefix property `https://<host>/`. It remembers which one worked for each host.
- **Log:** results are added to `gsc-indexing-log.csv` (`timestamp,url,property,status,detail`). URLs marked `requested` in the last 24 hours are skipped on the next run unless you pass `--force`. If something goes wrong, a screenshot is saved in `gsc-screenshots/`.
- **Login expired:** in a normal (windowed) run the script waits for you to sign in again. In a `--headless` run it stops and tells you to run `--login`.

| Status | Meaning |
|---|---|
| `requested` | Google confirmed "Indexing requested" |
| `quota_exceeded` | That property's daily limit was reached. Its remaining URLs are left for the next run, and other properties continue |
| `rejected` | Google's live test found indexing issues (for example noindex, robots.txt or a 404). See the screenshot |
| `not_in_property` / `no_access` / `inspect_failed` | None of the tried properties matched. Pass `--property` |
| `error` | Unexpected page, a timeout or "Something went wrong". See the screenshot |

## Options

| Option | Default | |
|---|---|---|
| `-p, --property` | auto | Property for all URLs |
| `--delay <sec>` | `20` | Average pause between URLs, varied by ±25% |
| `--max <n>` | none | Stop after n successful requests |
| `--force` | off | Request again even if already requested in the last 24h |
| `--headless` | off | Run with no window (only after `--login`) |
| `--channel` | `chrome` | `chrome`, `msedge`, or `bundled` (Playwright Chromium; run `npx playwright install chromium` first) |
| `--profile <dir>` | `~/.gsc-indexer-profile` | Where the saved sign-in is kept |
| `--log <file>` | `gsc-indexing-log.csv` | Results file |

## Limits and caveats

- Google allows roughly **10–12 indexing requests per property per day**. Use the script for new or changed pages, not a whole sitemap. A sitemap is still the right way to make the full site known to Google.
- Requesting indexing does not guarantee that Google will index the page.
- Each request takes about 1–2 minutes because Google runs a live test first.
- The script matches English text on the Search Console pages (it forces `hl=en`). If Google changes that wording, the matching patterns in `requestIndexing()` need updating.
- If Google shows "This browser or app may not be secure" at sign-in, use `--channel chrome` (the default) with Chrome installed, not `bundled`.
- Automating the Search Console website is not an official Google interface. Keep the volume low and the delay on.
