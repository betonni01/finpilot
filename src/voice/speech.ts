/** Reconnaissance vocale (navigateur ou Whisper sur l'appareil) et lecture des réponses à voix haute. */
import { db } from '../db/db';

export type Engine = 'auto' | 'browser' | 'local';
export interface VoicePrefs { id: 'voice'; enabled: boolean; engine: Engine; model: 'onnx-community/whisper-tiny' | 'onnx-community/whisper-base' | 'onnx-community/whisper-small'; allowRemoteModel: boolean; speak: boolean; rate: number; voiceURI?: string; vocalConfirm: boolean; continuous: boolean }
export const DEFAULT_VOICE: VoicePrefs = { id: 'voice', enabled: true, engine: 'local', model: 'onnx-community/whisper-base', allowRemoteModel: true, speak: true, rate: 1.05, vocalConfirm: true, continuous: false };
export async function getVoicePrefs(): Promise<VoicePrefs> { return { ...DEFAULT_VOICE, ...((await db.meta.get('voice')) as Partial<VoicePrefs> | undefined) }; }
export async function setVoicePrefs(p: Partial<VoicePrefs>) { await db.meta.put({ ...(await getVoicePrefs()), ...p }); }

declare const __SINGLE__: boolean;
// ------------------------------------------------------------------ reconnaissance du navigateur
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SR = any;
const SRClass = (): SR | null => (typeof window === 'undefined' ? null : (window as SR).SpeechRecognition || (window as SR).webkitSpeechRecognition || null);
export const browserSttSupported = () => !!SRClass();
export const localSttSupported = () => !__SINGLE__ && typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
export const micSupported = () => browserSttSupported() || localSttSupported();

export interface Listener { stop(): void; abort(): void }
export interface ListenHandlers { onPartial?: (t: string) => void; onFinal: (t: string) => void; onError: (msg: string) => void; onState?: (s: 'listening' | 'processing' | 'idle') => void; onLevel?: (v: number) => void }

const ERRORS: Record<string, string> = {
  'not-allowed': "Accès au micro refusé : autorise-le dans les réglages du navigateur.", 'service-not-allowed': "Reconnaissance vocale indisponible dans ce navigateur.",
  'no-speech': "Je n'ai rien entendu. Réessaie en parlant près du micro.", network: 'La reconnaissance du navigateur nécessite Internet. Active la reconnaissance privée sur l\'appareil pour un usage hors ligne.',
  'audio-capture': 'Aucun micro détecté.', aborted: '',
};

function listenBrowser(h: ListenHandlers): Listener {
  const C = SRClass();
  const r = new C();
  r.lang = 'fr-FR'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  let final = '', done = false;
  r.onresult = (e: SR) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else interim += t;
    }
    h.onPartial?.((final + ' ' + interim).trim());
  };
  r.onerror = (e: SR) => { done = true; const m = ERRORS[e.error] ?? `Erreur de reconnaissance (${e.error})`; if (m) h.onError(m); h.onState?.('idle'); };
  r.onend = () => { if (done) return; done = true; h.onState?.('idle'); if (final.trim()) h.onFinal(final.trim()); else h.onError(ERRORS['no-speech']); };
  r.start();
  h.onState?.('listening');
  return { stop: () => r.stop(), abort: () => { done = true; r.abort(); h.onState?.('idle'); } };
}

// ------------------------------------------------------------------ Whisper sur l'appareil
let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let readyModel = '';
let seq = 0;
const pending = new Map<number, { res: (t: string) => void; rej: (e: Error) => void }>();
type Progress = { status: string; file?: string; progress?: number; loaded?: number; total?: number };
const progressListeners = new Set<(p: Progress) => void>();
export function onModelProgress(f: (p: Progress) => void) { progressListeners.add(f); return () => progressListeners.delete(f); }

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') progressListeners.forEach((f) => f(d.p));
      if (d.type === 'result') { pending.get(d.id)?.res(d.text); pending.delete(d.id); }
      if (d.type === 'error' && d.id != null) { pending.get(d.id)?.rej(new Error(d.message)); pending.delete(d.id); }
    };
  }
  return worker;
}
/** Charge (et télécharge au premier usage) le modèle de reconnaissance privée. */
export function loadLocalModel(model: string, allowRemote: boolean): Promise<void> {
  if (ready && readyModel === model) return ready;
  readyModel = model;
  ready = new Promise<void>((res, rej) => {
    const w = getWorker();
    const h = (e: MessageEvent) => {
      if (e.data.type === 'ready') { w.removeEventListener('message', h); res(); }
      if (e.data.type === 'error' && e.data.id == null) { w.removeEventListener('message', h); ready = null; rej(new Error(explainLoadError(e.data.message))); }
    };
    w.addEventListener('message', h);
    w.postMessage({ type: 'load', model, base: document.baseURI, allowRemote });
  });
  return ready;
}
function explainLoadError(m: string) {
  if (/fetch|network|404|Could not locate/i.test(m)) return "Modèle vocal introuvable : il n'est ni sur ton serveur (dossier /models) ni téléchargeable. Vérifie la connexion ou le déploiement.";
  return `Chargement du modèle impossible : ${m}`;
}
export async function isLocalModelCached(model: string): Promise<boolean> {
  try { const keys = await (await caches.open('transformers-cache')).keys(); return keys.some((k) => k.url.includes(model.split('/')[1]) && /encoder/.test(k.url)); } catch { return false; }
}

