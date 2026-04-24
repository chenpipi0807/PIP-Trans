import { pipeline, env } from './transformers.min.js';

env.allowRemoteModels  = true;
env.allowLocalModels   = false;
// WASM runtime files: point to jsDelivr so they load even when file is hosted locally
env.backends.onnx.wasm.numThreads = 2;
env.backends.onnx.wasm.wasmPaths  = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
// Use Chinese mirror — huggingface.co is often blocked in China
env.remoteHost = 'https://hf-mirror.com/';

const MODEL = 'Xenova/opus-mt-en-zh';
let translatorPromise = null;

function getTranslator() {
  if (!translatorPromise) {
    translatorPromise = pipeline('translation_en_to_zh', MODEL, {
      progress_callback(info) {
        if (info.status === 'progress' || info.status === 'download') {
          chrome.runtime.sendMessage({
            type: 'model-progress',
            percent: Math.round(info.progress ?? 0),
            file: info.file ?? '',
          }).catch(() => {});
        } else if (info.status === 'initiate') {
          chrome.runtime.sendMessage({
            type: 'model-progress',
            percent: 0,
            file: info.file ?? '',
          }).catch(() => {});
        } else if (info.status === 'ready') {
          chrome.runtime.sendMessage({ type: 'model-ready' }).catch(() => {});
        }
      },
    });
  }
  return translatorPromise;
}

// Pre-warm immediately so model is ready before first translate
getTranslator()
  .then(() => chrome.runtime.sendMessage({ type: 'model-ready' }).catch(() => {}))
  .catch(err => chrome.runtime.sendMessage({ type: 'model-error', message: err.message }).catch(() => {}));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'offscreen-translate') return;

  getTranslator()
    .then(translator => translator(msg.text, { max_new_tokens: 512 }))
    .then(result => sendResponse({ text: result[0].translation_text }))
    .catch(err => sendResponse({ error: err.message }));

  return true; // keep channel open for async response
});
