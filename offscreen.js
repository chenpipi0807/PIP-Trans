import { pipeline, env } from './transformers.min.js';

env.allowRemoteModels  = true;
env.allowLocalModels   = false;
// numThreads must be 1 — offscreen docs lack SharedArrayBuffer (no COOP/COEP headers)
env.backends.onnx.wasm.numThreads = 1;
// WASM binaries: served from jsDelivr since local relative path doesn't resolve in extension context
env.backends.onnx.wasm.wasmPaths  = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
// Use Chinese mirror — huggingface.co is blocked in China
env.remoteHost = 'https://hf-mirror.com/';

const MODEL = 'Xenova/opus-mt-en-zh';
let translatorPromise = null;

function setStatus(status, extra = {}) {
  // Write directly to storage — bypasses service worker sleep timing issues
  chrome.storage.local.set({ modelStatus: status, ...extra });
}

function getTranslator() {
  if (!translatorPromise) {
    translatorPromise = pipeline('translation_en_to_zh', MODEL, {
      progress_callback(info) {
        if (info.status === 'progress' || info.status === 'download') {
          setStatus('loading', {
            modelProgress: Math.round(info.progress ?? 0),
            modelFile: info.file ?? '',
          });
        } else if (info.status === 'initiate') {
          setStatus('loading', { modelProgress: 0, modelFile: info.file ?? '' });
        } else if (info.status === 'ready') {
          setStatus('ready', { modelProgress: 100 });
        }
      },
    });
  }
  return translatorPromise;
}

// Pre-warm immediately so model is ready before first translate
getTranslator()
  .then(() => setStatus('ready', { modelProgress: 100 }))
  .catch(err => {
    const msg = err?.message || String(err);
    setStatus('error', { modelError: msg });
    console.error('[PIP-Trans] model init failed:', msg);
  });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'offscreen-translate') return;

  getTranslator()
    .then(translator => translator(msg.text, { max_new_tokens: 512 }))
    .then(result => sendResponse({ text: result[0].translation_text }))
    .catch(err => sendResponse({ error: err.message }));

  return true; // keep channel open for async response
});
