const statusText = document.getElementById('statusText');
const barWrap    = document.getElementById('barWrap');
const bar        = document.getElementById('bar');
const fileText   = document.getElementById('fileText');

function render(data) {
  const s = data.modelStatus || 'loading';
  if (s === 'ready') {
    statusText.textContent = '✓ 模型已就绪';
    statusText.className   = 'status ready';
    barWrap.style.display  = 'none';
    fileText.textContent   = '';
  } else if (s === 'error') {
    statusText.textContent = '✗ 加载失败：' + (data.modelError || '');
    statusText.className   = 'status error';
    barWrap.style.display  = 'none';
  } else {
    const pct = data.modelProgress ?? 0;
    statusText.textContent = `下载模型中… ${pct}%`;
    statusText.className   = 'status loading';
    barWrap.style.display  = 'block';
    bar.style.width        = pct + '%';
    fileText.textContent   = data.modelFile ? `正在下载：${data.modelFile}` : '首次使用需下载约 300MB（来自 hf-mirror.com）';
  }
}

// Initial read
chrome.storage.local.get(['modelStatus', 'modelProgress', 'modelFile', 'modelError'], render);

// Live updates while popup is open
chrome.storage.onChanged.addListener((changes) => {
  chrome.storage.local.get(['modelStatus', 'modelProgress', 'modelFile', 'modelError'], render);
});
