# Installation, Mobbin setup and troubleshooting

## Requirements

- The `bwe-skills` plugin installed in the project (see the catalog `README.md`). The skill runs as `/bwe-skills:BWE_MobbinResearch`.
- Node 18+ for `scripts/score.mjs` (no npm packages).
- A Mobbin account with MCP access. Mobbin's MCP documentation does not state a plan requirement; the owner's research (October 2026) indicates MCP access needs Pro or Team. Check mobbin.com/pricing before buying.
- Without Mobbin, the skill still works in chat-research or manual-reference mode.

## Mobbin pricing (owner-reported, October 2026; verify before buying)

| Plan | Cost | Billing |
|---|---|---|
| Free | $0 | — |
| Pro quarterly | $45 | every 3 months |
| Pro annual | $120 | yearly |
| Team annual | $192 per user | yearly |

Suggested approach: try Pro quarterly and confirm your Claude environment can actually call the Mobbin tools before committing to a year.

## Connect Mobbin

### Claude Desktop / claude.ai (recommended; the Claude Code CLI shares these connectors)
1. In Claude: **Customize → Connectors → Add → Browse connectors**, choose **Mobbin**, click **Connect**.
2. Sign in to Mobbin and authorise.
3. On Claude Team/Enterprise an admin may first need to add Mobbin under **Organization settings → Connectors**.

Mobbin's docs list this as a verified directory connector. If the directory does not show Mobbin, add a custom connector with the URL `https://api.mobbin.com/mcp`.

### Claude Code CLI only
```bash
claude mcp add mobbin --scope user --transport http https://api.mobbin.com/mcp
```
Start a new session, open `/mcp`, select **mobbin → Authenticate**, sign in in the browser.

### Claude Code cloud sessions
Do not assume a connector set up on your computer or account is available in a cloud session; this was not verified when the skill was written. Test it in the cloud session itself:

> Check whether Mobbin MCP is available in this cloud coding session. List the Mobbin tools you can actually invoke. Do not claim access based only on configuration files or account settings. If unavailable, explain the limitation without making any changes.

If it is not available, keep building in the cloud and do the research in Claude chat:
1. In a Claude chat with the Mobbin connector on, run `templates/chat-research-prompt.md` for the project.
2. Save the result into the project (for example `docs/design/mobbin-research/<date>-chat/`).
3. Run `/bwe-skills:BWE_MobbinResearch` in the cloud session; it imports those references as `mobbin-chat`, scores them, and continues to the directions and the approval gate.

### Test
Ask: "Can you access Mobbin MCP? List the available Mobbin tools and find examples of premium e-commerce product galleries." Real Mobbin references in the answer mean you are ready. The skill runs the same check itself at the start of every run.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Mobbin tools not found" | Connector not added or not enabled in this session; restart the session after adding it; in cloud, use the chat-research fallback |
| Auth error on a search | Re-authorise (Connectors page, or `/mcp → mobbin → Authenticate`) |
| Zero results | Broaden the query (pattern words, not brand names); check the Mobbin plan |
| Images no longer load in an old report | Mobbin `image_url`s expire after 30 days; run `refresh` mode |
| `score.mjs` errors | Run `node scripts/score.mjs help`; check the candidates JSON against `templates/reference-scorecard.md` |
| Skill not listed | Run `/bwe-skills:BWE_UpdateSkills` (or `claude plugin marketplace update bwe-skills` then `claude plugin update bwe-skills@bwe-skills --scope project`), then restart |

## Versions and updates

The skill ships inside the `bwe-skills` plugin and takes the plugin's version (`yyyy.mm.dd.nn`). Changes are listed in the catalog `CHANGELOG.md`. Pin a version with `claude plugin marketplace add BWERepo/ClaudeSkills@v<version> --scope project`. Updates in cloud environments are explicit; refresh the plugin as above.
