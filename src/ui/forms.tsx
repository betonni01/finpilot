import { useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { useData, useOptions } from '../state';
import { Button, Field, Input, Modal, MoneyInput, Select, Textarea, Toggle, useUI, Badge } from './ui';
import { addDoc, convertBetween, executeOccurrence, newTx, save } from '../db/repo';
import { nowIso, uid } from '../db/db';
import { addDays, addMonths, fmtDate, today } from '../engine/date';
import { fmt, rateOf } from '../engine/money';
import { findDuplicate } from '../engine/insights';
import type { Freq, Rule, RuleKind, Tx, TxKind } from '../engine/types';

export const KIND_LABEL: Record<TxKind, string> = {
  expense: 'Dépense', income: 'Revenu', transfer: 'Transfert', debt_borrow: 'Emprunt reçu', debt_repay: 'Remboursement de dette',
  loan_out: 'Prêt accordé', loan_back: 'Remboursement reçu',
};
export const FREQ_LABEL: Record<Freq, string> = { once: 'Une seule fois', daily: 'Chaque jour', weekly: 'Chaque semaine', monthly: 'Chaque mois', quarterly: 'Chaque trimestre', yearly: 'Chaque année' };
export const RULE_KIND_LABEL: Record<RuleKind, string> = { income: 'Revenu', expense: 'Charge / dépense', saving: 'Épargne programmée', debt_repay: 'Remboursement de dette', loan_back: 'Remboursement attendu', transfer: 'Transfert' };
export const METHODS = ['Carte bancaire', 'Virement', 'Prélèvement', 'Espèces', 'Mobile money', 'Chèque', 'Autre'].map((m) => ({ value: m, label: m }));

export function TxForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Partial<Tx> }) {
  const { s, L, main } = useData();
  const o = useOptions();
  const ui = useUI();
  const editing = !!initial?.id;
  const [t, setT] = useState<Partial<Tx>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [recurring, setRecurring] = useState(false);
  const [freq, setFreq] = useState<Freq>('monthly');
  useEffect(() => {
    if (!open) return;
    const firstAcc = s.accounts.find((a) => !a.archived && !a.projectId)?.id ?? s.accounts[0]?.id;
    setT({ kind: 'expense', date: today(), accountId: firstAcc, label: '', ...initial });
    setFiles([]); setRecurring(false);
  }, [open]); // eslint-disable-line
  const set = (p: Partial<Tx>) => setT((x) => ({ ...x, ...p }));
  const cur = L.accCur(t.accountId);
  const toCur = L.accCur(t.toAccountId);
  const kind = (t.kind ?? 'expense') as TxKind;
  const isDebtKind = ['debt_borrow', 'debt_repay', 'loan_out', 'loan_back'].includes(kind);
  const project = s.projects.find((p) => p.id === t.projectId);
  const dup = useMemo(() => (t.amount && t.accountId && t.date ? findDuplicate(s.txs, { id: t.id ?? '', accountId: t.accountId, amount: t.amount, date: t.date, label: t.label ?? '' }) : undefined), [t.amount, t.accountId, t.date, t.label, s.txs, t.id]);
  const debtsForKind = o.debts.filter((d) => { const debt = s.debts.find((x) => x.id === d.value); return kind === 'debt_borrow' || kind === 'debt_repay' ? debt?.direction === 'dette' : debt?.direction === 'creance'; });

  const manualRate = useRef<number | null>(null);
  const pair = useRef('');
  const fxKnown = cur === toCur || (Number.isFinite(rateOf(cur, L.main, s.rates)) && Number.isFinite(rateOf(toCur, L.main, s.rates)));
  useEffect(() => {
    if (!open) { manualRate.current = null; pair.current = ''; return; }
    if (kind !== 'transfer' || editing || !t.accountId || !t.toAccountId || cur === toCur || !t.amount || !fxKnown) return;
    const p = `${t.accountId}>${t.toAccountId}`;
    if (pair.current !== p) { pair.current = p; manualRate.current = null; }
    if (manualRate.current != null) {
      const rate = manualRate.current;
      setT((x) => ({ ...x, toAmount: Math.max(0, Math.round((x.amount ?? 0) * rate)) }));
      return;
    }
    let cancel = false;
    convertBetween(t.amount, cur, toCur).then((v) => {
      if (cancel || manualRate.current != null || !(v > 0)) return;
      setT((x) => ({ ...x, toAmount: v }));
    });
    return () => { cancel = true; };
  }, [open, kind, editing, t.amount, t.accountId, t.toAccountId, cur, toCur, fxKnown]);

  async function submit() {
    if (!t.amount || t.amount <= 0) return ui.toast('Indique un montant', 'err');
    if (!t.accountId) return ui.toast('Choisis un compte', 'err');
    if (kind === 'transfer' && (!t.toAccountId || t.toAccountId === t.accountId)) return ui.toast('Choisis un compte de destination différent', 'err');
    if (kind === 'transfer' && cur !== toCur && !(t.toAmount && t.toAmount > 0)) return ui.toast(fxKnown ? 'Montant reçu invalide' : 'Taux inconnu : indique le montant reçu', 'err');
    if (isDebtKind && !t.debtId) return ui.toast('Associe la dette ou la créance concernée', 'err');
    const label = t.label?.trim() || (kind === 'transfer' ? `Transfert vers ${o.accName(t.toAccountId)}` : o.cat(t.categoryId)?.name ?? KIND_LABEL[kind]);
    const tx: Tx = { ...newTx({ kind, amount: t.amount, accountId: t.accountId }), ...t, label, kind } as Tx;
    if (kind !== 'transfer') { delete tx.toAccountId; delete tx.toAmount; }
    if (kind === 'transfer' && cur === toCur) tx.toAmount = tx.amount;
    const ids = [...(tx.docIds ?? [])];
    for (const f of files) ids.push((await addDoc(f, kind === 'income' ? 'Revenus' : 'Justificatifs', { type: 'tx', id: tx.id })).id);
    tx.docIds = ids;
    await save('txs', tx, editing ? `Opération modifiée : ${label}` : `Nouvelle opération : ${label}`);
    if (recurring && !editing && (kind === 'expense' || kind === 'income' || kind === 'transfer')) {
      const r: Rule = { id: uid(), label, kind: kind as RuleKind, amount: tx.amount, accountId: tx.accountId, toAccountId: tx.toAccountId, categoryId: tx.categoryId, freq, interval: 1, startDate: freq === 'weekly' ? addDays(tx.date, 7) : addMonths(tx.date, freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : 12), endDate: null, certainty: 'certaine', essential: !!o.cat(tx.categoryId)?.essential, active: true, payee: tx.payee, projectId: tx.projectId, createdAt: nowIso(), updatedAt: nowIso() };
      await save('rules', r, `Récurrence créée : ${label}`);
    }
    ui.toast(editing ? 'Opération mise à jour' : 'Opération enregistrée');
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Modifier l'opération" : 'Nouvelle opération'} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={submit}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-1.5">
          {(['expense', 'income', 'transfer'] as TxKind[]).map((k) => (
            <button key={k} onClick={() => set({ kind: k })} className={`rounded-lg py-2 text-sm font-medium ring-1 ${kind === k ? (k === 'expense' ? 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30' : k === 'income' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30' : 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30') : 'ring-slate-200 text-slate-600 dark:ring-slate-700 dark:text-slate-300'}`}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <Select value={['expense', 'income', 'transfer'].includes(kind) ? '' : kind} onChange={(e) => set({ kind: (e.target.value || 'expense') as TxKind })}
          options={[{ value: '', label: 'Autres types : dettes et prêts…' }, ...(['debt_borrow', 'debt_repay', 'loan_out', 'loan_back'] as TxKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant"><MoneyInput value={t.amount ?? null} onChange={(v) => set({ amount: v ?? 0 })} currency={cur} autoFocus /></Field>
          <Field label="Date"><Input type="date" value={t.date ?? ''} onChange={(e) => set({ date: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === 'transfer' ? 'Depuis le compte' : kind === 'income' || kind === 'debt_borrow' || kind === 'loan_back' ? 'Compte crédité' : 'Compte débité'}><Select value={t.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value })} options={o.accounts} /></Field>
          {kind === 'transfer'
            ? <Field label="Vers le compte"><Select value={t.toAccountId ?? ''} onChange={(e) => set({ toAccountId: e.target.value })} options={[{ value: '', label: 'Choisir…' }, ...o.accounts.filter((a) => a.value !== t.accountId)]} /></Field>
            : isDebtKind
              ? <Field label={kind.startsWith('debt') ? 'Dette concernée' : 'Créance concernée'}><Select value={t.debtId ?? ''} onChange={(e) => set({ debtId: e.target.value })} options={[{ value: '', label: 'Choisir…' }, ...debtsForKind]} /></Field>
              : <Field label="Catégorie"><Select value={t.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || undefined })} options={[{ value: '', label: 'Sans catégorie' }, ...o.catOpts(kind === 'income' ? 'income' : 'expense')]} /></Field>}
        </div>
        {kind === 'transfer' && t.toAccountId && cur !== toCur && (
          <Field label={`Montant reçu (${toCur})`} hint={fxKnown ? 'Calculé avec le taux enregistré. Si tu le corriges, ce taux est conservé quand le montant envoyé change.' : 'Taux inconnu : saisis le montant réellement reçu. Il ne sera pas remis à zéro.'}><MoneyInput value={t.toAmount ?? null} onChange={(v) => { const next = v ?? 0; if (t.amount) manualRate.current = next / t.amount; set({ toAmount: next }); }} currency={toCur} /></Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Libellé"><Input value={t.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder="ex. Courses Intermarché" /></Field>
          <Field label={kind === 'income' ? 'Source / payeur' : 'Bénéficiaire'}><Input value={t.payee ?? ''} onChange={(e) => set({ payee: e.target.value })} /></Field>
        </div>
        {kind !== 'transfer' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mode de paiement"><Select value={t.method ?? ''} onChange={(e) => set({ method: e.target.value || undefined })} options={[{ value: '', label: '—' }, ...METHODS]} /></Field>
            {kind === 'expense'
              ? <Field label="Priorité"><Select value={t.priority ?? ''} onChange={(e) => set({ priority: (e.target.value || undefined) as Tx['priority'] })} options={[{ value: '', label: '—' }, { value: 'essentielle', label: 'Essentielle' }, { value: 'utile', label: 'Utile' }, { value: 'confort', label: 'Confort' }]} /></Field>
              : kind === 'income' ? <Field label="Imposable"><div className="flex h-10 items-center"><Toggle checked={!!t.taxable} onChange={(v) => set({ taxable: v })} label={t.taxable ? 'Oui' : 'Non'} /></div></Field> : <div />}
          </div>
        )}
        {(kind === 'expense' || kind === 'income') && o.projects.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Projet associé" hint={t.projectId && L.isPersonal(t.accountId) && kind === 'expense' ? 'Payé depuis un compte personnel : compté comme apport au projet, pas comme consommation.' : undefined}><Select value={t.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || undefined, phaseId: undefined })} options={[{ value: '', label: 'Aucun' }, ...o.projects]} /></Field>
            {project?.phases.length ? <Field label="Phase"><Select value={t.phaseId ?? ''} onChange={(e) => set({ phaseId: e.target.value || undefined })} options={[{ value: '', label: '—' }, ...project.phases.map((p) => ({ value: p.id, label: p.name }))]} /></Field> : <div />}
          </div>
        )}
        <Field label="Commentaire"><Textarea value={t.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} rows={2} /></Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Paperclip size={16} /> {files.length ? `${files.length} justificatif(s)` : 'Joindre un justificatif (photo, PDF)'}
            <input type="file" multiple accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          </label>
          {!editing && ['expense', 'income', 'transfer'].includes(kind) && (
            <div className="flex items-center gap-2"><Toggle checked={recurring} onChange={setRecurring} label="Répéter" />{recurring && <Select className="h-8 w-36 text-xs" value={freq} onChange={(e) => setFreq(e.target.value as Freq)} options={(['weekly', 'monthly', 'quarterly', 'yearly'] as Freq[]).map((f) => ({ value: f, label: FREQ_LABEL[f] }))} />}</div>
          )}
        </div>
        {dup && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">Doublon possible : « {dup.label} » du {fmtDate(dup.date)} pour {fmt(dup.amount, cur)} sur ce compte.</div>}
      </div>
    </Modal>
  );
}

export function RuleForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Partial<Rule> }) {
  const { s, L } = useData();
  const o = useOptions();
  const ui = useUI();
  const [r, setR] = useState<Partial<Rule>>({});
  useEffect(() => {
    if (!open) return;
    setR({ kind: 'expense', freq: 'monthly', interval: 1, startDate: today(), certainty: 'certaine', essential: false, active: true, accountId: s.accounts.find((a) => !a.archived && !a.projectId)?.id, ...initial });
  }, [open]); // eslint-disable-line
  const set = (p: Partial<Rule>) => setR((x) => ({ ...x, ...p }));
  const cur = L.accCur(r.accountId);
  async function submit() {
    if (!r.label?.trim()) return ui.toast('Donne un nom à l\'opération', 'err');
    if (!r.amount) return ui.toast('Indique un montant', 'err');
    if (!r.accountId) return ui.toast('Choisis un compte', 'err');
    if (r.kind === 'saving' && !r.goalId) return ui.toast('Choisis l\'objectif d\'épargne', 'err');
    if ((r.kind === 'debt_repay' || r.kind === 'loan_back') && !r.debtId) return ui.toast('Associe la dette ou la créance', 'err');
    if (r.kind === 'transfer' && !r.toAccountId) return ui.toast('Choisis le compte de destination', 'err');
    const row = { id: uid(), createdAt: nowIso(), updatedAt: nowIso(), ...r } as Rule;
    await save('rules', row, initial?.id ? `Engagement modifié : ${row.label}` : `Engagement créé : ${row.label}`);
    ui.toast('Enregistré');
    onClose();
  }
  const k = r.kind as RuleKind;
  return (
    <Modal open={open} onClose={onClose} title={initial?.id ? 'Modifier l\'opération planifiée' : 'Nouvelle opération planifiée'} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={submit}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={k} onChange={(e) => set({ kind: e.target.value as RuleKind })} options={(Object.keys(RULE_KIND_LABEL) as RuleKind[]).map((x) => ({ value: x, label: RULE_KIND_LABEL[x] }))} /></Field>
          <Field label="Nom"><Input value={r.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder="ex. Loyer, Salaire" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant"><MoneyInput value={r.amount ?? null} onChange={(v) => set({ amount: v ?? 0 })} currency={cur} /></Field>
          <Field label={k === 'income' || k === 'loan_back' ? 'Compte crédité' : 'Compte débité'}><Select value={r.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value })} options={o.accounts} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Fréquence"><Select value={r.freq} onChange={(e) => set({ freq: e.target.value as Freq })} options={(Object.keys(FREQ_LABEL) as Freq[]).map((f) => ({ value: f, label: FREQ_LABEL[f] }))} /></Field>
          <Field label={r.freq === 'once' ? 'Date prévue' : 'Première échéance'}><Input type="date" value={r.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Fin (optionnelle)"><Input type="date" disabled={r.freq === 'once'} value={r.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || null })} /></Field>
        </div>
        {r.freq !== 'once' && <Field label="Tous les… (intervalle)" hint="ex. 2 = un mois sur deux"><Input type="number" min={1} value={r.interval ?? 1} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} /></Field>}
        {(k === 'expense' || k === 'income') && <Field label="Catégorie"><Select value={r.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || undefined, essential: !!o.cat(e.target.value)?.essential || r.essential })} options={[{ value: '', label: 'Sans catégorie' }, ...o.catOpts(k === 'income' ? 'income' : 'expense')]} /></Field>}
        {k === 'saving' && <Field label="Objectif d'épargne"><Select value={r.goalId ?? ''} onChange={(e) => set({ goalId: e.target.value })} options={[{ value: '', label: 'Choisir…' }, ...o.goals]} /></Field>}
        {(k === 'debt_repay' || k === 'loan_back') && <Field label={k === 'debt_repay' ? 'Dette' : 'Créance'}><Select value={r.debtId ?? ''} onChange={(e) => set({ debtId: e.target.value })} options={[{ value: '', label: 'Choisir…' }, ...o.debts.filter((d) => s.debts.find((x) => x.id === d.value)?.direction === (k === 'debt_repay' ? 'dette' : 'creance'))]} /></Field>}
        {k === 'transfer' && <Field label="Vers le compte"><Select value={r.toAccountId ?? ''} onChange={(e) => set({ toAccountId: e.target.value })} options={[{ value: '', label: 'Choisir…' }, ...o.accounts.filter((a) => a.value !== r.accountId)]} /></Field>}
        <div className="grid grid-cols-2 gap-3">
          {(k === 'income' || k === 'loan_back') ? (
            <Field label="Certitude" hint="Seuls les revenus certains entrent dans le disponible réel."><Select value={r.certainty} onChange={(e) => set({ certainty: e.target.value as Rule['certainty'] })} options={[{ value: 'certaine', label: 'Certaine (contrat, aide versée)' }, { value: 'probable', label: 'Probable' }, { value: 'incertaine', label: 'Incertaine' }]} /></Field>
          ) : <Field label="Charge essentielle"><div className="flex h-10 items-center"><Toggle checked={!!r.essential} onChange={(v) => set({ essential: v })} label={r.essential ? 'Oui (fonds d\'urgence)' : 'Non'} /></div></Field>}
          {o.projects.length > 0 && <Field label="Projet"><Select value={r.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || undefined })} options={[{ value: '', label: 'Aucun' }, ...o.projects]} /></Field>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bénéficiaire / source"><Input value={r.payee ?? ''} onChange={(e) => set({ payee: e.target.value })} /></Field>
          <Field label="Rappel (jours avant)"><Input type="number" min={0} value={r.reminderDays ?? ''} placeholder={String(s.settings.reminderDays)} onChange={(e) => set({ reminderDays: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={r.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
        {initial?.id && <Toggle checked={!!r.active} onChange={(v) => set({ active: v })} label={r.active ? 'Active' : 'Suspendue'} />}
      </div>
    </Modal>
  );
}

/** Confirmer une occurrence planifiée (payé, reçu, partiel). */
export function ExecuteForm({ open, onClose, rule, date, remaining }: { open: boolean; onClose: () => void; rule?: Rule; date?: string; remaining?: number }) {
  const { L } = useData();
  const o = useOptions();
  const ui = useUI();
  const [amount, setAmount] = useState<number | null>(null);
  const [d, setD] = useState(today());
  const [acc, setAcc] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (open && rule) { setAmount(remaining ?? rule.amount); setD(today()); setAcc(rule.accountId); setNote(''); } }, [open]); // eslint-disable-line
  if (!rule || !date) return null;
  const cur = L.accCur(acc);
  const income = rule.kind === 'income' || rule.kind === 'loan_back';
  async function go(full?: boolean) {
    if (!amount) return ui.toast('Montant requis', 'err');
    await executeOccurrence(rule!, date!, { amount, actualDate: d, accountId: acc, note, full });
    ui.toast(income ? 'Encaissement enregistré' : 'Paiement enregistré');
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title={`${income ? 'Encaisser' : 'Payer'} : ${rule.label}`} footer={<>
      <Button variant="ghost" onClick={onClose}>Annuler</Button>
      {amount != null && remaining != null && amount < remaining && <Button onClick={() => go(true)}>Solder avec ce montant</Button>}
      <Button variant="primary" onClick={() => go()}>{amount != null && remaining != null && amount < remaining ? 'Paiement partiel' : 'Confirmer'}</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">Échéance prévue le <b>{fmtDate(date, 'long')}</b>, reste <Badge>{fmt(remaining ?? rule.amount, L.accCur(rule.accountId))}</Badge>. La transaction réelle sera créée et le solde du compte mis à jour.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant effectif"><MoneyInput value={amount} onChange={setAmount} currency={cur} /></Field>
          <Field label="Date effective"><Input type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        </div>
        <Field label="Compte"><Select value={acc} onChange={(e) => setAcc(e.target.value)} options={o.accounts} /></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
