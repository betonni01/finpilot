import { useEffect, useState } from 'react';
import { Download, Upload, ShieldCheck, Trash2, Plus, Lock, Smartphone, Sparkles, Pencil } from 'lucide-react';
import { useData } from '../state';
import { Badge, Button, Card, Field, Input, Modal, MoneyInput, PageHeader, Select, Table, Tabs, Toggle, td, useUI, currencyOptions, download } from '../ui/ui';
import { changeMainCurrency, exportBackup, hashPin, readBackup, remove, restoreBackup, save, updateSettings, wipeAll } from '../db/repo';
import { nowIso, uid } from '../db/db';
import { loadDemo } from '../db/demo';
import { fmtDate } from '../engine/date';
import { CURRENCIES, fmt } from '../engine/money';
import type { Category } from '../engine/types';
import { SyncSettings, VaultCard, useSyncConfig } from './SyncSettings';
import { VoiceSettings } from './VoiceSettings';
import { refreshRates, RATES_API } from '../db/rates';
import { RefreshCw } from 'lucide-react';

type T = 'general' | 'voix' | 'synchro' | 'devises' | 'categories' | 'alertes' | 'securite' | 'sauvegarde';

export default function SettingsPage() {
  const [tab, setTab] = useState<T>('general');
  return (
    <div className="space-y-5">
      <PageHeader title="Paramètres" />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'general', label: 'Général' }, { value: 'synchro', label: 'Synchronisation' }, { value: 'voix', label: 'Assistant vocal' }, { value: 'devises', label: 'Devises et taux' }, { value: 'categories', label: 'Catégories' }, { value: 'alertes', label: 'Alertes et prévisions' }, { value: 'securite', label: 'Sécurité' }, { value: 'sauvegarde', label: 'Sauvegarde et données' }]} />
      {tab === 'general' && <General />}
      {tab === 'synchro' && <SyncSettings />}
      {tab === 'voix' && <VoiceSettings />}
      {tab === 'devises' && <Rates />}
      {tab === 'categories' && <Categories />}
      {tab === 'alertes' && <Alerts />}
      {tab === 'securite' && <Security />}
      {tab === 'sauvegarde' && <Backup />}
    </div>
  );
}

function General() {
  const { s, main } = useData();
  const ui = useUI();
  const st = s.settings;
  const [install, setInstall] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  useEffect(() => { const h = (e: Event) => { e.preventDefault(); setInstall(e as Event & { prompt: () => Promise<void> }); }; window.addEventListener('beforeinstallprompt', h); return () => window.removeEventListener('beforeinstallprompt', h); }, []);
  const standalone = typeof window !== 'undefined' && matchMedia('(display-mode: standalone)').matches;
  const sync = useSyncConfig();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Profil et affichage">
        <div className="space-y-3">
          <Field label="Prénom"><Input defaultValue={st.userName ?? ''} onBlur={(e) => updateSettings({ userName: e.target.value })} /></Field>
          <Field label="Devise principale" hint="Les taux sont recalculés automatiquement. Le taux de la nouvelle devise doit exister."><Select value={main} onChange={async (e) => { try { await changeMainCurrency(e.target.value); ui.toast('Devise principale modifiée'); } catch (err) { ui.toast((err as Error).message, 'err'); } }} options={currencyOptions} /></Field>
          <Field label="Thème"><Select value={st.theme} onChange={(e) => updateSettings({ theme: e.target.value as 'light' })} options={[{ value: 'system', label: 'Selon le système' }, { value: 'light', label: 'Clair' }, { value: 'dark', label: 'Sombre' }]} /></Field>
          <Field label="Langue et format"><Select value="fr" onChange={() => {}} options={[{ value: 'fr', label: 'Français · JJ/MM/AAAA · 1 234,56' }]} /></Field>
        </div>
      </Card>
      <Card title="Application">
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between"><span>Mode hors connexion</span><Badge tone="green">Actif : données locales</Badge></div>
          <div className="flex items-center justify-between"><span>Installée comme application</span>{standalone ? <Badge tone="green">Oui</Badge> : install ? <Button size="sm" variant="soft" icon={<Smartphone size={14} />} onClick={() => install.prompt()}>Installer FINPILOT</Button> : <Badge>Via le menu du navigateur</Badge>}</div>
          <p className="text-xs text-slate-500">Sur iPhone : Safari › Partager › « Sur l'écran d'accueil ». Sur Android et ordinateur : menu du navigateur › « Installer l'application ».</p>
          <div className="flex items-center justify-between"><span>Version</span><span className="text-slate-500">FINPILOT 1.0 · architecture locale d'abord</span></div>
          <div className="flex items-center justify-between"><span>Synchronisation multiappareil</span>{sync?.enabled && sync.access ? <Badge tone="green">Active ({sync.email})</Badge> : <Badge>Non configurée</Badge>}</div>
        </div>
      </Card>
    </div>
  );
}

