import { pipeline, env } from './transformers.min.js';

env.allowRemoteModels  = true;
env.allowLocalModels   = false;
env.backends.onnx.wasm.numThreads = 2;

const MODEL = 'Xenova/opus-mt-en-zh';
let translatorPromise = null;

function getTranslator() {
  if (!translatorPromise) {
    translatorPromise = pipeline('translation_en_to_zh', MODEL, {
      progress_callback(info) {
        if (info.status === 'progress') {
          chrome.runtime.sendMessage({
            type: 'model-progress',
            percent: Math.round(info.progress ?? 0),
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
