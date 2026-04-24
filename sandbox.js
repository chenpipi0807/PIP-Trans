// Runs inside a sandboxed iframe — Chrome gives sandbox pages relaxed CSP
// that allows WebAssembly compilation. No chrome.* API access here;
// all status updates go via postMessage to the parent offscreen document.
import { pipeline, env } from './transformers.min.js';

env.allowRemoteModels  = true;
env.allowLocalModels   = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths  = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
env.remoteHost = 'https://hf-mirror.com/';

const MODEL = 'Xenova/opus-mt-en-zh';
let translatorPromise = null;

function notify(msg) {
  parent.postMessage(msg, '*');
}

function getTranslator() {
  if (!translatorPromise) {
    translatorPromise = pipeline('translation_en_to_zh', MODEL, {
      progress_callback(info) {
        if (info.status === 'progress' || info.status === 'download') {
          notify({ type: 'model-progress', percent: Math.round(info.progress ?? 0), file: info.file ?? '' });
        } else if (info.status === 'initiate') {
          notify({ type: 'model-progress', percent: 0, file: info.file ?? '' });
        } else if (info.status === 'ready') {
          notify({ type: 'model-ready' });
        }
      },
    });
  }
  return translatorPromise;
}

// Pre-warm model on load
getTranslator()
  .then(() => notify({ type: 'model-ready' }))
  .catch(err => notify({ type: 'model-error', message: err?.message || String(err) }));

// Handle translate requests from offscreen.js
window.addEventListener('message', async (event) => {
  const msg = event.data;
  if (msg.type !== 'translate') return;
  try {
    const translator = await getTranslator();
    const result = await translator(msg.text, { max_new_tokens: 512 });
    event.source.postMessage({ type: 'translated', id: msg.id, text: result[0].translation_text }, '*');
  } catch (err) {
    event.source.postMessage({ type: 'translate-error', id: msg.id, message: err?.message || String(err) }, '*');
  }
});
