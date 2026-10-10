// BWESEO Google Business Profile — reviews: manual import, prioritisation, reply drafting and compliant review requests
// (pure, zero dependencies). Reviews are imported by the administrator (paste/JSON) until Business Profile API access is approved.
// Drafts are never published by the engine: each needs a named approver, and the owner posts it in Google's interface.

export const DAY = 86400000;
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export function importReviews(rows, existing = [], { by, at = new Date().toISOString() } = {}) {
  if (!by) throw new Error("Name who is importing the reviews.");
  const errors = [];
  const byId = new Map(existing.map((r) => [r.id, r]));
  let added = 0;
  (Array.isArray(rows) ? rows : []).forEach((r, i) => {
    const rating = Number(r.rating);
    if (!r.id || !(rating >= 1 && rating <= 5) || !/^\d{4}-\d{2}-\d{2}/.test(r.date ?? "")) { errors.push(`row ${i + 1}: needs id, rating 1-5 and date YYYY-MM-DD`); return; }
    if (byId.has(r.id)) { const e = byId.get(r.id); if (r.reply && !e.reply) e.reply = r.reply; return; }
    byId.set(r.id, { id: String(r.id), rating, text: clean(r.text), date: r.date.slice(0, 10), reviewer: r.reviewer ? clean(r.reviewer) : null, reply: r.reply ? { text: clean(r.reply.text ?? r.reply), at: r.reply.at ?? null } : null, source: "manual-import", importedBy: by, importedAt: at, draft: null });
    added++;
  });
  return { reviews: [...byId.values()], added, errors };
}

export function filterReviews(reviews, { unanswered, maxRating, since } = {}) {
  return reviews.filter((r) => (unanswered ? !r.reply : true) && (maxRating ? r.rating <= maxRating : true) && (since ? r.date >= since : true));
}
// Priority: low ratings and long-waiting unanswered reviews first.
export function prioritize(reviews, today = new Date().toISOString().slice(0, 10)) {
  const age = (r) => Math.max(0, Math.floor((Date.parse(today) - Date.parse(r.date)) / DAY));
  return reviews.filter((r) => !r.reply).map((r) => ({ review: r, ageDays: age(r), priority: r.rating <= 2 ? "high" : r.rating === 3 || age(r) > 14 ? "medium" : "low" }))
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.priority] - ({ high: 0, medium: 1, low: 2 })[b.priority] || b.ageDays - a.ageDays);
}
export function summary(reviews) {
  const n = reviews.length;
  return { total: n, average: n ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / n) * 100) / 100 : null, unanswered: reviews.filter((r) => !r.reply).length, source: "manual import; not live-synced" };
}

// ---------------------------------------------------------------- reply drafting

const PRIVATE = /(\b\d{3}[\s.-]?\d{3,4}[\s.-]?\d{0,4}\b|[\w.+-]+@[\w-]+\.[\w.]+|\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Ave|Avenue|Lane|Ln|Drive|Dr)\b)/;
const OPENERS = {
  positive: ["Thank you for taking the time to write this.", "We appreciate you sharing your experience.", "It means a lot to hear this from you.", "Thanks for the kind words."],
  mixed: ["Thank you for the honest feedback.", "We appreciate you telling us both what worked and what didn't."],
  negative: ["We're sorry the experience fell short.", "Thank you for letting us know, and we're sorry this went wrong.", "We take this seriously, and we're sorry."],
};
const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const tone = (r) => (r >= 4 ? "positive" : r === 3 ? "mixed" : "negative");

