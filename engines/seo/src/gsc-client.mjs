// BWESEO Search Console API client — zero dependencies and NO Node-only imports, so it runs unchanged in Node 18+
// (the /BWESEO CLI) and in a Cloudflare Worker (scheduled Google index monitoring). Split out of seo-google.mjs
// in engine 1.9.0 so there is exactly one Search Console client; seo-google.mjs re-exports everything here.
//
// Service-account authentication (a supported Google mechanism): the key is read from the host environment by NAME
// (analytics.searchConsole.credentialsSource, e.g. "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON"), used only inside the
// client closure, and never logged, returned or sent to a browser.
import { classifyUrl, environmentsOf } from "./seo-state-core.mjs";

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- secrets hygiene

// Strip anything that looks like a credential from text that may be logged or shown.
export function redact(text) {
  return String(text ?? "")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/"private_key"\s*:\s*"[^"]*"/g, ['"private', '_key":"[redacted]"'].join(""))
    .replace(/"(client_secret|refresh_token|access_token|private_key_id)"\s*:\s*"[^"]*"/g, '"$1":"[redacted]"')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted token]")
    .replace(/ya29\.[\w.-]+/g, "[redacted token]")
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [redacted]");
}

// A pointer to where the credential lives — never the credential. "env:NAME" or "secret:NAME".
const POINTER_RE = /^(env|secret):[A-Z][A-Z0-9_]{2,63}$/;
export function parseCredentialsSource(v) {
  if (!isStr(v)) return { valid: false, reason: "no credentialsSource is configured" };
  const m = POINTER_RE.exec(v.trim());
  if (!m)
    return {
      valid: false,
      reason:
        'credentialsSource must be a NAME such as "env:BWESEO_GSC_SERVICE_ACCOUNT_JSON" — never the credential itself',
    };
  return { valid: true, kind: m[1], name: v.trim().slice(m[1].length + 1), pointer: v.trim() };
}

// Site-level Search Console API configuration, from the project's own config. Booleans and a
// pointer only — safe to show anywhere.
export function searchConsoleApiConfig(config) {
  const sc = config?.analytics?.searchConsole ?? {};
  const enabled = sc.enabled === true || sc.api?.enabled === true;
  const src = parseCredentialsSource(sc.credentialsSource ?? sc.api?.credentialsSource);
  return {
    enabled,
    credentialsSource: src.valid ? src.pointer : null,
    credentialsSourceValid: src.valid,
    reason: !enabled
      ? "the Search Console API integration is not enabled for this project"
      : src.valid
        ? null
        : src.reason,
    property: isStr(sc.verifiedProperty) ? sc.verifiedProperty : null,
    propertyType: normalizePropertyType(sc.propertyType),
    sitemapUrl: sc.sitemap?.url ?? config?.publication?.sitemapUrl ?? null,
  };
}

export function normalizePropertyType(v) {
  const s = String(v ?? "").toLowerCase();
  return s === "domain" ? "domain" : /url|prefix/.test(s) ? "url-prefix" : "unknown";
}

// Is the credential actually present in this environment? Returns booleans only.
export function credentialStatus(config, env = {}) {
  const c = searchConsoleApiConfig(config);
  if (!c.enabled || !c.credentialsSourceValid)
    return { ...c, available: false, present: false };
  const raw = env[c.credentialsSource.split(":")[1]];
  if (!isStr(raw))
    return {
      ...c,
      available: false,
      present: false,
      reason: `the credential named by credentialsSource is not set in this environment`,
    };
  let ok = false;
  try {
    const j = JSON.parse(raw);
    ok = isStr(j.client_email) && isStr(j.private_key);
  } catch {
    ok = false;
  }
  return ok
    ? { ...c, available: true, present: true, reason: null }
    : { ...c, available: false, present: true, reason: "the credential is present but is not a service-account key" };
}

// ---------------------------------------------------------------- guardrails

// Only PRODUCTION URLs are ever sent to Google. Staging, preview, local and unknown hosts never are.
export function guardProductionTarget(url, config, what = "this action") {
  const env = classifyUrl(url, config);
  if (env !== "PRODUCTION")
    throw new Error(
      `${what} refused: ${url} is ${String(env).toLowerCase()}, not production — staging, preview and local URLs are never submitted to Google`,
    );
  return true;
}


const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/webmasters/v3";
const INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const SCOPE_RW = "https://www.googleapis.com/auth/webmasters";
const SCOPE_RO = "https://www.googleapis.com/auth/webmasters.readonly";

// Accepts a string (UTF-8 encoded) or bytes. Works in Node and Workers (no Buffer).
const b64u = (input) => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
};

