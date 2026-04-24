chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'translate') return;

  const url = 'https://api.mymemory.translated.net/get?' +
    new URLSearchParams({ q: msg.text, langpair: 'en|zh-CN' });

  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data.responseStatus === 200) {
        sendResponse({ text: data.responseData.translatedText });
      } else {
        sendResponse({ error: '翻译失败: ' + (data.responseDetails || data.responseStatus) });
      }
    })
    .catch(err => sendResponse({ error: '网络错误: ' + err.message }));

  return true; // async — keep channel open
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