// Never mentions the reviewer's details, never promises refunds/outcomes, never claims facts it was not given. `ctx.contactOffline`
// is a phone number or email the business has verified as public; omit it and no contact is offered.
export function draftReply(review, { businessName = "our team", contactOffline = null, usedOpeners = [] } = {}) {
  const t = tone(review.rating);
  const pool = OPENERS[t].filter((o) => !usedOpeners.includes(o));
  const opener = (pool.length ? pool : OPENERS[t])[hash(review.id) % (pool.length ? pool.length : OPENERS[t].length)];
  const first = review.reviewer ? clean(review.reviewer).split(" ")[0].replace(/[^A-Za-z'-]/g, "") : "";
  const hello = first ? `Hi ${first}, ` : "";
  const parts = [`${hello}${opener}`];
  if (t === "positive") parts.push(review.text ? "We're glad the work met your expectations." : "We're glad you had a good experience.");
  else if (t === "mixed") parts.push("We'll use your comments to improve where we can.");
  else parts.push(contactOffline ? `We'd like to understand what happened and see whether we can help. Please contact us at ${contactOffline}.` : "We would like to understand what happened. Please reach out to us directly so we can look into it.");
  parts.push(`— ${businessName}`);
  const text = parts.join(" ").replace(/\s+—/, " —");
  return { text, tone: t, opener, checks: checkReply(text), status: "draft", note: "Draft only. A named administrator must approve it, and the owner posts it in Google's interface." };
}
export function checkReply(text) {
  const issues = [];
  if (PRIVATE.test(text) && !/Please contact us at/.test(text)) issues.push("Contains what looks like private contact or address detail.");
  if (/\b(refund|compensat|free of charge|guarantee|we promise|discount)\b/i.test(text)) issues.push("Makes a promise (refund, compensation, guarantee). Remove it unless the owner has authorised it.");
  if (/\b(fake|liar|lying|scam)\b/i.test(text)) issues.push("Accuses the reviewer; keep replies factual and polite.");
  if (text.length > 4000) issues.push("Too long (Google limits replies to 4,000 characters).");
  return issues;
}

export function approveReply(review, { by, text = null, at = new Date().toISOString() }) {
  if (!by) throw new Error("Approval must name the approving administrator.");
  if (!review.draft) throw new Error("There is no draft to approve.");
  const finalText = text ? clean(text) : review.draft.text;
  const checks = checkReply(finalText);
  if (checks.length) throw new Error(`The reply has problems: ${checks.join(" ")}`);
  review.draft = { ...review.draft, text: finalText, checks, status: "approved", approvedBy: by, approvedAt: at };
  return review;
}
// The owner posted it themselves in Google's interface and says so.
export function markReplyPosted(review, { by, at = new Date().toISOString() }) {
  if (review.draft?.status !== "approved") throw new Error("Only an approved reply can be recorded as posted.");
  review.reply = { text: review.draft.text, at, source: "owner-reported" };
  review.draft.status = "posted-reported";
  review.draft.postedBy = by;
  return review;
}

// ---------------------------------------------------------------- compliant review requests

export function reviewRequestTemplate({ businessName, channel = "email", reviewLink = null }) {
  const link = reviewLink ?? "[your Google review link]";
  const bodies = {
    email: `Subject: How was your experience with ${businessName}?\n\nHello,\n\nThank you for choosing ${businessName}. If you have a few minutes, we would value your honest feedback, positive or negative, on Google: ${link}\n\nYour review helps other customers and helps us improve. There is no obligation, and your reply will not affect your service.\n\n${businessName}`,
    text: `Thanks for choosing ${businessName}. We'd value your honest feedback on Google: ${link}`,
    website: `Tell us how we did. Share your honest experience on Google: ${link}`,
  };
  return { channel, text: bodies[channel] ?? bodies.email, checks: checkReviewRequest(bodies[channel] ?? bodies.email), rules: ["Ask every customer the same way; never only the happy ones.", "No rewards, discounts or gifts in exchange for reviews.", "No fake reviews and no review-gating.", "Record requests only where the customer has consented to be contacted."] };
}
export function checkReviewRequest(text) {
  const issues = [];
  if (/\b(discount|reward|free|gift|coupon|prize|entered into|in exchange|% off|cash)\b/i.test(text)) issues.push("Offers or implies a reward for a review.");
  if (/\b(5[- ]?star|five[- ]star|positive review|great review|good review)\b/i.test(text)) issues.push("Asks for a particular rating or only positive reviews.");
  if (/\b(if you (were|are) (happy|satisfied|pleased)|only if)\b/i.test(text)) issues.push("Looks like review-gating (asking only satisfied customers).");
  if (/\b(otherwise|instead|contact us first|before (you )?(post|leave))\b/i.test(text)) issues.push("Steers unhappy customers away from reviewing.");
  return issues;
}
