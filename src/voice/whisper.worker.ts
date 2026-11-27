/// <reference lib="webworker" />
/**
 * Reconnaissance vocale privée : le modèle Whisper tourne dans ce worker, sur l'appareil.
 * L'audio ne quitte jamais le navigateur. Les fichiers du modèle sont servis par ton serveur
 * (dossier /models) ou, à défaut, téléchargés une fois depuis Hugging Face puis mis en cache.
 */
import { env, pipeline } from '@huggingface/transformers';

type Msg = { type: 'load'; model: string; base: string; allowRemote: boolean } | { type: 'transcribe'; id: number; audio: Float32Array };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any = null;
let loaded = '';

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      if (asr && loaded === m.model) { postMessage({ type: 'ready' }); return; }
      const ua = navigator.userAgent;
      const oldSafari = /Safari\//.test(ua) && !/Chrome|Chromium|Android/.test(ua) && !/Version\/(2[6-9]|[3-9]\d)/.test(ua);
      const suffix = oldSafari ? '' : '.asyncify';
      const ort = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
      if (ort.wasm) {
        ort.wasm.wasmPaths = { mjs: new URL(`ort/ort-wasm-simd-threaded${suffix}.mjs`, m.base).href, wasm: new URL(`ort/ort-wasm-simd-threaded${suffix}.wasm`, m.base).href };
        ort.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      }
      env.localModelPath = new URL('models/', m.base).href;
      // le modèle est-il servi par le serveur de l'application ? (sinon la page d'accueil répond à sa place)
      let local = false;
      try { const r = await fetch(new URL(`${m.model}/config.json`, env.localModelPath).href); local = r.ok && /json/.test(r.headers.get('content-type') ?? '') && !!(await r.json()); } catch { local = false; }
      env.allowLocalModels = local;
      if (!local && !m.allowRemote) throw new Error('Could not locate model on this server');
      env.allowRemoteModels = m.allowRemote;
      env.useBrowserCache = true;
      asr = await pipeline('automatic-speech-recognition', m.model, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) => postMessage({ type: 'progress', p }),
      });
      loaded = m.model;
      postMessage({ type: 'ready' });
    } else if (m.type === 'transcribe') {
      if (!asr) throw new Error('Modèle non chargé');
      const out = await asr(m.audio, { language: 'french', task: 'transcribe', chunk_length_s: 30 });
      postMessage({ type: 'result', id: m.id, text: (Array.isArray(out) ? out[0]?.text : out?.text) ?? '' });
    }
  } catch (err) {
    postMessage({ type: 'error', id: (m as { id?: number }).id, message: String((err as Error)?.message ?? err) });
  }
};