async function signJwt(serviceAccount, scope, nowSec) {
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope,
      aud: TOKEN_URL,
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );
  const pem = String(serviceAccount.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await globalThis.crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  return `${header}.${claim}.${b64u(new Uint8Array(sig))}`;
}

const failure = (kind, message) => ({ ok: false, kind, message: redact(message).slice(0, 300) });

// The Search Console property as the API names it.
export function siteUrlFor(config) {
  const c = searchConsoleApiConfig(config);
  const envs = environmentsOf(config);
  if (c.propertyType === "domain" && c.property) return `sc-domain:${c.property}`;
  if (c.propertyType === "url-prefix") return `${(envs.production?.url ?? "").replace(/\/+$/, "")}/`;
  return null;
}

// Every method returns { ok: true, data } or { ok: false, kind, message } — it never throws for an
// unavailable or failing API, so the workflow degrades instead of breaking. Credentials live only in
// this closure; nothing here returns, logs or serializes them.
export function createSearchConsoleClient({ config, env = {}, fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 20_000 }) {
  const status = credentialStatus(config, env);
  const siteUrl = siteUrlFor(config);
  let cached = null;
  const unavailable = () =>
    failure(
      status.enabled ? "not-configured" : "disabled",
      status.reason ?? "the Search Console API is not available",
    );

  // Every outbound request (token exchange and API call) gets the same bound: the request is aborted after `timeoutMs`, and the
  // wait itself is capped too, so a fetch that ignores its signal cannot hang the caller. No retries: a call is one request, so the
  // callers' own call budgets count requests exactly (the token exchange is not a Search Console API call and is cached).
  const timed = async (run) => {
    const ctl = new AbortController();
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(Object.assign(new Error("request timed out"), { name: "TimeoutError" })); }, timeoutMs); });
    try { return await Promise.race([run(ctl.signal), limit]); } finally { clearTimeout(timer); }
  };
  let exchange = null; // one token exchange in flight at a time; concurrent callers share it
  async function token(scope) {
    if (cached && cached.scope === scope && cached.exp > now() + 60_000) return cached.value;
    if (exchange?.scope === scope) return exchange.promise;
    const promise = (async () => {
      const sa = JSON.parse(env[status.credentialsSource.split(":")[1]]);
      const jwt = await signJwt(sa, scope, Math.floor(now() / 1000));
      const j = await timed(async (signal) => {
        const res = await fetchImpl(TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
          signal,
        });
        if (!res.ok) throw Object.assign(new Error(`token exchange failed (HTTP ${res.status})`), { http: res.status });
        try { return await res.json(); } catch { throw Object.assign(new Error("token response was not JSON"), { http: 502 }); }
      });
      if (!isStr(j?.access_token)) throw Object.assign(new Error("token response had no access token"), { http: 502 });
      cached = { scope, value: j.access_token, exp: now() + (Number(j.expires_in) || 3600) * 1000 };
      return cached.value;
    })();
    exchange = { scope, promise };
    try { return await promise; } finally { if (exchange?.promise === promise) exchange = null; }
  }

  async function call(method, url, { body, scope = SCOPE_RO } = {}) {
    if (!status.available) return unavailable();
    if (!siteUrl) return failure("not-configured", "the Search Console property (verifiedProperty / propertyType) is not configured");
    try {
      const t = await token(scope);
      const { res, text } = await timed(async (signal) => {
        const res = await fetchImpl(url, {
          method,
          headers: { authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal,
        });
        return { res, text: await res.text() };
      });
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (res.ok) return { ok: true, data };
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      if (data?.error?.status === "RESOURCE_EXHAUSTED" || /quota|rate limit/i.test(msg)) return failure("quota", `Search Console API quota or rate limit reached: ${msg}`);
      if (res.status === 401 || res.status === 403) return failure("permission-denied", `Search Console refused the request (HTTP ${res.status}): ${msg}`);
      if (res.status === 404) return failure("not-found", msg);
      if (res.status === 429) return failure("quota", `Search Console API quota or rate limit reached: ${msg}`);
      return failure("api-error", `Search Console API error (HTTP ${res.status}): ${msg}`);
    } catch (e) {
      if (e?.name === "TimeoutError" || e?.name === "AbortError") return failure("timeout", `Google did not answer within ${Math.round(timeoutMs / 1000)} seconds`);
      if (e?.http === 400 || e?.http === 401) return failure("auth-failed", `Google rejected the service-account sign-in (HTTP ${e.http}) — the key may be revoked, expired or malformed`);
      if (e?.http === 403) return failure("permission-denied", `Google refused the service-account sign-in (HTTP 403)`);
      if (e?.http === 429) return failure("quota", "Google's sign-in service is rate limiting this client (HTTP 429); try again later");
      if (e?.http >= 500) return failure("api-error", `Google's sign-in service is unavailable (HTTP ${e.http}); try again later`);
      return failure("network", `could not reach Google: ${e?.message ?? e}`);
    }
  }

  const feed = (u) => encodeURIComponent(u);
  const site = () => encodeURIComponent(siteUrl ?? "");
  return {
    available: status.available,
    status: { ...status },
    siteUrl,
    getSitemap: (url) => call("GET", `${API}/sites/${site()}/sitemaps/${feed(url)}`),
    listSitemaps: () => call("GET", `${API}/sites/${site()}/sitemaps`),
    submitSitemap: (url) => call("PUT", `${API}/sites/${site()}/sitemaps/${feed(url)}`, { scope: SCOPE_RW }),
    inspectUrl: (url) => call("POST", INSPECT_URL, { body: { inspectionUrl: url, siteUrl, languageCode: "en-US" } }),
    searchAnalytics: (body) => call("POST", `${API}/sites/${site()}/searchAnalytics/query`, { body }),
  };
}

