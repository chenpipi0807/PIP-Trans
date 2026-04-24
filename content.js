(() => {
  if (window.__pipTransLoaded) return;
  window.__pipTransLoaded = true;

  let popupHost  = null;
  let closeTimer = null;
  const TRANS_ATTR = 'data-pip-trans';

  // ── Popup styles ──────────────────────────────────────────────────────────
  const POPUP_CSS = `
    :host { all: initial; }
    .box {
      background: #1e1e2e; color: #cdd6f4;
      border-radius: 10px; padding: 12px 14px 8px;
      font: 14px/1.6 -apple-system,"Segoe UI",sans-serif;
      box-shadow: 0 8px 32px rgba(0,0,0,.55);
      pointer-events: all; border: 1px solid #313244;
      animation: fadein .15s ease;
      max-height: 65vh; overflow-y: auto;
      scrollbar-width: thin; scrollbar-color: #45475a transparent;
    }
    @keyframes fadein { from{opacity:0;transform:translateY(-4px)} to{opacity:1} }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; gap:8px; }
    .original { color:#6c7086; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; }
    .close { background:none; border:none; color:#585b70; cursor:pointer; font-size:16px; line-height:1; flex-shrink:0; }
    .close:hover { color:#cdd6f4; }
    .block { color:#cdd6f4; word-break:break-word; padding:5px 0; min-height:22px; }
    .block+.block { border-top:1px solid #2a2a3d; margin-top:2px; }
    .block.pending { color:#45475a; }
    .block.loading { color:#6c7086; font-style:italic; }
    .block.error   { color:#f38ba8; }
  `;

  // ── Popup helpers ─────────────────────────────────────────────────────────
  function createPopup(x, y, originalText) {
    removePopup();
    const host = document.createElement('div');
    Object.assign(host.style, {
      position: 'fixed', zIndex: '2147483647',
      left: `${Math.max(10, Math.min(x, window.innerWidth - 390))}px`,
      top:  `${Math.max(10, y)}px`,
      width: '370px', pointerEvents: 'none',
    });
    const shadow  = host.attachShadow({ mode: 'closed' });
    const styleEl = document.createElement('style');
    styleEl.textContent = POPUP_CSS;
    const box      = document.createElement('div'); box.className = 'box';
    const header   = document.createElement('div'); header.className = 'header';
    const origEl   = document.createElement('div'); origEl.className = 'original';
    origEl.textContent = (originalText.replace(/\s+/g,' ').trim().slice(0, 60) + (originalText.length > 60 ? '…' : ''));
    const closeBtn = document.createElement('button'); closeBtn.className = 'close';
    closeBtn.textContent = '×'; closeBtn.onclick = removePopup;
    header.append(origEl, closeBtn); box.append(header);
    shadow.append(styleEl, box);
    document.body.appendChild(host);
    popupHost = { host, box };
  }

  function addBlock(pending = false) {
    if (!popupHost) return null;
    const div = document.createElement('div');
    div.className = 'block ' + (pending ? 'pending' : 'loading');
    div.textContent = pending ? '…' : '译中…';
    popupHost.box.appendChild(div);
    return {
      start()      { div.className = 'block loading'; div.textContent = ''; },
      append(t)    { if (div.classList.contains('loading')||div.classList.contains('pending')) { div.className='block'; div.textContent=''; } div.textContent += t; },
      error(m)     { div.className='block error'; div.textContent='❌ '+m; },
      done()       { div.classList.remove('loading'); },
    };
  }

  function removePopup() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    if (popupHost)  { popupHost.host.remove(); popupHost = null; }
  }

  function getPopupPos() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      let x = r.left, y = r.bottom + 10;
      if (y + 200 > window.innerHeight) y = Math.max(10, r.top - 210);
      return { x, y };
    }
    return { x: window.innerWidth - 390, y: 70 };
  }

  // ── Translation request ────────────────────────────────────────────────────
  // Uses sendMessage (not ports) — Chrome keeps the service worker alive until
  // sendResponse fires, preventing the port-closed-before-response error.
  function translateText(text) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'translate', text }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error('请刷新页面后重试'));
          } else if (!res || res.error) {
            reject(new Error(res?.error || '翻译失败'));
          } else {
            resolve(res.text);
          }
        });
      } catch (_) {
        reject(new Error('请刷新页面后重试'));
      }
    });
  }

  async function requestChunk(text, block) {
    block.start();
    try {
      const result = await translateText(text);
      block.append(result);
      block.done();
    } catch (err) {
      block.error(err.message);
    }
  }

  async function fetchOne(text) {
    try { return await translateText(text); }
    catch { return null; }
  }

  // ── Chunk splitting for popup mode ────────────────────────────────────────
  function splitChunks(text) {
    const MAX = 8;
    let chunks = text.split(/\n{2,}/).map(s => s.trim()).filter(s => s.length >= 10);
    if (chunks.length <= 1 && text.includes('\n'))
      chunks = text.split('\n').map(s => s.trim()).filter(s => s.length >= 15);
    if (!chunks.length) return [text.trim()].filter(Boolean);
    if (chunks.length > MAX)
      chunks = [...chunks.slice(0, MAX - 1), chunks.slice(MAX - 1).join('\n\n')];
    return chunks;
  }

  // ── In-place page translation ─────────────────────────────────────────────
  function isMostlyChinese(text) {
    const cjk = (text.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
    return cjk / Math.max(text.replace(/\s/g, '').length, 1) > 0.3;
  }

  function clearPageTrans() {
    document.querySelectorAll(`[${TRANS_ATTR}]`).forEach(el => el.remove());
  }

  // Inline HTML tags — walk up past these to find block container
  const INLINE_TAGS = new Set([
    'span','a','strong','em','b','i','u','s','mark','abbr','cite','q',
    'sub','sup','time','small','big','label','del','ins','kbd','samp',
    'var','bdi','bdo','acronym','tt',
  ]);
  const SKIP_TAGS = new Set([
    'script','style','noscript','code','pre','svg','img','input',
    'textarea','button','select','option','iframe','canvas','video','audio',
  ]);

  function isSkippableText(text) {
    if (text.length < 5) return true;
    // Pure URL
    if (/^https?:\/\/\S+/.test(text)) return true;
    // Mostly digits/symbols (no real words)
    const wordChars = (text.match(/[a-zA-Z一-鿿぀-ヿ]/g) || []).length;
    if (wordChars / Math.max(text.replace(/\s/g,'').length, 1) < 0.2) return true;
    // Only numbers + punctuation
    if (/^[\d\s.,:/\-+%$#@!*()\[\]{}"'`~^&=|\\;<>?]+$/.test(text)) return true;
    return false;
  }

  // Walk text nodes → nearest block container (fast: no getComputedStyle)
  function findTargets(root = document.body) {
    const seen    = new Set();
    const results = [];
    const walker  = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;

    while ((node = walker.nextNode())) {
      if (results.length >= 60) break;
      if (node.textContent.trim().length < 5) continue;

      // Walk up past inline tags
      let el = node.parentElement;
      while (el && el !== document.body) {
        const tag = el.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag)) { el = null; break; }
        if (!INLINE_TAGS.has(tag)) break;
        el = el.parentElement;
      }
      if (!el || el === document.body || seen.has(el)) continue;
      seen.add(el);

      // Skip excluded ancestors
      if (el.closest('[aria-hidden="true"],[data-pip-trans],nav,footer,'+
                      '[role="navigation"],[role="banner"]')) continue;
      if (SKIP_TAGS.has(el.tagName.toLowerCase())) continue;

      // Viewport proximity (±600px)
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < -600 || rect.top > window.innerHeight + 600) continue;

      const text = el.innerText?.trim() || '';
      if (isMostlyChinese(text)) continue;
      if (isSkippableText(text)) continue;
      if (text.length > 600) continue;

      results.push(el);
    }
    return results;
  }

  // Concurrency-limited runner: at most `limit` requests in flight
  async function runLimited(tasks, limit) {
    let i = 0;
    async function worker() {
      while (i < tasks.length) { await tasks[i++](); }
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  }

  // GitHub repo page: only scan inside the README container
  function getSearchRoot() {
    const isGitHubRepo = /^github\.com\/[^/]+\/[^/]+\/?$/.test(location.hostname + location.pathname);
    if (isGitHubRepo) {
      const readme = document.querySelector('#readme .markdown-body, article.markdown-body');
      if (readme) return readme;
    }
    return document.body;
  }

  async function translateInPlace() {
    if (document.querySelector(`[${TRANS_ATTR}]`)) { clearPageTrans(); return; }
    if (!chrome?.runtime) { alert('PIP-Trans：请刷新页面后重试'); return; }

    const targets = findTargets(getSearchRoot());
    if (!targets.length) return;

    // Pre-insert all placeholders immediately (preserves visual order)
    const pairs = targets.map(el => {
      const overlay = document.createElement('div');
      overlay.setAttribute(TRANS_ATTR, '1');
      overlay.style.cssText =
        'display:inline-block;background:#0d0d0d;color:#39ff14;' +
        'font-size:.88em;line-height:1.6;font-family:-apple-system,"Segoe UI",sans-serif;' +
        'padding:2px 8px 3px;border-radius:4px;' +
        'box-shadow:0 0 6px #39ff1466;' +
        'margin:3px 0 6px;opacity:.5;word-break:break-word;display:block;';
      overlay.textContent = '…';
      el.parentNode?.insertBefore(overlay, el.nextSibling);
      return { el, overlay };
    });

    // Max 6 concurrent — prevents overwhelming the service worker
    await runLimited(
      pairs.map(({ el, overlay }) => async () => {
        const result = await fetchOne(el.innerText.trim());
        overlay.textContent  = result || '(翻译失败)';
        overlay.style.opacity = '1';
      }),
      6
    );
  }

  // ── Main ──────────────────────────────────────────────────────────────────
  async function translate() {
    const selected = window.getSelection()?.toString().trim();

    if (!selected) {
      // No selection → in-place page translation
      await translateInPlace();
      return;
    }

    // Has selection → popup near selection
    if (!chrome?.runtime) {
      createPopup(...Object.values(getPopupPos()), selected);
      const b = addBlock(); b.start(); b.error('请刷新页面后重试');
      closeTimer = setTimeout(removePopup, 4000);
      return;
    }

    const { x, y } = getPopupPos();
    createPopup(x, y, selected);
    const chunks = splitChunks(selected);
    const blocks  = chunks.map(() => addBlock(true));
    await Promise.all(chunks.map((c, i) => requestChunk(c, blocks[i])));
    closeTimer = setTimeout(removePopup, 15000);
  }

  // ── Listeners ─────────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.altKey && !e.metaKey &&
        (e.code === 'Period' || e.code === 'NumpadDecimal')) {
      e.preventDefault();
      translate();
      return;
    }
    if (e.key === 'Escape') {
      if (popupHost) removePopup();
      else clearPageTrans();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (popupHost && !popupHost.host.contains(e.target)) removePopup();
  });
})();
