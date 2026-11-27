import { useEffect, useState } from 'react';
import { Mic, Download, Volume2, ShieldCheck, Globe, Cpu } from 'lucide-react';
import { Badge, Button, Card, Field, Progress, Select, Toggle, useUI, cx } from '../ui/ui';
import { browserSttSupported, frenchVoices, getVoicePrefs, isLocalModelCached, loadLocalModel, localSttSupported, onModelProgress, setVoicePrefs, speak, ttsSupported, type Engine, type VoicePrefs } from '../voice/speech';
import { useVoice } from '../voice/VoiceAssistant';

const MODELS: { value: VoicePrefs['model']; label: string; hint: string }[] = [
  { value: 'onnx-community/whisper-tiny', label: 'Léger (tiny)', hint: 'environ 40 Mo, rapide, moins précis' },
  { value: 'onnx-community/whisper-base', label: 'Équilibré (base)', hint: 'environ 80 Mo, recommandé' },
  { value: 'onnx-community/whisper-small', label: 'Précis (small)', hint: 'environ 250 Mo, lent sur téléphone' },
];

export function VoiceSettings() {
  const ui = useUI();
  const { open } = useVoice();
  const [p, setP] = useState<VoicePrefs | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [cached, setCached] = useState<boolean | null>(null);
  const [dl, setDl] = useState<{ pct: number; file?: string } | null>(null);
  useEffect(() => { getVoicePrefs().then(setP); }, []);
  useEffect(() => {
    if (!ttsSupported()) return;
    const f = () => setVoices(frenchVoices());
    f(); speechSynthesis.addEventListener?.('voiceschanged', f);
    return () => speechSynthesis.removeEventListener?.('voiceschanged', f);
  }, []);
  useEffect(() => { if (p) isLocalModelCached(p.model).then(setCached); }, [p?.model]); // eslint-disable-line
  if (!p) return null;
  const set = async (x: Partial<VoicePrefs>) => { const n = { ...p, ...x }; setP(n); await setVoicePrefs(x); };
  async function prepare() {
    const files = new Map<string, number>();
    const off = onModelProgress((e) => {
      if (e.file && typeof e.progress === 'number') files.set(e.file, e.progress);
      const v = [...files.values()];
      setDl({ pct: v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0, file: e.file });
    });
    setDl({ pct: 0 });
    try { await loadLocalModel(p!.model, p!.allowRemoteModel); setCached(true); ui.toast('Modèle vocal prêt, utilisable hors connexion'); }
    catch (e) { ui.toast((e as Error).message, 'err'); }
    finally { off(); setDl(null); }
  }
  const engines: { v: Engine; icon: JSX.Element; t: string; d: string; ok: boolean }[] = [
    { v: 'auto', icon: <Mic size={18} />, t: 'Automatique', d: 'Toujours la reconnaissance privée sur l\'appareil. L\'audio ne part pas sur Internet.', ok: localSttSupported() },
    { v: 'browser', icon: <Globe size={18} />, t: 'Navigateur', d: 'Rapide et sans téléchargement. Avec Chrome, l\'audio est en général transcrit par les serveurs de Google ; nécessite souvent Internet.', ok: browserSttSupported() },
    { v: 'local', icon: <ShieldCheck size={18} />, t: 'Privée, sur l\'appareil', d: 'Modèle Whisper exécuté dans l\'application : l\'audio ne quitte jamais l\'appareil, fonctionne hors connexion après le premier téléchargement.', ok: localSttSupported() },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><Mic size={16} />Assistant vocal</span>} subtitle="Dicte tes opérations, pose tes questions, navigue à la voix. Raccourci : touche V." action={<Button size="sm" variant="primary" icon={<Mic size={14} />} onClick={() => open()}>Essayer</Button>}>
        <div className="space-y-2">
          {engines.map((e) => (
            <label key={e.v} className={cx('flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1', p.engine === e.v ? 'bg-brand-50 ring-brand-400 dark:bg-brand-500/10' : 'ring-slate-200 dark:ring-slate-700', !e.ok && 'opacity-50')}>
              <input type="radio" className="mt-1" checked={p.engine === e.v} disabled={!e.ok} onChange={() => set({ engine: e.v })} />
              <span className="mt-0.5 text-slate-500">{e.icon}</span>
              <span className="text-sm"><span className="font-medium">{e.t}</span>{!e.ok && <Badge className="ml-2">indisponible ici</Badge>}<span className="block text-xs text-slate-500">{e.d}</span></span>
            </label>
          ))}
        </div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><Cpu size={16} />Reconnaissance privée</span>} subtitle="Utilisée par défaut. L'audio reste sur l'appareil.">
        <div className="space-y-3 text-sm">
          <Field label="Modèle"><Select value={p.model} onChange={(e) => set({ model: e.target.value as VoicePrefs['model'] })} options={MODELS.map((m) => ({ value: m.value, label: `${m.label} · ${m.hint}` }))} /></Field>
          <div className="flex items-center justify-between"><span>Sur cet appareil</span>{cached ? <Badge tone="green">Téléchargé</Badge> : <Badge>Pas encore téléchargé</Badge>}</div>
          {dl && <div><Progress value={dl.pct / 100} tone="brand" /><div className="mt-1 text-xs text-slate-500">{Math.round(dl.pct)} % {dl.file ? `· ${dl.file.split('/').pop()}` : ''}</div></div>}
          <Button icon={<Download size={15} />} disabled={!!dl || !localSttSupported()} onClick={prepare}>{cached ? 'Recharger le modèle' : 'Télécharger maintenant (Wi-Fi conseillé)'}</Button>
          <Toggle checked={p.allowRemoteModel} onChange={(v) => set({ allowRemoteModel: v })} label="Si ton serveur n'a pas le modèle, le télécharger depuis Hugging Face" />
          <p className="text-xs text-slate-500">Seuls les fichiers du modèle sont téléchargés ; aucun son ni aucune donnée ne sont envoyés.</p>
        </div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><Volume2 size={16} />Réponses à voix haute</span>}>
        <div className="space-y-3 text-sm">
          <Toggle checked={p.speak} onChange={(v) => set({ speak: v })} label="Lire les réponses et les confirmations" />
          {ttsSupported() ? (
            <>
              <Field label="Voix"><Select value={p.voiceURI ?? ''} onChange={(e) => set({ voiceURI: e.target.value || undefined })} options={[{ value: '', label: 'Voix française de l\'appareil' }, ...voices.map((v) => ({ value: v.voiceURI, label: v.name }))]} /></Field>
              <Field label={`Vitesse : ${p.rate.toFixed(2).replace('.', ',')}`}><input type="range" min={0.7} max={1.5} step={0.05} value={p.rate} onChange={(e) => set({ rate: Number(e.target.value) })} className="w-full accent-emerald-500" /></Field>
              <Button size="sm" onClick={() => speak('Ton disponible réel est de 412 euros. Prochain revenu le 28.', p)}>Tester la voix</Button>
            </>
          ) : <p className="text-xs text-slate-500">La synthèse vocale n'est pas disponible dans ce navigateur.</p>}
        </div>
      </Card>
      <Card title="Comportement">
        <div className="space-y-3 text-sm">
          <Toggle checked={p.vocalConfirm} onChange={(v) => set({ vocalConfirm: v })} label="Confirmer à la voix (« oui » / « non ») avant d'enregistrer" />
          <Toggle checked={p.continuous} onChange={(v) => set({ continuous: v })} label="Rester à l'écoute après chaque enregistrement (dicter plusieurs opérations)" />
          <p className="text-xs text-slate-500">Une opération dictée n'est jamais enregistrée sans confirmation : à la voix, ou avec le bouton « Confirmer ».</p>
          <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
            <div className="mb-1 font-medium">Ce que tu peux dire</div>
            <ul className="space-y-0.5 text-slate-600 dark:text-slate-300">
              <li>« J'ai payé 12 euros 50 de courses chez Lidl en espèces »</li><li>« J'ai reçu 15 000 francs CFA sur MoMo »</li>
              <li>« J'ai remboursé 50 euros à Koffi » · « Aïcha m'a remboursé 20 euros »</li><li>« J'ai retiré 60 euros » · « Transfère 100 euros vers le livret »</li>
              <li>« Combien puis-je dépenser ? » · « Simule un ordinateur à 1 000 euros en 4 fois »</li><li>« Ouvre le calendrier »</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
