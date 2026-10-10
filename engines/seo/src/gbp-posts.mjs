// BWESEO Google Business Profile — post drafts (pure, zero dependencies). The engine drafts, validates and tracks; the OWNER publishes in
// Google's interface until Business Profile API access is approved. Nothing is posted automatically: a post needs a named approver, and
// scheduling records an intended time only. Status after the owner posts is "owner-reported", never "published by BWESEO".

export const POST_TYPES = ["update", "announcement", "offer", "event"];
export const POST_STATES = ["draft", "approved", "scheduled", "posted-reported", "rejected"];
export const POST_MAX = 1500;
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const words = (s) => new Set(clean(s).toLowerCase().match(/[a-z]{4,}/g) ?? []);
export const similarity = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let i = 0; for (const w of A) if (B.has(w)) i++; return i / (A.size + B.size - i); };

export function validatePost(p, { existing = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const issues = [];
  const err = (m) => issues.push({ level: "error", message: m });
  const warn = (m) => issues.push({ level: "warning", message: m });
  if (!POST_TYPES.includes(p.type)) err(`Type must be one of ${POST_TYPES.join(", ")}.`);
  const text = clean(p.text);
  if (!text) err("Post text is required."); else if (text.length > POST_MAX) err(`Post text is ${text.length} characters; the limit is ${POST_MAX}.`);
  else if (text.length < 40) warn("Very short post; say something useful to customers.");
  if (/\b(\d{3}[\s.-]\d{3,4}[\s.-]?\d{0,4})\b/.test(text)) err("Posts must not contain phone numbers in the text (use a call-to-action button).");
  if (/\b(best|#1|guarantee[sd]?|cheapest)\b/i.test(text)) warn("Contains an unsupported superlative or guarantee.");
  if (p.type === "offer") {
    if (!clean(p.title)) err("An offer needs a title.");
    if (!p.start || !p.end) err("An offer needs start and end dates."); else if (p.end < p.start) err("Offer end is before its start.");
    else if (p.end < today) err("Offer has already ended.");
    if (!clean(p.terms)) warn("State the offer's real terms (what it covers, any conditions).");
  }
  if (p.type === "event") {
    if (!clean(p.title)) err("An event needs a title.");
    if (!p.start || !p.end) err("An event needs start and end dates."); else if (p.end < p.start) err("Event end is before its start.");
  }
  for (const e of existing.filter((x) => x.state !== "rejected" && x.id !== p.id)) if (similarity(text, e.text) >= 0.7) { warn(`Very similar to an earlier post (${e.id}). Avoid repeating posts only to look active.`); break; }
  if (p.link && !/^https:\/\//.test(p.link)) err("The call-to-action link must be an https URL.");
  return { issues, errors: issues.filter((i) => i.level === "error"), warnings: issues.filter((i) => i.level === "warning"), valid: !issues.some((i) => i.level === "error") };
}

// Suggest post topics from pages the site really published (inventory pages). Suggestions carry the page as evidence; text stays empty
// for the administrator, except a factual starter built from the page title.
export function suggestPosts(pages = [], existing = [], { today = new Date().toISOString().slice(0, 10), maxAgeDays = 60 } = {}) {
  const out = [];
  for (const pg of pages) {
    if (!pg?.path || !pg.title) continue;
    const date = pg.publishedAt ?? pg.updatedAt;
    if (!date || (Date.parse(today) - Date.parse(date)) / 86400000 > maxAgeDays) continue;
    if (existing.some((e) => e.sourcePath === pg.path && e.state !== "rejected")) continue;
    out.push({ type: "update", sourcePath: pg.path, title: pg.title, text: `New on our website: ${pg.title}. Read more for details.`, link: pg.url ?? null, evidence: `Page ${pg.path} published or updated ${date}.`, note: "Starter only. Add something genuinely useful; skip it if there is nothing new to say." });
  }
  return out;
}

export function addDraft(posts, draft, { by, at = new Date().toISOString() } = {}) {
  if (!by) throw new Error("Name who is drafting the post.");
  const id = `post-${String(posts.length + 1).padStart(3, "0")}`;
  const v = validatePost({ ...draft, id }, { existing: posts });
  const post = { ...draft, id, text: clean(draft.text), state: "draft", createdBy: by, createdAt: at, checks: v.issues };
  posts.push(post);
  return post;
}
export function approvePost(post, { by, at = new Date().toISOString() }, existing = []) {
  if (!by) throw new Error("Approval must name the approving administrator.");
  const v = validatePost(post, { existing });
  if (!v.valid) throw new Error(`Cannot approve: ${v.errors.map((e) => e.message).join(" ")}`);
  post.state = "approved"; post.approvedBy = by; post.approvedAt = at; post.approvedText = post.text;
  return post;
}
export function schedulePost(post, when) {
  if (post.state !== "approved" || post.approvedText !== post.text) throw new Error("Only an approved, unchanged post can be scheduled.");
  if (!/^\d{4}-\d{2}-\d{2}/.test(when ?? "")) throw new Error("Give the intended date as YYYY-MM-DD.");
  post.state = "scheduled"; post.scheduledFor = when;
  post.scheduleNote = "Intended date only. BWESEO does not publish; the owner posts it in Google's interface (or, once API access is approved, an approved scheduler job may submit it).";
  return post;
}
export const duePosts = (posts, today = new Date().toISOString().slice(0, 10)) => posts.filter((p) => p.state === "scheduled" && p.scheduledFor.slice(0, 10) <= today);
export function markPosted(post, { by, at = new Date().toISOString() }) {
  if (!["approved", "scheduled"].includes(post.state)) throw new Error("Only an approved post can be recorded as posted.");
  post.state = "posted-reported"; post.postedBy = by; post.postedAt = at; post.postedSource = "owner-reported";
  return post;
}