function Rates() {
  const { s, main } = useData();
  const ui = useUI();
  const [cur, setCur] = useState('USD');
  const [val, setVal] = useState('');
  const rows = s.rates.filter((r) => r.currency !== main);
  const [busy, setBusy] = useState(false);
  async function upd(currency: string, rate: number) {
    const r = s.rates.find((x) => x.currency === currency);
    const at = nowIso();
    const history = [...(r?.history ?? []), ...(r ? [{ date: (r.updatedAt ?? at).slice(0, 10), rate: r.rate }] : [])].slice(-50);
    await save('rates', { id: currency, currency, rate, updatedAt: at, history } as never, `Taux ${currency} mis à jour`);
  }
  return (
    <Card title="Taux de change" subtitle={`Valeur d'une unité de chaque devise en ${main}. Mise à jour automatique toutes les 12 h quand l'appareil est en ligne ; les conversions passées utilisent le taux en vigueur à leur date.`}
      action={<Button size="sm" icon={<RefreshCw size={14} className={busy ? 'animate-spin' : ''} />} disabled={busy} onClick={async () => { setBusy(true); try { const r = await refreshRates(true); ui.toast(r.skipped ? `Mise à jour impossible : ${r.skipped}` : r.updated.length ? `Taux mis à jour : ${r.updated.join(', ')}` : 'Taux déjà à jour', r.skipped ? 'err' : 'ok'); } catch (e) { ui.toast((e as Error).message, 'err'); } finally { setBusy(false); } }}>Mettre à jour maintenant</Button>}>
      <Table head={['Devise', `1 unité = … ${main}`, `1 ${main} = …`, 'Mis à jour', '']}>
        {rows.map((r) => (
          <tr key={r.currency}><td className={td + ' font-medium'}>{r.currency} <span className="text-xs text-slate-500">{CURRENCIES[r.currency]?.name}</span></td>
            <td className={td}><Input className="h-8 w-36" type="number" step="any" defaultValue={+r.rate.toPrecision(8)} onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== r.rate) upd(r.currency, v).then(() => ui.toast('Taux mis à jour')); }} /></td>
            <td className={td + ' num text-xs text-slate-500'}>{(1 / r.rate).toLocaleString('fr-FR', { maximumFractionDigits: 4 })} {r.currency}</td>
            <td className={td + ' text-xs'}>{fmtDate(r.updatedAt?.slice(0, 10))}</td>
            <td className={td}>{!['XOF', 'XAF'].includes(r.currency) && <button className="text-slate-400 hover:text-rose-600" onClick={() => remove('rates', r.currency, 'Devise retirée')}><Trash2 size={14} /></button>}</td></tr>
        ))}
      </Table>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Field label="Ajouter une devise"><Select value={cur} onChange={(e) => setCur(e.target.value)} options={currencyOptions.filter((c) => c.value !== main && !rows.some((r) => r.currency === c.value))} /></Field>
        <Field label={`1 ${cur} = … ${main}`}><Input type="number" step="any" value={val} onChange={(e) => setVal(e.target.value)} placeholder="ex. 0,92" /></Field>
        <Button icon={<Plus size={15} />} onClick={async () => { const v = Number(val.replace(',', '.')); if (!(v > 0)) return ui.toast('Taux invalide', 'err'); await upd(cur, v); setVal(''); ui.toast('Devise ajoutée'); }}>Ajouter</Button>
      </div>
      <p className="mt-3 text-xs text-slate-500">Source : Frankfurter ({RATES_API.replace('https://', '').split('/')[0]}), taux de référence publiés par les banques centrales dont la BCE. Le franc CFA (XOF/XAF) garde sa parité fixe : 1 € = 655,957 F CFA. Tu peux toujours corriger un taux à la main.</p>
    </Card>
  );
}

