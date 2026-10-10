// FAQ Engine client enhancement. The page is complete without this file; it adds three things:
//   1. search across questions, answers, categories and keywords, revealing matches inside collapsed categories
//   2. deep links: #anchor opens every collapsed ancestor, scrolls to the answer and focuses its question
//   3. a polite live-region result count
// Plain browser JavaScript, no dependencies, no framework.

/** @param {Document|HTMLElement} [scope] */
export function initFaq(scope = document) {
  const roots = scope.querySelectorAll('[data-faq-root]');
  roots.forEach((root) => setupRoot(/** @type {HTMLElement} */ (root)));
  openFromHash(scope);
  window.addEventListener('hashchange', () => openFromHash(scope));
}

function setupRoot(root) {
  const input = root.querySelector('[data-faq-search-input]');
  if (!input) return;
  const items = [...root.querySelectorAll('[data-faq-item]')];
  const cats = [...root.querySelectorAll('[data-faq-category]')];
  const status = root.querySelector('[data-faq-status]');
  const empty = root.querySelector('[data-faq-empty]');
  /** Open/closed state to restore when the search is cleared. */
  let saved = null;
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

  const run = () => {
    const words = norm(input.value).split(' ').filter(Boolean);
    if (!words.length) {
      items.forEach((i) => (i.hidden = false));
      cats.forEach((c) => (c.hidden = false));
      if (saved) { saved.forEach((open, el) => (el.open = open)); saved = null; }
      empty.hidden = true;
      status.textContent = '';
      return;
    }
    if (!saved) { saved = new Map(); [...cats, ...items].forEach((el) => saved.set(el, el.open)); }
    let shown = 0;
    items.forEach((i) => {
      const hay = i.getAttribute('data-search') || '';
      const hit = words.every((w) => hay.includes(w));
      i.hidden = !hit;
      if (hit) shown++;
    });
    cats.forEach((c) => {
      const any = c.querySelector('[data-faq-item]:not([hidden])');
      c.hidden = !any;
      c.open = !!any; // a matching question inside a collapsed category is revealed
    });
    empty.hidden = shown > 0;
    status.textContent = shown ? `${shown} matching ${shown === 1 ? 'question' : 'questions'}` : 'No matching questions found.';
  };
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { input.value = ''; run(); } });
}

function openFromHash(scope) {
  const raw = decodeURIComponent((location.hash || '').slice(1));
  if (!raw) return;
  const root = scope instanceof Document ? scope : scope.ownerDocument;
  let el = root.getElementById(raw);
  if (!el) el = root.querySelector(`[data-faq-aliases~="${CSS.escape(raw)}"]`);
  if (!el || !el.matches('[data-faq-item],[data-faq-category]')) return; // only FAQ anchors: never hijack other in-page links
  // A deep link must never be hidden by a stale search filter.
  for (let n = el; n; n = n.parentElement) if (n.hidden) n.hidden = false;
  for (let n = el; n; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true;
  const target = el.querySelector('summary') || el;
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: 'start' });
    if (target instanceof HTMLElement) { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
  });
}