/** Enregistre jusqu'au silence (ou 20 s), puis transcrit sur l'appareil. */
function listenLocal(h: ListenHandlers, prefs: VoicePrefs): Listener {
  let stopped = false, aborted = false;
  let stream: MediaStream | null = null; let ctx: AudioContext | null = null; let rec: MediaRecorder | null = null;
  const chunks: Blob[] = [];
  const cleanup = () => { stream?.getTracks().forEach((t) => t.stop()); ctx?.close().catch(() => {}); };
  const stop = () => { if (stopped) return; stopped = true; if (rec && rec.state !== 'inactive') rec.stop(); else cleanup(); };
  (async () => {
    try {
      const loading = loadLocalModel(prefs.model, prefs.allowRemoteModel);
      loading.catch((err) => { if (aborted) return; aborted = true; stop(); h.onState?.('idle'); h.onError((err as Error).message); });
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true } });
      ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        cleanup();
        if (aborted) return;
        h.onState?.('processing');
        try {
          const audio = await decodeTo16k(new Blob(chunks, { type: rec!.mimeType }));
          if (audio.length < 16000 * 0.4) { h.onState?.('idle'); return h.onError("Je n'ai rien entendu."); }
          await loading;
          const id = ++seq;
          const text = await new Promise<string>((res, rej) => { pending.set(id, { res, rej }); getWorker().postMessage({ type: 'transcribe', id, audio }, [audio.buffer]); });
          h.onState?.('idle');
          const t = text.trim();
          if (t) h.onFinal(t); else h.onError("Je n'ai rien compris. Réessaie.");
        } catch (err) { h.onState?.('idle'); h.onError((err as Error).message); }
      };
      rec.start(250);
      h.onState?.('listening');
      const t0 = performance.now(); let lastVoice = t0; let heard = false;
      const tick = () => {
        if (stopped) return;
        an.getFloatTimeDomainData(buf);
        let rms = 0; for (const v of buf) rms += v * v; rms = Math.sqrt(rms / buf.length);
        h.onLevel?.(Math.min(1, rms * 8));
        const now = performance.now();
        if (rms > 0.02) { lastVoice = now; heard = true; }
        if ((heard && now - lastVoice > 1400) || now - t0 > 20000 || (!heard && now - t0 > 7000)) return stop();
        requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      cleanup(); h.onState?.('idle');
      const name = (err as DOMException)?.name;
      h.onError(name === 'NotAllowedError' ? ERRORS['not-allowed'] : name === 'NotFoundError' ? ERRORS['audio-capture'] : (err as Error).message);
    }
  })();
  return { stop, abort: () => { aborted = true; stop(); h.onState?.('idle'); } };
}

async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const ab = await blob.arrayBuffer();
  const tmp = new AudioContext();
  const decoded = await tmp.decodeAudioData(ab);
  tmp.close().catch(() => {});
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const out = await off.startRendering();
  return out.getChannelData(0).slice();
}

export function resolveEngine(prefs: VoicePrefs): 'browser' | 'local' | null {
  if (prefs.engine === 'browser') return browserSttSupported() ? 'browser' : null;
  // automatique et privé : l'audio ne quitte pas l'appareil. Le navigateur n'est utilisé que si on le choisit explicitement.
  if (prefs.engine === 'local' || prefs.engine === 'auto') return localSttSupported() ? 'local' : null;
  return null;
}

export function listen(prefs: VoicePrefs, h: ListenHandlers): Listener | null {
  const e = resolveEngine(prefs);
  if (!e) { h.onError(prefs.engine === 'browser' ? "La reconnaissance du navigateur n'est pas disponible ici." : "La reconnaissance privée n'est pas disponible sur cet appareil. Tu peux choisir « Navigateur » dans les paramètres, en sachant que l'audio sort alors de l'appareil."); return null; }
  return e === 'browser' ? listenBrowser(h) : listenLocal(h, prefs);
}

// ------------------------------------------------------------------ synthèse vocale
export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export function frenchVoices(): SpeechSynthesisVoice[] {
  if (!ttsSupported()) return [];
  return speechSynthesis.getVoices().filter((v) => v.localService && v.lang.toLowerCase().startsWith('fr')).sort((a, b) => Number(/fr-fr/i.test(b.lang)) - Number(/fr-fr/i.test(a.lang)));
}
export function stopSpeaking() { if (ttsSupported()) speechSynthesis.cancel(); }
/** Texte affichable → texte à prononcer (sans mise en forme, emoji ni symboles gênants). */
export function toSpoken(lines: string[], max = 420): string {
  let t = lines.join(' ').replace(/\*\*/g, '').replace(/\s[−-]\s/g, ' moins ')
    .replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, (_, d, m) => `${Number(d)} ${['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][Number(m) - 1]}`).replace(/[•→]/g, ',').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/(\d)\s(\d{3})/g, '$1$2').replace(/(\d+),(\d{2}) €/g, (_, a, b) => (b === '00' ? `${a} euros` : `${a} euros ${b}`)).replace(/ €/g, ' euros').replace(/F CFA|FCFA/g, 'francs CFA').replace(/ %/g, ' pour cent');
  if (t.length > max) { const cut = t.slice(0, max); t = cut.slice(0, Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), 80)) + '.'; }
  return t;
}
export function speak(text: string, prefs: Pick<VoicePrefs, 'rate' | 'voiceURI'>): Promise<void> {
  return new Promise((res) => {
    if (!ttsSupported() || !text) return res();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR'; u.rate = prefs.rate;
    const v = frenchVoices().find((x) => x.voiceURI === prefs.voiceURI) ?? frenchVoices()[0];
    if (!v) return res();
    u.voice = v;
    u.onend = () => res(); u.onerror = () => res();
    speechSynthesis.speak(u);
    setTimeout(res, 15000 + text.length * 80); // sécurité si l'événement de fin ne vient pas
  });
}