function Categories() {
  const { s } = useData();
  const ui = useUI();
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const groups = [...new Set(s.categories.map((c) => c.group))];
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button variant="primary" icon={<Plus size={16} />} onClick={() => setEdit({ kind: 'expense', essential: false, color: '#64748b', group: 'Divers' })}>Nouvelle catégorie</Button></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <Card key={g} title={g}>
            <ul className="space-y-1.5">{s.categories.filter((c) => c.group === g).map((c) => (
              <li key={c.id} className={`flex items-center justify-between gap-2 text-sm ${c.archived ? 'opacity-50' : ''}`}>
                <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} /><span className="truncate">{c.icon} {c.name}</span>{c.essential && <Badge tone="violet">essentielle</Badge>}{c.financing && <Badge tone="blue">financement</Badge>}</span>
                <button className="text-slate-400 hover:text-slate-700" onClick={() => setEdit(c)}><Pencil size={14} /></button>
              </li>
            ))}</ul>
          </Card>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Modifier la catégorie' : 'Nouvelle catégorie'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Annuler</Button><Button variant="primary" onClick={async () => { if (!edit?.name) return ui.toast('Nom requis', 'err'); await save('categories', { id: uid(), ...edit } as Category, 'Catégorie enregistrée'); setEdit(null); }}>Enregistrer</Button></>}>
        {edit && <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3"><Field label="Icône"><Input value={edit.icon ?? ''} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} maxLength={4} /></Field><Field label="Nom" className="col-span-3"><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field></div>
          <div className="grid grid-cols-2 gap-3"><Field label="Groupe"><Input list="cat-groups" value={edit.group ?? ''} onChange={(e) => setEdit({ ...edit, group: e.target.value })} /><datalist id="cat-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></Field><Field label="Type"><Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Category['kind'] })} options={[{ value: 'expense', label: 'Dépense' }, { value: 'income', label: 'Revenu' }, { value: 'both', label: 'Les deux' }]} /></Field></div>
          <Field label="Couleur"><input type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} className="h-9 w-16 rounded" /></Field>
          <Toggle checked={!!edit.essential} onChange={(v) => setEdit({ ...edit, essential: v })} label="Dépense essentielle (fonds d'urgence)" />
          <Toggle checked={!!edit.financing} onChange={(v) => setEdit({ ...edit, financing: v })} label="Financement de projet (non compté comme recette)" />
          {edit.id && <Toggle checked={!!edit.archived} onChange={(v) => setEdit({ ...edit, archived: v })} label="Archivée (masquée dans les formulaires)" />}
        </div>}
      </Modal>
    </div>
  );
}

function Alerts() {
  const { s, L, main } = useData();
  const st = s.settings;
  const [steps, setSteps] = useState(st.budgetAlerts.join(', '));
  const vd = L.variableDaily();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Sécurité financière">
        <div className="space-y-3">
          <Field label="Seuil de sécurité" hint="Le solde disponible ne doit jamais descendre sous ce montant. Il sert au verdict des simulations et au calcul du disponible réel."><MoneyInput value={st.safetyThreshold} onChange={(v) => updateSettings({ safetyThreshold: v ?? 0 })} currency={main} /></Field>
          <Field label="Paliers d'alerte des budgets (%)"><Input value={steps} onChange={(e) => setSteps(e.target.value)} onBlur={() => updateSettings({ budgetAlerts: steps.split(/[,; ]+/).map(Number).filter((n) => n > 0 && n <= 200).sort((a, b) => a - b) })} /></Field>
          <Field label="Rappel avant échéance (jours)"><Input type="number" min={0} max={30} value={st.reminderDays} onChange={(e) => updateSettings({ reminderDays: Number(e.target.value) })} /></Field>
          <Toggle checked={st.notifications} onChange={async (v) => { if (v && 'Notification' in window) { const p = await Notification.requestPermission(); if (p !== 'granted') return; } updateSettings({ notifications: v }); }} label="Notifications des échéances à l'ouverture de l'application" />
          <p className="text-xs text-slate-500">Les rappels sont affichés par l'appareil lorsque FINPILOT est ouvert. Les notifications en arrière-plan nécessiteront le serveur de synchronisation.</p>
        </div>
      </Card>
      <Card title="Dépenses variables dans les prévisions" subtitle="Courses, sorties, achats ponctuels non planifiés">
        <div className="space-y-3">
          <Field label="Méthode d'estimation"><Select value={st.variableMode} onChange={(e) => updateSettings({ variableMode: e.target.value as 'auto' })} options={[{ value: 'auto', label: 'Automatique (historique des 90 jours, sinon budgets)' }, { value: 'manual', label: 'Montant fixe par jour' }, { value: 'off', label: 'Ne pas inclure' }]} /></Field>
          {st.variableMode === 'manual' && <Field label="Montant par jour"><MoneyInput value={st.manualDailyVariable ?? 0} onChange={(v) => updateSettings({ manualDailyVariable: v ?? 0 })} currency={main} /></Field>}
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">Estimation actuelle : <b>{fmt(vd.value, main)} par jour</b> (≈ {fmt(Math.round(vd.value * 30.44), main)} par mois) · {vd.source}</div>
        </div>
      </Card>
    </div>
  );
}

