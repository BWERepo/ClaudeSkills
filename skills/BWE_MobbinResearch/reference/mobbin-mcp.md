# Mobbin MCP

Mobbin's official MCP server is hosted at `https://api.mobbin.com/mcp` (Streamable HTTP, OAuth sign-in with a Mobbin account). Source: Mobbin's MCP documentation (docs.mobbin.com/mcp), checked 2026-10-22. Setup per environment is in `installation.md`.

## Tools (as documented by Mobbin)

| Tool | Searches / returns |
|---|---|
| `search_screens` | Individual app and web screens; low-res preview plus a high-res `image_url` |
| `search_flows` | Multi-step flows (onboarding, checkout, booking); previews of a few screens per flow |
| `search_sections` | Website sections (heroes, pricing, footers, navigation, galleries) |
| `list_collections` | The user's saved Mobbin collections with item counts |
| `get_collection_contents` | Items in a saved collection, including team comments |

`image_url` links expire after 30 days. Record the retrieval date and use `refresh` mode to renew them; do not download images into the client repository.

Exact parameter names are not documented in this file on purpose: read them from the tool schema when the tools are loaded, and use only parameters the schema defines. Do not invent tools, endpoints or parameters.

## Finding the tools

In Claude Code, connector tools are prefixed by the server name, for example `mcp__mobbin__search_screens` (CLI-added server) or `mcp__<connector-id>__search_screens` (account connector). Match on the suffix. If they appear only as deferred tools, load them with ToolSearch using the query `search_screens` (one call can load several: `search_screens search_flows search_sections`).

## Connection test (always, before research)

1. Tools found? If not: unavailable.
2. Run one small real search tied to the brief (for example `search_sections` for a hero pattern in the project's industry).
3. Results returned with at least one item? If the call errors with an auth message, the connector needs re-authorisation; if it returns zero items, try one broader query before concluding.
4. Record the tool names, the test query and the result count in `state.json`.

Only after a successful test may the report say "researched with Mobbin MCP".

## Search tactics

- Query by **pattern and intent**, not by brand: "editorial product grid", "wishlist", "quote request form", "booking flow", "service area page", "before and after gallery".
- Use `search_sections` for website patterns, `search_screens` for single views (including mobile web), `search_flows` for journeys (inquiry, checkout, onboarding).
- Run each important pattern with 2-3 phrasings; stop when results repeat.
- Mine adjacent industries (see `research-methodology.md`).
- If the user keeps Mobbin collections for this project, offer `list_collections` / `get_collection_contents` as a starting set. Never read a collection that belongs to another client's project unless the user names it.

## When Mobbin is unavailable

Say exactly what failed (no tools; tools present but auth error; zero results). Then offer, in this order:

1. **Fix and retry** using `installation.md` for the current environment.
2. **Chat research:** in a Claude chat (desktop or web) with the Mobbin connector enabled, run `templates/chat-research-prompt.md`; bring the result back as a file or paste. Label those references `mobbin-chat`, keep the links, and say the research ran outside this session.
3. **Manual references:** the user supplies Mobbin URLs, screenshots or descriptions. Label them `manual`. You may score and organise them but must not add references of your own and call them Mobbin results.

A mixed run is fine; every reference keeps its own source label in `candidates.json` and in the report.
