// ── Offscreen document ────────────────────────────────────────────────────────
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url:           chrome.runtime.getURL('offscreen.html'),
    reasons:       ['WORKERS'],
    justification: 'Transformers.js translation model (opus-mt-en-zh)',
  });
}

// Warm up model when extension starts
chrome.runtime.onStartup.addListener(ensureOffscreen);
chrome.runtime.onInstalled.addListener(ensureOffscreen);

// ── Message handler ────────────────────────────────────────────────────────────
// Handles both status messages from offscreen AND translate requests from content.
// Using sendMessage (not ports) keeps the service worker alive until sendResponse fires.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'translate') {
    ensureOffscreen()
      .then(() => {
        chrome.runtime.sendMessage(
          { type: 'offscreen-translate', text: msg.text },
          (res) => {
            if (chrome.runtime.lastError || !res) {
              sendResponse({ error: '翻译失败，请稍后重试' });
            } else if (res.error) {
              sendResponse({ error: res.error });
            } else {
              sendResponse({ text: res.text });
            }
          }
        );
      })
      .catch(err => sendResponse({ error: err.message }));
    return true; // async — keep channel open
  }
  // Status relay messages from offscreen (kept for legacy compat)
  if (msg.type === 'model-ready') {
    chrome.storage.local.set({ modelStatus: 'ready', modelProgress: 100 });
  } else if (msg.type === 'model-progress') {
    chrome.storage.local.set({ modelStatus: 'loading', modelProgress: msg.percent, modelFile: msg.file });
  } else if (msg.type === 'model-error') {
    chrome.storage.local.set({ modelStatus: 'error', modelError: msg.message });
  }
});

// ── Icon ──────────────────────────────────────────────────────────────────────
function drawIcon(size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx    = canvas.getContext('2d');
  ctx.fillStyle    = '#0d0d0d';
  ctx.fillRect(0, 0, size, size);
  ctx.font         = `bold ${Math.floor(size * 0.64)}px Arial`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor  = '#39ff14';
  ctx.shadowBlur   = size * 0.25;
  ctx.fillStyle    = '#39ff14';
  ctx.fillText('P', size / 2, size / 2 + size * 0.03);
  return ctx.getImageData(0, 0, size, size);
}
function setIcon() {
  chrome.action.setIcon({
    imageData: { 16: drawIcon(16), 48: drawIcon(48), 128: drawIcon(128) },
  });
}
setIcon();
chrome.runtime.onInstalled.addListener(setIcon);
chrome.runtime.onStartup.addListener(setIcon);