function Security() {
  const { s } = useData();
  const ui = useUI();
  const st = s.settings;
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <VaultCard />
      <Card title={<span className="flex items-center gap-2"><Lock size={16} />Code PIN</span>} subtitle="Demandé après la phrase secrète. Il ne remplace pas le chiffrement.">
        <div className="space-y-3">
          <div className="text-sm">{st.pinHash ? <Badge tone="green">Code PIN actif</Badge> : <Badge tone="amber">Aucun code PIN</Badge>}</div>
          <div className="grid grid-cols-2 gap-3"><Field label={st.pinHash ? 'Nouveau code (4 à 8 chiffres)' : 'Code (4 à 8 chiffres)'}><Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} /></Field><Field label="Confirmation"><Input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 8))} /></Field></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={async () => { if (pin.length < 4 || pin !== pin2) return ui.toast('Les codes doivent correspondre (4 chiffres minimum)', 'err'); const h = await hashPin(pin); await updateSettings({ pinHash: h.hash, pinSalt: h.salt }, 'Code PIN défini'); setPin(''); setPin2(''); ui.toast('Code PIN enregistré'); }}>{st.pinHash ? 'Changer le code' : 'Activer le code PIN'}</Button>
            {st.pinHash && <Button variant="ghost" onClick={async () => { if (await ui.confirm({ title: 'Désactiver le code PIN ?', text: "N'importe qui ayant accès à cet appareil pourra ouvrir FINPILOT.", danger: true })) await updateSettings({ pinHash: null, pinSalt: null }, 'Code PIN désactivé'); }}>Désactiver</Button>}
          </div>
          <Field label="Verrouillage automatique après inactivité"><Select value={String(st.autoLockMin)} onChange={(e) => updateSettings({ autoLockMin: Number(e.target.value) })} options={[1, 2, 5, 10, 15, 30].map((m) => ({ value: String(m), label: `${m} minute${m > 1 ? 's' : ''}` }))} /></Field>
        </div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><ShieldCheck size={16} />Protection des données</span>}>
        <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <li>• Le coffre est obligatoire. Chaque enregistrement est chiffré (AES-256-GCM) avant d'être écrit. Seul l'identifiant technique reste lisible.</li>
          <li>• La clé n'est pas enregistrée en clair. Elle n'existe en mémoire qu'après la phrase secrète, et le verrouillage l'efface.</li>
          <li>• Le code PIN est une empreinte (PBKDF2). Les mauvais essais restent comptés même si la page est rechargée. Il s'ajoute à la phrase, il ne la remplace pas.</li>
          <li>• Les jetons de synchronisation sont chiffrés avec la même clé. Verrouillé, l'appareil ne peut plus parler au serveur.</li>
          <li>• Les sauvegardes peuvent être chiffrées (AES-256-GCM). Les rappels ne transmettent ni montant ni libellé.</li>
          <li>• Chaque modification financière est historisée dans le journal.</li>
        </ul>
      </Card>
    </div>
  );
}

