# Chat research prompt (fallback when Claude Code cannot reach Mobbin)

Use in a Claude chat (desktop or web) with the Mobbin connector enabled. Fill the braces, paste, and save the answer into the project as `docs/design/mobbin-research/<date>-chat/chat-research.md`. Then run `/bwe-skills:BWE_MobbinResearch` in the project; it imports these references as `mobbin-chat`.

---

You are a senior creative director and UX researcher. Use the Mobbin tools (search_sections, search_screens, search_flows) for real references. Do not describe designs you did not retrieve.

Project: {one paragraph: business, offerings, location if relevant}
Audience: {…}
Primary conversion: {…}
Functions to research: {homepage, navigation, catalog, detail, forms/inquiry, mobile, conversion …}
Adjacent industries to include: {…}

Find at least 12 relevant screens, sections or flows (aim for 20). Avoid near-duplicates; at most 3 from one app.

For every reference return one row with exactly these fields:
app · kind (section/screen/flow) · function · pattern (a few words) · platform · Mobbin link · image_url · tool used · query used · strengths · weaknesses · element worth adapting

Then a code block with the same data as JSON: `{"candidates": [{"app", "kind", "function", "pattern", "platform", "link", "image_url", "tool", "query", "strengths", "weaknesses", "adapt"}]}`.

Do not score, do not propose directions, do not write code. If a tool fails or returns nothing, say so.
