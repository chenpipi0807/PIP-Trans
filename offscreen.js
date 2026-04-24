// Bridge between chrome.runtime (background.js) and the sandboxed ML iframe.
// This file has no transformers.js / WASM — all inference runs inside sandbox.js.

const sandbox = document.getElementById('ml-sandbox');

// Pending translate requests: id → { resolve, reject }
let nextId = 0;
const pending = new Map();

// ── Messages from sandbox → chrome.storage + pending resolvers ───────────────
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'model-ready') {
    chrome.storage.local.set({ modelStatus: 'ready', modelProgress: 100 });

  } else if (msg.type === 'model-progress') {
    chrome.storage.local.set({
      modelStatus: 'loading',
      modelProgress: msg.percent,
      modelFile: msg.file ?? '',
    });

  } else if (msg.type === 'model-error') {
    chrome.storage.local.set({ modelStatus: 'error', modelError: msg.message });

  } else if (msg.type === 'translated') {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); p.resolve(msg.text); }

  } else if (msg.type === 'translate-error') {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); p.reject(new Error(msg.message)); }
  }
});

// ── Send a translate request to sandbox, return a Promise ────────────────────
function translateViaSandbox(text) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    sandbox.contentWindow.postMessage({ type: 'translate', id, text }, '*');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('翻译超时（60s）'));
      }
    }, 60000);
  });
}

// ── chrome.runtime handler (from background.js) ───────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'offscreen-translate') return;

  translateViaSandbox(msg.text)
    .then(text => sendResponse({ text }))
    .catch(err => sendResponse({ error: err.message }));

  return true; // keep channel open for async response
});