function Backup() {
  const { s } = useData();
  const ui = useUI();
  const [pwd, setPwd] = useState('');
  const [docs, setDocs] = useState(true);
  const [est, setEst] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [restore, setRestore] = useState<{ text: string; encrypted: boolean } | null>(null);
  const [rpwd, setRpwd] = useState('');
  useEffect(() => { (async () => { try { const e = await navigator.storage?.estimate?.(); const p = await navigator.storage?.persisted?.(); setEst({ usage: e?.usage, quota: e?.quota, persisted: p }); } catch { /* */ } })(); }, []);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Exporter une sauvegarde complète" subtitle={s.settings.lastBackupAt ? `Dernière sauvegarde : ${fmtDate(s.settings.lastBackupAt.slice(0, 10), 'long')}` : 'Aucune sauvegarde réalisée'}>
        <div className="space-y-3">
          <Field label="Mot de passe de chiffrement (recommandé)" hint="Sans ce mot de passe, la sauvegarde ne pourra pas être restaurée. Il n'est conservé nulle part."><Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" /></Field>
          <Toggle checked={docs} onChange={setDocs} label="Inclure les documents et justificatifs" />
          <Button variant="primary" icon={<Download size={16} />} onClick={async () => { const b = await exportBackup(pwd || undefined, docs); download(b, `finpilot-sauvegarde-${new Date().toISOString().slice(0, 10)}${pwd ? '-chiffree' : ''}.json`); ui.toast('Sauvegarde exportée'); }}>Exporter{pwd ? ' (chiffrée)' : ''}</Button>
        </div>
      </Card>
      <Card title="Restaurer une sauvegarde" subtitle="Remplace toutes les données actuelles de cet appareil">
        <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium ring-1 ring-slate-200 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-800"><Upload size={16} />Choisir un fichier<input type="file" accept="application/json,.json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const text = await f.text(); try { const j = JSON.parse(text); setRestore({ text, encrypted: !!j.encrypted }); } catch { ui.toast('Fichier illisible', 'err'); } }} /></label>
        {restore && <div className="mt-3 space-y-3">
          {restore.encrypted && <Field label="Mot de passe"><Input type="password" value={rpwd} onChange={(e) => setRpwd(e.target.value)} /></Field>}
          <Button variant="danger" onClick={async () => {
            try { const data = await readBackup(restore.text, rpwd || undefined); if (!(await ui.confirm({ title: 'Remplacer toutes les données ?', text: 'Les données actuelles de cet appareil seront remplacées par la sauvegarde.', danger: true, confirmLabel: 'Restaurer' }))) return; await restoreBackup(data); setRestore(null); setRpwd(''); ui.toast('Sauvegarde restaurée'); } catch (err) { ui.toast((err as Error).message, 'err'); }
          }}>Restaurer</Button>
        </div>}
      </Card>
      <Card title="Stockage">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span>Espace utilisé</span><span>{est.usage != null ? `${(est.usage / 1e6).toFixed(1)} Mo` : '—'}{est.quota ? ` sur ${(est.quota / 1e9).toFixed(1)} Go` : ''}</span></div>
          <div className="flex justify-between"><span>Stockage persistant</span>{est.persisted ? <Badge tone="green">Accordé</Badge> : <Badge tone="amber">Non garanti</Badge>}</div>
          <p className="text-xs text-slate-500">Si le stockage n'est pas persistant, le navigateur peut effacer les données en cas de manque d'espace : installe l'application et fais des sauvegardes régulières.</p>
          <div className="flex justify-between"><span>Volume</span><span>{s.txs.length} opérations · {s.rules.length} engagements · {s.accounts.length} comptes</span></div>
        </div>
      </Card>
      <Card title="Données">
        <div className="space-y-3">
          <Button icon={<Sparkles size={16} />} onClick={async () => { if (await ui.confirm({ title: "Ajouter les données d'exemple ?", text: "Des comptes, opérations, dettes, projets et objectifs fictifs seront ajoutés à tes données. Tu pourras tout effacer ensuite." })) { await loadDemo(); ui.toast("Données d'exemple ajoutées"); } }}>Charger des données d'exemple</Button>
          <div className="rounded-lg bg-rose-50 p-3 dark:bg-rose-500/10">
            <div className="text-sm font-medium text-rose-700 dark:text-rose-300">Supprimer toutes les données</div>
            <p className="mt-1 text-xs text-rose-700/80 dark:text-rose-300/80">Efface définitivement comptes, opérations, documents et paramètres de cet appareil. Exporte d'abord une sauvegarde.</p>
            <Button className="mt-2" variant="danger" icon={<Trash2 size={15} />} onClick={async () => { if (await ui.confirm({ title: 'Tout supprimer définitivement ?', text: 'Cette action est irréversible.', danger: true, typed: 'SUPPRIMER', confirmLabel: 'Tout supprimer' })) { await wipeAll(); location.reload(); } }}>Tout supprimer</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