// ---------------------------------------------------------------- sitemap reconciliation (idempotent)

// Decide whether a submission is necessary. A sitemap that Google already has is NOT resubmitted:
// sitemaps are re-read automatically, and repeated submission adds nothing.
export function planSitemapAction({ remote, force = false } = {}) {
  if (!remote)
    return { action: "submit", reason: "the sitemap is not registered with Google Search Console" };
  if (force) return { action: "resubmit", reason: "a resubmission was explicitly requested" };
  const errors = Number(remote.errors ?? 0);
  if (errors > 0) return { action: "resubmit", reason: `Google reports ${errors} error(s) reading the sitemap` };
  if (remote.isPending)
    return { action: "none", reason: "Google is still processing the sitemap", message: "Sitemap registered; Google is still processing it — nothing to resubmit." };
  return { action: "none", reason: "already registered", message: "Sitemap already registered with Google Search Console." };
}

const sitemapStateFrom = (data, url, method, at) => {
  const errors = Number(data?.errors ?? 0);
  const web = (data?.contents ?? []).find((c) => c.type === "web");
  return {
    url,
    submitted: "yes",
    submissionMethod: method,
    ...(isDate(at) ? { submissionAt: at } : {}),
    status: errors > 0 ? "error" : data?.isPending ? "pending" : "success",
    verifiedOn: today(),
    ...(isStr(data?.lastDownloaded) ? { lastRead: data.lastDownloaded.slice(0, 10) } : {}),
    ...(Number.isFinite(Number(web?.submitted)) ? { discoveredPages: Number(web.submitted) } : {}),
  };
};

// Reconcile the site's sitemap with Google Search Console. Production-only. Returns what happened
// and the site-level sitemap record to store — it changes no project file itself.
export async function reconcileSitemap({ client, config, dryRun = true, force = false }) {
  const sitemapUrl = searchConsoleApiConfig(config).sitemapUrl;
  if (!isStr(sitemapUrl)) return { ok: false, action: "none", kind: "not-configured", message: "no sitemap URL is configured" };
  guardProductionTarget(sitemapUrl, config, "Sitemap submission");
  if (!client.available)
    return { ok: false, action: "none", kind: client.status.enabled ? "not-configured" : "disabled", message: client.status.reason };
  const got = await client.getSitemap(sitemapUrl);
  if (!got.ok && got.kind !== "not-found") return { ok: false, action: "none", kind: got.kind, message: got.message };
  const plan = planSitemapAction({ remote: got.ok ? got.data : null, force });
  if (plan.action === "none")
    return { ok: true, action: "none", message: plan.message, sitemap: sitemapStateFrom(got.data, sitemapUrl, undefined, undefined) };
  if (dryRun) return { ok: true, action: "would-" + plan.action, message: `Would ${plan.action} the sitemap: ${plan.reason}.`, reason: plan.reason };
  const put = await client.submitSitemap(sitemapUrl);
  if (!put.ok) return { ok: false, action: "none", kind: put.kind, message: put.message };
  const after = await client.getSitemap(sitemapUrl);
  return {
    ok: true,
    action: plan.action === "submit" ? "submitted" : "resubmitted",
    message: `Sitemap ${plan.action === "submit" ? "submitted" : "resubmitted"} through the Search Console API: ${plan.reason}.`,
    sitemap: sitemapStateFrom(after.ok ? after.data : null, sitemapUrl, "api", today()),
  };
}

