import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, ArrowLeftRight, Scale, AlertTriangle, Wallet, Trash2 } from 'lucide-react';
import { useData, useOptions } from '../state';
import { Badge, Button, Card, Empty, Field, Input, Modal, Money, MoneyInput, PageHeader, Select, Stat, Textarea, Toggle, currencyOptions, useUI } from '../ui/ui';
import { TxForm } from '../ui/forms';
import { MiniArea } from '../ui/charts';
import { deleteAccount, newTx, save } from '../db/repo';
import { nowIso, uid } from '../db/db';
import { addDays, fmtDate, today } from '../engine/date';
import { fmt } from '../engine/money';
import { txEffectOn } from '../engine/ledger';
import type { Account, AccountType, Tx } from '../engine/types';

const TYPES: { value: AccountType; label: string }[] = [
  { value: 'banque', label: 'Compte bancaire' }, { value: 'epargne', label: 'Compte épargne' }, { value: 'especes', label: 'Espèces' },
  { value: 'mobile', label: 'Mobile money (MTN, Moov, Celtiis…)' }, { value: 'portefeuille', label: 'Portefeuille' }, { value: 'pro', label: 'Compte professionnel' }, { value: 'autre', label: 'Autre' },
];
const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#eab308', '#8b5cf6', '#ec4899', '#ef4444', '#64748b', '#14b8a6', '#f97316'];

export default function Accounts() {
  const { s, L, main } = useData();
  const [form, setForm] = useState<Partial<Account> | null>(null);
  const [tr, setTr] = useState<Partial<Tx> | null>(null);
  const [rec, setRec] = useState<Account | null>(null);
  const [showArch, setShowArch] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const issues = useMemo(() => {
    const out: { acc: string; text: string }[] = [];
    for (const a of s.accounts.filter((x) => !x.archived)) {
      const b = L.balances.get(a.id) ?? 0;
      if (b < 0 && (a.type === 'especes' || a.type === 'mobile' || a.type === 'portefeuille')) out.push({ acc: a.name, text: `solde négatif (${fmt(b, a.currency)}) impossible pour ce type de compte : une opération manque ou est en double.` });
      const early = s.txs.filter((t) => (t.accountId === a.id || t.toAccountId === a.id) && t.date < a.openedAt).length;
      if (early) out.push({ acc: a.name, text: `${early} opération(s) antérieure(s) à la date d'ouverture.` });
    }
    for (const t of s.txs) if (t.kind === 'transfer' && t.toAccountId && L.accCur(t.accountId) !== L.accCur(t.toAccountId) && !t.toAmount) out.push({ acc: t.label, text: 'transfert multidevise sans montant reçu.' });
    return out;
  }, [s, L]);

  const groups = [
    { title: 'Comptes personnels disponibles', items: s.accounts.filter((a) => !a.projectId && a.liquid) },
    { title: 'Épargne', items: s.accounts.filter((a) => !a.projectId && !a.liquid) },
    { title: 'Comptes de projets', items: s.accounts.filter((a) => a.projectId) },
  ].map((g) => ({ ...g, items: g.items.filter((a) => showArch || !a.archived) }));

  const selAcc = s.accounts.find((a) => a.id === sel);
  return (
    <div className="space-y-5">
      <PageHeader title="Comptes et portefeuilles" subtitle="Banque, espèces, mobile money, épargne et comptes de projets, chacun dans sa devise"
        actions={<>
          <Button icon={<ArrowLeftRight size={16} />} onClick={() => setTr({ kind: 'transfer' })}>Transfert</Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setForm({})}>Nouveau compte</Button>
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Liquidités personnelles" value={fmt(L.liquidTotal(), main)} />
        <Stat label="Épargne (comptes)" value={fmt(L.savingsAccountsTotal(), main)} />
        <Stat label="Espèces" value={fmt(L.cashTotal(), main)} />
        <Stat label="Total personnel" value={fmt(L.personalTotal(), main)} tone="brand" />
      </div>
      {issues.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><AlertTriangle size={16} className="text-amber-500" />Incohérences détectées</span>}>
          <ul className="space-y-1 text-sm">{issues.map((i, k) => <li key={k}><b>{i.acc}</b> : {i.text}</li>)}</ul>
        </Card>
      )}
      {!s.accounts.length && <Card><Empty icon={<Wallet size={36} />} title="Aucun compte" text="Crée tes comptes avec leur solde actuel : c'est la base de tous les calculs." action={<Button variant="primary" onClick={() => setForm({})}>Créer un compte</Button>} /></Card>}
      {groups.map((g) => g.items.length > 0 && (
        <div key={g.title}>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">{g.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((a) => {
              const b = L.balances.get(a.id) ?? 0;
              const hist = accHistory(a, s.txs, b, 60);
              return (
                <div key={a.id} className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800 ${a.archived ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <button className="flex min-w-0 items-center gap-2.5 text-left" onClick={() => setSel(a.id)}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: a.color ?? '#64748b' }}><Wallet size={16} /></span>
                      <span className="min-w-0"><span className="block truncate font-medium">{a.name}</span><span className="block truncate text-xs text-slate-500">{a.institution || TYPES.find((t) => t.value === a.type)?.label} · {a.currency}</span></span>
                    </button>
                    <div className="flex gap-1">{a.archived && <Badge>Archivé</Badge>}{a.projectId && <Badge tone="violet">{s.projects.find((p) => p.id === a.projectId)?.name}</Badge>}</div>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div><Money v={b} cur={a.currency} className={`text-2xl font-semibold ${b < 0 ? 'text-rose-600' : ''}`} />{a.currency !== main && <div className="text-xs text-slate-500">≈ {fmt(L.balanceMain(a.id), main)}</div>}</div>
                    <div className="h-10 w-24"><MiniArea data={hist} color={a.color ?? '#64748b'} height={40} /></div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setForm(a)}>Modifier</Button>
                    <Button size="sm" variant="ghost" icon={<ArrowLeftRight size={13} />} onClick={() => setTr({ kind: 'transfer', accountId: a.id })}>Transférer</Button>
                    <Button size="sm" variant="ghost" icon={<Scale size={13} />} onClick={() => setRec(a)}>Rapprocher</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {s.accounts.some((a) => a.archived) && <Toggle checked={showArch} onChange={setShowArch} label="Afficher les comptes archivés" />}
      {selAcc && <AccountHistory a={selAcc} onClose={() => setSel(null)} />}
      <AccountForm initial={form} onClose={() => setForm(null)} />
      <TxForm open={!!tr} onClose={() => setTr(null)} initial={tr ?? undefined} />
      <Reconcile a={rec} onClose={() => setRec(null)} />
      <p className="text-xs text-slate-500">Un transfert entre deux comptes personnels modifie les deux soldes sans créer de dépense. Les comptes de projets sont exclus de tes finances personnelles.</p>
    </div>
  );
}

