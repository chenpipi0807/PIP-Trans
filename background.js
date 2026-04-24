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

// ── Model status → storage (for popup to read) ────────────────────────────────
let modelStatus = 'loading'; // loading | ready | error

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'model-ready') {
    modelStatus = 'ready';
    chrome.storage.local.set({ modelStatus: 'ready', modelProgress: 100 });
  } else if (msg.type === 'model-progress') {
    chrome.storage.local.set({ modelStatus: 'loading', modelProgress: msg.percent, modelFile: msg.file });
  } else if (msg.type === 'model-error') {
    modelStatus = 'error';
    chrome.storage.local.set({ modelStatus: 'error', modelError: msg.message });
  }
});

// ── Translation via port (content script → background → offscreen) ─────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'pip-trans') return;

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'translate') return;

    await ensureOffscreen();

    chrome.runtime.sendMessage(
      { type: 'offscreen-translate', text: msg.text },
      (res) => {
        if (chrome.runtime.lastError || !res) {
          port.postMessage({ type: 'error', message: '翻译失败，请稍后重试' });
          return;
        }
        if (res.error) {
          port.postMessage({ type: 'error', message: res.error });
        } else {
          port.postMessage({ type: 'chunk', content: res.text });
          port.postMessage({ type: 'done' });
        }
      }
    );
  });
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
