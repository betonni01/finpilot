import { useState } from 'react';
import { Plus, Trash2, Sparkles, Upload } from 'lucide-react';
import { Button, Card, Field, Input, MoneyInput, Select, currencyOptions, useUI } from '../ui/ui';
import { useData } from '../state';
import { save, updateSettings, readBackup, restoreBackup, changeMainCurrency } from '../db/repo';
import { nowIso, uid } from '../db/db';
import { loadDemo } from '../db/demo';
import { addMonths, startOfMonth, today } from '../engine/date';
import type { AccountType } from '../engine/types';
import { ConnectForm } from './SyncSettings';
import { Cloud, UserPlus, LogIn, HardDrive, ChevronRight } from 'lucide-react';
import { activeProfile, updateProfile } from '../db/profiles';

interface AccDraft { name: string; type: AccountType; currency: string; balance: number | null }

export default function Onboarding() {
  const { s } = useData();
  const ui = useUI();
  const [step, setStep] = useState(-1);
  const [joinMode, setJoinMode] = useState(false);
  const [name, setName] = useState(s.settings.userName || (activeProfile().name !== 'Mon profil' ? activeProfile().name : ''));
  const [cur, setCur] = useState(s.settings.mainCurrency);
  const [thr, setThr] = useState<number | null>(15000);
  const [accs, setAccs] = useState<AccDraft[]>([{ name: 'Compte courant', type: 'banque', currency: 'EUR', balance: null }, { name: 'Espèces', type: 'especes', currency: 'EUR', balance: null }]);
  const [income, setIncome] = useState<{ amount: number | null; day: number; label: string }>({ amount: null, day: 28, label: 'Salaire' });
  const [rent, setRent] = useState<{ amount: number | null; day: number }>({ amount: null, day: 5 });
  const [busy, setBusy] = useState(false);

  async function finish() {
    setBusy(true);
    try {
      if (cur !== s.settings.mainCurrency) await changeMainCurrency(cur).catch(() => updateSettings({ mainCurrency: cur }));
      const at = nowIso();
      const created: string[] = [];
      for (const a of accs.filter((x) => x.name.trim())) {
        const id = uid(); created.push(id);
        await save('accounts', { id, name: a.name.trim(), type: a.type, currency: a.currency, initialBalance: a.balance ?? 0, openedAt: today(), archived: false, liquid: a.type !== 'epargne', projectId: null, createdAt: at, updatedAt: at }, 'Compte créé (démarrage)');
      }
      const main = created[0];
      const dayIn = (d: number) => { const t = today(); const base = t.slice(0, 8) + String(Math.min(d, 28)).padStart(2, '0'); return base >= t ? base : addMonths(base, 1); };
      if (main && income.amount) await save('rules', { id: uid(), label: income.label || 'Salaire', kind: 'income', amount: income.amount, accountId: main, freq: 'monthly', interval: 1, startDate: dayIn(income.day), certainty: 'certaine', essential: false, active: true, categoryId: 'salaire', createdAt: at, updatedAt: at }, 'Revenu récurrent');
      if (main && rent.amount) await save('rules', { id: uid(), label: 'Loyer', kind: 'expense', amount: rent.amount, accountId: main, freq: 'monthly', interval: 1, startDate: dayIn(rent.day), certainty: 'certaine', essential: true, active: true, categoryId: 'loyer', createdAt: at, updatedAt: at }, 'Charge récurrente');
      await updateSettings({ userName: name.trim(), safetyThreshold: thr ?? 0, onboarded: true }, 'Configuration initiale');
      if (name.trim()) updateProfile(activeProfile().id, { name: name.trim() });
      void startOfMonth;
    } finally { setBusy(false); }
  }
  async function demo() { setBusy(true); await loadDemo(); setBusy(false); ui.toast("Données d'exemple chargées"); }
  async function restore(f: File) {
    try {
      const text = await f.text();
      let pwd: string | undefined;
      if (JSON.parse(text).encrypted) pwd = prompt('Mot de passe de la sauvegarde') ?? undefined;
      await restoreBackup(await readBackup(text, pwd));
      ui.toast('Sauvegarde restaurée');
    } catch (e) { ui.toast((e as Error).message, 'err'); }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <svg viewBox="0 0 512 512" className="mx-auto h-14 w-14"><rect width="512" height="512" rx="112" fill="#0f172a" /><path d="M96 368 L208 256 L272 312 L416 160" fill="none" stroke="#34d399" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" /><circle cx="416" cy="160" r="28" fill="#34d399" /></svg>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Bienvenue dans FINPILOT</h1>
        <p className="mt-1 text-sm text-slate-500">Ton centre de pilotage financier. Tes données restent sur cet appareil.</p>
      </div>
      {step === -1 && (
        <div className="space-y-3">
          {[
            { icon: <UserPlus size={20} />, t: 'Créer mon compte', d: 'Tes données sur tous tes appareils, chiffrées de bout en bout.', go: () => { setJoinMode(false); setStep(9); } },
            { icon: <LogIn size={20} />, t: "J'ai déjà un compte", d: 'Retrouve tes données sur cet appareil.', go: () => { setJoinMode(true); setStep(9); } },
            { icon: <HardDrive size={20} />, t: 'Utiliser sans compte', d: 'Tout reste sur cet appareil. Tu pourras créer un compte plus tard.', go: () => setStep(0) },
            { icon: <Sparkles size={20} />, t: "Découvrir avec des données d'exemple", d: 'Un profil fictif pour explorer toutes les fonctions.', go: demo },
          ].map((x) => (
            <button key={x.t} onClick={x.go} disabled={busy} className="flex w-full items-center gap-4 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-slate-400 dark:bg-slate-900 dark:ring-slate-800">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{x.icon}</span>
              <span className="min-w-0 flex-1"><span className="block font-medium">{x.t}</span><span className="block text-sm text-slate-500">{x.d}</span></span>
              <ChevronRight size={18} className="text-slate-400" />
            </button>
          ))}
          <label className="flex cursor-pointer items-center justify-center gap-1.5 pt-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"><Upload size={15} />Restaurer une sauvegarde<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} /></label>
        </div>
      )}
      {step === 9 && (<div className="space-y-3"><ConnectForm join={joinMode} onDone={(r) => { if (r === 'new') setStep(0); else setTimeout(() => setStep(0), 1500); }} /><Button variant="ghost" onClick={() => setStep(-1)}>Retour</Button></div>)}
      {step === 0 && (
        <Card>
          <div className="space-y-4">
            <Field label="Ton prénom"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Aïcha" autoFocus /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Devise principale" hint="Toutes les synthèses seront converties dans cette devise."><Select value={cur} onChange={(e) => setCur(e.target.value)} options={currencyOptions} /></Field>
              <Field label="Seuil de sécurité" hint="Montant minimal à toujours garder disponible."><MoneyInput value={thr} onChange={setThr} currency={cur} /></Field>
            </div>
            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <Button variant="ghost" onClick={() => setStep(-1)}>Retour</Button>
              <Button variant="primary" onClick={() => setStep(1)}>Continuer</Button>
            </div>
          </div>
        </Card>
      )}
      {step === 1 && (
        <Card title="Tes comptes" subtitle="Banque, espèces, mobile money (MTN, Moov, Celtiis), épargne… Indique le solde actuel de chacun.">
          <div className="space-y-2">
            {accs.map((a, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <Input className="col-span-12 sm:col-span-4" value={a.name} onChange={(e) => setAccs(accs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Nom" />
                <Select className="col-span-5 sm:col-span-3" value={a.type} onChange={(e) => setAccs(accs.map((x, j) => (j === i ? { ...x, type: e.target.value as AccountType } : x)))} options={[{ value: 'banque', label: 'Banque' }, { value: 'epargne', label: 'Épargne' }, { value: 'especes', label: 'Espèces' }, { value: 'mobile', label: 'Mobile money' }, { value: 'portefeuille', label: 'Portefeuille' }]} />
                <Select className="col-span-3 sm:col-span-2" value={a.currency} onChange={(e) => setAccs(accs.map((x, j) => (j === i ? { ...x, currency: e.target.value } : x)))} options={currencyOptions.map((c) => ({ value: c.value, label: c.value }))} />
                <div className="col-span-3 sm:col-span-2"><MoneyInput value={a.balance} onChange={(v) => setAccs(accs.map((x, j) => (j === i ? { ...x, balance: v } : x)))} currency={a.currency} /></div>
                <button className="col-span-1 flex items-center justify-center text-slate-400 hover:text-rose-500" onClick={() => setAccs(accs.filter((_, j) => j !== i))} aria-label="Retirer"><Trash2 size={16} /></button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setAccs([...accs, { name: '', type: 'mobile', currency: 'XOF', balance: null }])}>Ajouter un compte</Button>
          </div>
          <div className="mt-5 flex justify-between"><Button variant="ghost" onClick={() => setStep(0)}>Retour</Button><Button variant="primary" onClick={() => setStep(2)}>Continuer</Button></div>
        </Card>
      )}
      {step === 2 && (
        <Card title="Ton revenu principal et ton loyer" subtitle="Optionnel : tu pourras ajouter tous tes revenus et charges dans « Engagements ».">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Revenu" className="col-span-3 sm:col-span-1"><Input value={income.label} onChange={(e) => setIncome({ ...income, label: e.target.value })} /></Field>
              <Field label="Montant mensuel" className="col-span-2 sm:col-span-1"><MoneyInput value={income.amount} onChange={(v) => setIncome({ ...income, amount: v })} currency={accs[0]?.currency ?? cur} /></Field>
              <Field label="Jour de versement"><Input type="number" min={1} max={31} value={income.day} onChange={(e) => setIncome({ ...income, day: Number(e.target.value) })} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-3 flex items-end pb-2 text-sm font-medium sm:col-span-1">Loyer</div>
              <Field label="Montant mensuel" className="col-span-2 sm:col-span-1"><MoneyInput value={rent.amount} onChange={(v) => setRent({ ...rent, amount: v })} currency={accs[0]?.currency ?? cur} /></Field>
              <Field label="Jour de paiement"><Input type="number" min={1} max={31} value={rent.day} onChange={(e) => setRent({ ...rent, day: Number(e.target.value) })} /></Field>
            </div>
          </div>
          <div className="mt-5 flex justify-between"><Button variant="ghost" onClick={() => setStep(1)}>Retour</Button><Button variant="primary" onClick={finish} disabled={busy}>Commencer</Button></div>
        </Card>
      )}
    </div>
  );
}