function accHistory(a: Account, txs: Tx[], current: number, days: number) {
  const ref = today();
  const deltas = new Map<string, number>();
  for (const t of txs) { const e = txEffectOn(t, a.id); if (e) deltas.set(t.date, (deltas.get(t.date) ?? 0) + e); }
  let v = current;
  const out: { v: number }[] = [];
  for (let i = 0; i < days; i++) { const d = addDays(ref, -i); out.push({ v }); v -= deltas.get(d) ?? 0; }
  return out.reverse();
}

function AccountForm({ initial, onClose }: { initial: Partial<Account> | null; onClose: () => void }) {
  const { s, main } = useData();
  const ui = useUI();
  const [a, setA] = useState<Partial<Account>>({});
  const open = !!initial;
  useEffect(() => { if (initial) setA({ type: 'banque', currency: main, initialBalance: 0, openedAt: today(), liquid: true, archived: false, color: COLORS[s.accounts.length % COLORS.length], ...initial }); }, [initial]); // eslint-disable-line
  const set = (p: Partial<Account>) => setA((x) => ({ ...x, ...p }));
  async function submit() {
    if (!a.name?.trim()) return ui.toast('Nom requis', 'err');
    const at = nowIso();
    await save('accounts', { id: uid(), createdAt: at, updatedAt: at, ...a, name: a.name.trim() } as Account, initial?.id ? `Compte modifié : ${a.name}` : `Compte créé : ${a.name}`);
    ui.toast('Compte enregistré'); onClose();
  }
  async function remove() {
    const acc = a as Account;
    if (!(await ui.confirm({ title: 'Supprimer ce compte ?', text: 'S\'il contient des opérations, il sera archivé (ses données restent dans l\'historique).', danger: true }))) return;
    const r = await deleteAccount(acc); ui.toast(r === 'archived' ? 'Compte archivé' : 'Compte supprimé'); onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title={initial?.id ? 'Modifier le compte' : 'Nouveau compte'} footer={<>
      {initial?.id && <Button variant="ghost" className="mr-auto text-rose-600" icon={<Trash2 size={15} />} onClick={remove}>Supprimer</Button>}
      <Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={submit}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nom du compte"><Input value={a.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus placeholder="ex. Compte courant, Moov Money" /></Field>
          <Field label="Établissement"><Input value={a.institution ?? ''} onChange={(e) => set({ institution: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={a.type} onChange={(e) => set({ type: e.target.value as AccountType, liquid: e.target.value !== 'epargne' })} options={TYPES} /></Field>
          <Field label="Devise"><Select value={a.currency} onChange={(e) => set({ currency: e.target.value })} options={currencyOptions} disabled={!!initial?.id && s.txs.some((t) => t.accountId === initial.id)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Solde initial" hint="Solde à la date d'ouverture dans FINPILOT."><MoneyInput value={a.initialBalance ?? 0} onChange={(v) => set({ initialBalance: v ?? 0 })} currency={a.currency ?? main} allowNegative /></Field>
          <Field label="Date d'ouverture"><Input type="date" value={a.openedAt ?? ''} onChange={(e) => set({ openedAt: e.target.value })} /></Field>
        </div>
        <Field label="Rattachement"><Select value={a.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || null })} options={[{ value: '', label: 'Finances personnelles' }, ...s.projects.map((p) => ({ value: p.id, label: `Projet : ${p.name}` }))]} /></Field>
        <div className="flex flex-wrap items-center gap-5">
          <Toggle checked={!!a.liquid} onChange={(v) => set({ liquid: v })} label="Argent mobilisable au quotidien" />
          {initial?.id && <Toggle checked={!!a.archived} onChange={(v) => set({ archived: v })} label="Archivé" />}
        </div>
        <Field label="Couleur"><div className="flex flex-wrap gap-2">{COLORS.map((c) => <button key={c} onClick={() => set({ color: c })} className={`h-7 w-7 rounded-full ring-offset-2 dark:ring-offset-slate-900 ${a.color === c ? 'ring-2 ring-slate-900 dark:ring-white' : ''}`} style={{ background: c }} />)}</div></Field>
        <Field label="Notes"><Textarea rows={2} value={a.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Reconcile({ a, onClose }: { a: Account | null; onClose: () => void }) {
  const { L } = useData();
  const ui = useUI();
  const [real, setReal] = useState<number | null>(null);
  const [d, setD] = useState(today());
  if (!a) return null;
  const cur = L.balances.get(a.id) ?? 0;
  const gap = real == null ? 0 : real - cur;
  async function adjust() {
    if (real == null || !gap) return onClose();
    await save('txs', newTx({ kind: gap > 0 ? 'income' : 'expense', amount: Math.abs(gap), accountId: a!.id, date: d, label: 'Ajustement de rapprochement', categoryId: 'divers', notes: `Solde constaté ${fmt(real, a!.currency)} contre ${fmt(cur, a!.currency)} calculé` }), 'Rapprochement bancaire');
    ui.toast('Écart corrigé'); setReal(null); onClose();
  }
  return (
    <Modal open onClose={onClose} title={`Rapprochement : ${a.name}`} footer={<><Button variant="ghost" onClick={onClose}>Fermer</Button><Button variant="primary" disabled={!gap} onClick={adjust}>Enregistrer l'ajustement</Button></>}>
      <div className="space-y-3 text-sm">
        <p>Compare le solde calculé par FINPILOT au solde réel affiché par ta banque ou ton application. Si un écart subsiste après vérification, enregistre un ajustement.</p>
        <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800"><span>Solde calculé</span><Money v={cur} cur={a.currency} className="font-semibold" /></div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Solde réel constaté"><MoneyInput value={real} onChange={setReal} currency={a.currency} allowNegative /></Field>
          <Field label="Date"><Input type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        </div>
        {real != null && <div className={`rounded-lg px-3 py-2 ${gap === 0 ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'}`}>{gap === 0 ? 'Les soldes concordent.' : <>Écart : <b>{fmt(gap, a.currency, { sign: true })}</b>. Vérifie d'abord les opérations oubliées ou en double.</>}</div>}
      </div>
    </Modal>
  );
}

function AccountHistory({ a, onClose }: { a: Account; onClose: () => void }) {
  const { s, L } = useData();
  const o = useOptions();
  const txs = s.txs.filter((t) => t.accountId === a.id || t.toAccountId === a.id).sort((x, y) => (x.date < y.date ? 1 : -1));
  let run = L.balances.get(a.id) ?? 0;
  const rows = txs.slice(0, 150).map((t) => { const e = txEffectOn(t, a.id); const r = { t, e, bal: run }; run -= e; return r; });
  return (
    <Modal open onClose={onClose} wide title={`Historique : ${a.name}`}>
      <div className="mb-3 flex flex-wrap gap-4 text-sm"><span>Solde actuel : <Money v={L.balances.get(a.id) ?? 0} cur={a.currency} className="font-semibold" /></span><span>Solde initial : <Money v={a.initialBalance} cur={a.currency} /> au {fmtDate(a.openedAt)}</span><span>{txs.length} opérations</span></div>
      <div className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {rows.map(({ t, e, bal }) => (
          <div key={t.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0"><div className="truncate font-medium">{t.label}</div><div className="text-xs text-slate-500">{fmtDate(t.date)} · {t.kind === 'transfer' ? (t.accountId === a.id ? `vers ${o.accName(t.toAccountId)}` : `depuis ${o.accName(t.accountId)}`) : o.cat(t.categoryId)?.name ?? ''}</div></div>
            <div className="text-right"><Money v={e} cur={a.currency} colored sign className="font-medium" /><div className="text-[11px] text-slate-500">solde {fmt(bal, a.currency)}</div></div>
          </div>
        ))}
        {!rows.length && <p className="py-6 text-center text-slate-500">Aucune opération.</p>}
      </div>
    </Modal>
  );
}
