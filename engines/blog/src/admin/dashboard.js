// Vanilla JS dashboard: no build step, no framework. Talks to the same-origin JSON API.
(() => {
  "use strict";

  const tokenInput = document.getElementById("token");
  const toast = document.getElementById("toast");
  const progressBar = document.getElementById("progress");
  const STORAGE_KEY = "bwe-blog-admin-token";

  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) tokenInput.value = saved;
  } catch {
    // sessionStorage can throw in locked-down browser contexts; the token field just stays empty.
  }
  tokenInput.addEventListener("input", () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, tokenInput.value);
    } catch {
      /* best effort only */
    }
  });

  function showToast(message, isError) {
    toast.textContent = message;
    toast.className = isError ? "toast error" : "toast";
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => (toast.hidden = true), 6000);
  }

  async function api(method, path, body) {
    const headers = { Authorization: `Bearer ${tokenInput.value}` };
    if (method !== "GET") headers["X-BWE-Admin"] = "1";
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
    return data;
  }

  // ---- tabs -------------------------------------------------------------------------------------------------
  const tabs = document.getElementById("tabs");
  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    for (const b of tabs.querySelectorAll("button")) b.removeAttribute("aria-current");
    btn.setAttribute("aria-current", "page");
    for (const panel of document.querySelectorAll(".panel")) panel.hidden = true;
    const panel = document.getElementById(`panel-${btn.dataset.tab}`);
    panel.hidden = false;
    load(btn.dataset.tab);
  });

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function badge(status) {
    return `<span class="badge ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
  }

  // ---- overview -----------------------------------------------------------------------------------------------
  async function loadConductorStatus() {
    const s = await api("GET", "/api/conductor-status");
    document.getElementById("conductor-summary").textContent = s.summary;
    document.getElementById("conductor-done").innerHTML = s.doneSoFar.map((d) => `<li>${escapeHtml(d)}</li>`).join("");
    document.getElementById("conductor-next-desc").textContent = s.nextAction.description;
    document.getElementById("conductor-next-command").textContent = s.nextAction.command;
    const guideLinkEl = document.getElementById("conductor-next-guide");
    if (s.nextAction.guideSection) {
      guideLinkEl.hidden = false;
      guideLinkEl.textContent = `Guide: ${s.nextAction.guideSection.title}`;
      guideLinkEl.onclick = () => openGuideSection(s.nextAction.guideSection.id);
    } else {
      guideLinkEl.hidden = true;
    }
    document.getElementById("conductor-also").innerHTML = s.alsoConsider.map((a) => `<li>${escapeHtml(a.description)} &mdash; <code>${escapeHtml(a.command)}</code></li>`).join("");
    document.getElementById("conductor-activity").innerHTML = s.recentActivity.map((e) => `<li>${escapeHtml(e.at)} &mdash; ${escapeHtml(e.summary)}</li>`).join("") || "<li>No activity recorded yet.</li>";
  }

  async function loadOverview() {
    const o = await api("GET", "/api/overview");
    await loadConductorStatus();
    const stats = [
      ["Total articles", o.totalArticles],
      ["Existing articles", o.existingArticles],
      ["Blog Engine articles", o.blogEngineArticles],
      ["Published", o.published],
      ["Drafts / in review", o.drafts],
      ["Recommendations", o.recommendations],
      ["Orphan articles", o.orphanArticles],
      ["Broken links", o.brokenLinks],
      ["Needing review", o.needingReview],
    ];
    document.getElementById("overview-stats").innerHTML = stats.map(([k, v]) => `<div class="stat"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("");
  }

  // ---- recommendations ------------------------------------------------------------------------------------
  async function loadRecommendations() {
    const recs = (await api("GET", "/api/recommendations")).filter((r) => r.status === "recommended" || r.status === "selected");
    const tbody = document.querySelector("#rec-table tbody");
    tbody.innerHTML = recs
      .map(
        (r) => `<tr data-id="${escapeHtml(r.id)}">
          <td><input type="checkbox" class="rec-check" aria-label="Select ${escapeHtml(r.title)}" ${r.status === "selected" ? "checked" : ""}></td>
          <td>${escapeHtml(r.title)}</td>
          <td>${escapeHtml(r.priority)}</td>
          <td>${escapeHtml(r.recommendedAction)}</td>
          <td>${escapeHtml(r.primarySearchIntent)}</td>
          <td>${escapeHtml(r.reason)}</td>
          <td><button type="button" data-view-rec="${escapeHtml(r.id)}" class="secondary-link">Details</button></td>
        </tr>`,
      )
      .join("");
  }
  function checkedRecIds() {
    return [...document.querySelectorAll("#rec-table .rec-check:checked")].map((c) => c.closest("tr").dataset.id);
  }
  document.getElementById("rec-table").addEventListener("click", (e) => {
    if (e.target.dataset.viewRec) {
      const row = e.target.closest("tr");
      showToast(row.children[5].textContent, false);
    }
  });

  // ---- articles -------------------------------------------------------------------------------------------
  let currentArticleId = null;
  async function loadArticles() {
    const articles = await api("GET", "/api/articles");
    const tbody = document.querySelector("#article-table tbody");
    tbody.innerHTML = articles
      .map(
        (a) => `<tr data-id="${escapeHtml(a.id)}">
          <td>${escapeHtml(a.title)}</td>
          <td>${escapeHtml(a.source)}</td>
          <td>${badge(a.status)}</td>
          <td>${escapeHtml(a.wordCount)}</td>
          <td>${escapeHtml(a.internalLinksIn?.length ?? 0)}</td>
          <td>${escapeHtml(a.internalLinksOut?.length ?? 0)}</td>
          <td><button type="button" data-open-article="${escapeHtml(a.id)}">Open</button></td>
        </tr>`,
      )
      .join("");
  }
  document.querySelector("#article-table").addEventListener("click", (e) => {
    const id = e.target.dataset.openArticle;
    if (id) openArticle(id);
  });
  async function openArticle(id) {
    const { article, draft } = await api("GET", `/api/articles/${id}`);
    currentArticleId = id;
    document.getElementById("article-dialog-title").textContent = article.title;
    document.getElementById("article-draft").value = draft ?? "(no editable draft — this is an existing article)";
    document.getElementById("article-draft").disabled = article.source !== "blog-engine";
    const issues = (article.validation?.issues ?? []).map((i) => `<div class="${i.severity}">${i.severity}: ${escapeHtml(i.message)}</div>`).join("") || "No validation issues recorded.";
    document.getElementById("article-issues").innerHTML = issues;
    document.getElementById("article-dialog").showModal();
  }
  document.getElementById("article-form").addEventListener("click", async (e) => {
    const action = e.target.dataset.action;
    if (!action || !currentArticleId) return;
    try {
      if (action === "save-draft") await api("PUT", `/api/articles/${currentArticleId}/draft`, { markdown: document.getElementById("article-draft").value });
      else if (action === "approve") await api("POST", `/api/articles/${currentArticleId}/approve`, {});
      else if (action === "publish") await api("POST", `/api/articles/${currentArticleId}/publish`, {});
      else if (action === "unpublish") await api("POST", `/api/articles/${currentArticleId}/unpublish`, {});
      else if (action === "regenerate") await api("POST", `/api/articles/${currentArticleId}/regenerate`, {});
      else if (action === "archive") await api("POST", `/api/articles/${currentArticleId}/archive`, {});
      else return;
      showToast(`${action}: done`, false);
      await loadArticles();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // ---- links / clusters / seo / settings --------------------------------------------------------------------
  async function loadLinks() {
    const l = await api("GET", "/api/links");
    document.getElementById("links-stats").innerHTML = [
      ["Suggestions", l.suggestions.length],
      ["Orphans", l.orphans.length],
      ["Weakly linked", l.weaklyLinked.length],
      ["Broken", l.broken.length],
    ]
      .map(([k, v]) => `<div class="stat"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
      .join("");
    document.querySelector("#links-table tbody").innerHTML = l.suggestions
      .slice(0, 200)
      .map((s) => `<tr><td>${escapeHtml(new URL(s.fromUrl).pathname)}</td><td>${escapeHtml(new URL(s.toUrl).pathname)}</td><td>${escapeHtml(s.anchor)}</td><td>${escapeHtml(s.score)}</td><td>${escapeHtml(s.band)}</td><td>${escapeHtml(s.status)}</td></tr>`)
      .join("");
  }
  async function loadClusters() {
    const clusters = await api("GET", "/api/clusters");
    document.getElementById("clusters-list").innerHTML =
      clusters
        .map((c) => `<div class="stat" style="margin-bottom:0.6rem"><dt>${escapeHtml(c.name)} ${c.complete ? "" : "(incomplete)"}</dt><dd style="font-size:0.9rem">${c.supportingArticles.length} article(s)${c.gaps.length ? `, gaps: ${escapeHtml(c.gaps.join(", "))}` : ""}</dd></div>`)
        .join("") || "<p>No clusters yet. Run Analyze first.</p>";
  }
  async function loadSeo() {
    const [state, bweseo] = await Promise.all([api("GET", "/api/overview").then((o) => o.state), api("GET", "/api/bweseo")]);
    document.getElementById("seo-stats").innerHTML = [
      ["Last rebuild", state.lastRebuildAt ?? "never"],
      ["Index valid", state.lastIndexValidation ? state.lastIndexValidation.passed : "unknown"],
      ["BWESEO status", bweseo.status],
      ["BWESEO detail", bweseo.detail],
    ]
      .map(([k, v]) => `<div class="stat"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
      .join("");
  }
  async function loadSettings() {
    document.getElementById("settings-json").textContent = JSON.stringify(await api("GET", "/api/settings"), null, 2);
  }

  let guideLoaded = false;
  async function loadGuide() {
    if (guideLoaded) return;
    const { html } = await api("GET", "/api/guide");
    document.getElementById("guide-content").innerHTML = html;
    guideLoaded = true;
  }

  function openGuideSection(anchorId) {
    document.querySelector('[data-tab="guide"]').click();
    loadGuide().then(() => document.getElementById(anchorId)?.scrollIntoView());
  }

  // ---- top-level actions ------------------------------------------------------------------------------------
  document.querySelector("#panel-overview .actions").addEventListener("click", async (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    try {
      if (action === "analyze") await api("POST", "/api/analyze", {});
      else if (action === "reanalyze") await api("POST", "/api/reanalyze", {});
      else if (action === "rebuild-index") await api("POST", "/api/rebuild-index", {});
      showToast(`${action}: done`, false);
      await loadOverview();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.querySelector("#panel-recommendations .actions").addEventListener("click", async (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    try {
      if (action === "rec-select-all") document.querySelectorAll(".rec-check").forEach((c) => (c.checked = true));
      else if (action === "rec-select-none") document.querySelectorAll(".rec-check").forEach((c) => (c.checked = false));
      else if (action === "rec-select-high") {
        document.querySelectorAll("#rec-table tbody tr").forEach((row) => {
          const priority = row.children[2].textContent;
          row.querySelector(".rec-check").checked = priority === "Critical" || priority === "High";
        });
      } else if (action === "rec-create-selected") {
        const ids = checkedRecIds();
        if (!ids.length) return showToast("Select at least one recommendation first.", true);
        await api("POST", "/api/recommendations/select", { ids });
        const result = await api("POST", "/api/generate", { ids });
        showToast(`Generated ${result.report.articlesGenerated} article(s), ${result.report.articlesPublished} published.`, false);
        await loadRecommendations();
        await loadOverview();
      } else if (action === "rec-reject-selected") {
        const ids = checkedRecIds();
        if (!ids.length) return showToast("Select at least one recommendation first.", true);
        await api("POST", "/api/recommendations/reject", { ids });
        await loadRecommendations();
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });

  const loaders = { overview: loadOverview, recommendations: loadRecommendations, articles: loadArticles, links: loadLinks, clusters: loadClusters, seo: loadSeo, settings: loadSettings, guide: loadGuide };
  async function load(tab) {
    try {
      await loaders[tab]?.();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // ---- progress stream ----------------------------------------------------------------------------------
  function connectEvents() {
    try {
      const es = new EventSource("/events");
      es.onmessage = (ev) => {
        try {
          const u = JSON.parse(ev.data);
          progressBar.hidden = false;
          progressBar.textContent = `${u.operation}: ${u.message}${u.count !== undefined ? ` (${u.count})` : ""}`;
          if (u.status === "complete" || u.status === "failed") setTimeout(() => (progressBar.hidden = true), 4000);
        } catch {
          /* ignore malformed event */
        }
      };
      es.onerror = () => {
        es.close();
        setTimeout(connectEvents, 5000);
      };
    } catch {
      /* SSE unsupported; the dashboard still works without live progress */
    }
  }
  connectEvents();

  load("overview");
})();
