import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, HandCoins, CalendarPlus, FileDown, Paperclip, Archive } from 'lucide-react';
import { useData, useOptions } from '../state';
import { Badge, Button, Card, Empty, Field, Input, Modal, Money, MoneyInput, PageHeader, Progress, Select, Stat, Tabs, Table, Textarea, Toggle, td, useUI, currencyOptions, download } from '../ui/ui';
import { RuleForm } from '../ui/forms';
import { LinesChart } from '../ui/charts';
import { addDoc, createDebt, recordDebtPayment, save, convertBetween } from '../db/repo';
import { uid } from '../db/db';
import { addMonths, fmtDate, today } from '../engine/date';
import { fmt, toMajor } from '../engine/money';
import { payoffPlan } from '../engine/debts';
import { exportRows } from '../ui/exporters';
import type { Debt, Rule } from '../engine/types';

export default function Debts() {
  const { s, L, main } = useData();
  const [tab, setTab] = useState<'dette' | 'creance' | 'strategie'>('dette');
  const [form, setForm] = useState<Partial<Debt> | null>(null);
  const [pay, setPay] = useState<Debt | null>(null);
  const [rule, setRule] = useState<Partial<Rule> | null>(null);
  const [detail, setDetail] = useState<Debt | null>(null);
  const [showArch, setShowArch] = useState(false);
  const list = s.debts.filter((d) => (tab === 'strategie' ? d.direction === 'dette' : d.direction === tab) && (showArch || !d.archived));
  const late = (d: Debt) => !!d.dueDate && d.dueDate < L.ref && L.debtRemaining(d) > 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Dettes et créances" subtitle="Ce que tu dois rembourser et ce que les autres te doivent. Chaque remboursement met à jour la dette et le compte concerné."
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setForm({ direction: tab === 'creance' ? 'creance' : 'dette' })}>{tab === 'creance' ? 'Nouvelle créance' : 'Nouvelle dette'}</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Dettes restantes" value={fmt(L.totalDebts(), main)} tone={L.totalDebts() ? 'bad' : 'good'} />
        <Stat label="Créances à récupérer" value={fmt(L.totalClaims(), main)} />
        <Stat label="Solde net" value={fmt(L.totalClaims() - L.totalDebts(), main, { sign: true })} />
        <Stat label="Échéances dépassées" value={String(s.debts.filter((d) => !d.archived && late(d)).length)} tone={s.debts.some((d) => !d.archived && late(d)) ? 'bad' : 'default'} />
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'dette', label: 'Mes dettes' }, { value: 'creance', label: 'Mes créances (prêts)' }, { value: 'strategie', label: 'Stratégies de remboursement' }]} />
      {tab !== 'strategie' && (
        <>
          {!list.length ? <Card><Empty icon={<HandCoins size={36} />} title={tab === 'dette' ? 'Aucune dette' : 'Aucune créance'} text={tab === 'dette' ? 'Enregistre ce que tu dois (amis, famille, paiement fractionné, crédit).' : "Enregistre l'argent prêté à tes proches pour suivre son remboursement."} action={<Button variant="primary" onClick={() => setForm({ direction: tab })}>Ajouter</Button>} /></Card> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.sort((a, b) => a.priority - b.priority).map((d) => {
                const rem = L.debtRemaining(d), paid = L.debtPaid(d);
                const r = s.rules.find((x) => x.debtId === d.id && x.active);
                return (
                  <div key={d.id} className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800 ${d.archived ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <button className="min-w-0 text-left" onClick={() => setDetail(d)}><div className="truncate font-medium">{d.person}</div><div className="truncate text-xs text-slate-500">{d.label || (d.direction === 'dette' ? 'Dette' : 'Prêt')} · depuis le {fmtDate(d.createdAt)}</div></button>
                      <div className="flex flex-wrap justify-end gap-1">{rem <= 0 ? <Badge tone="green">Soldée</Badge> : late(d) ? <Badge tone="red">En retard</Badge> : d.dueDate ? <Badge>avant le {fmtDate(d.dueDate)}</Badge> : null}{d.rate ? <Badge tone="amber">{d.rate} %</Badge> : null}<Badge tone={d.priority === 1 ? 'red' : d.priority === 2 ? 'amber' : 'slate'}>P{d.priority}</Badge></div>
                    </div>
                    <div className="mt-3 flex items-end justify-between"><div><div className="text-xs text-slate-500">Reste</div><Money v={rem} cur={d.currency} className="text-2xl font-semibold" /></div><div className="text-right text-xs text-slate-500">sur {fmt(d.initialAmount, d.currency)}<br />remboursé {fmt(paid, d.currency)}</div></div>
                    <div className="mt-2"><Progress value={d.initialAmount ? paid / d.initialAmount : 0} tone="brand" /></div>
                    <div className="mt-2 text-xs text-slate-500">{r ? `Échéancier : ${fmt(r.amount, L.accCur(r.accountId))} ${r.freq === 'monthly' ? 'par mois' : r.freq === 'weekly' ? 'par semaine' : r.freq === 'once' ? 'le ' + fmtDate(r.startDate) : ''}` : 'Aucun échéancier'}</div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {rem > 0 && <Button size="sm" variant="soft" onClick={() => setPay(d)}>{d.direction === 'dette' ? 'Rembourser' : 'Remboursement reçu'}</Button>}
                      {rem > 0 && !r && <Button size="sm" variant="ghost" icon={<CalendarPlus size={13} />} onClick={() => setRule({ kind: d.direction === 'dette' ? 'debt_repay' : 'loan_back', debtId: d.id, label: d.direction === 'dette' ? `Remboursement ${d.person}` : `Remboursement de ${d.person}`, amount: Math.ceil(rem / 3), freq: 'monthly', startDate: today(), endDate: addMonths(today(), 2), essential: d.direction === 'dette', certainty: 'certaine' })}>Échéancier</Button>}
                      <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setForm(d)}>Modifier</Button>
                      {rem <= 0 && !d.archived && <Button size="sm" variant="ghost" icon={<Archive size={13} />} onClick={() => save('debts', { ...d, archived: true }, 'Dette archivée')}>Archiver</Button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {s.debts.some((d) => d.archived) && <Toggle checked={showArch} onChange={setShowArch} label="Afficher les éléments archivés" />}
        </>
      )}
      {tab === 'strategie' && <Strategies />}
      <DebtForm initial={form} onClose={() => setForm(null)} />
      <PayForm d={pay} onClose={() => setPay(null)} />
      <RuleForm open={!!rule} onClose={() => setRule(null)} initial={rule ?? undefined} />
      {detail && <DebtDetail d={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function DebtForm({ initial, onClose }: { initial: Partial<Debt> | null; onClose: () => void }) {
  const { main } = useData();
  const o = useOptions();
  const ui = useUI();
  const [d, setD] = useState<Partial<Debt>>({});
  const [cash, setCash] = useState(false);
  const [acc, setAcc] = useState('');
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => { if (initial) { setD({ currency: main, createdAt: today(), priority: 2, archived: false, ...initial }); setCash(false); setAcc(o.accounts[0]?.value ?? ''); setFile(null); } }, [initial]); // eslint-disable-line
  const set = (p: Partial<Debt>) => setD((x) => ({ ...x, ...p }));
  const dette = d.direction === 'dette';
  async function submit() {
    if (!d.person?.trim() || !d.initialAmount) return ui.toast('Personne et montant requis', 'err');
    const row = { id: uid(), ...d, person: d.person.trim() } as Debt;
    if (file) row.docIds = [...(row.docIds ?? []), (await addDoc(file, dette ? 'Reconnaissances de dette' : 'Preuves de prêt', { type: 'debt', id: row.id })).id];
    if (initial?.id) await save('debts', row, 'Dette modifiée');
    else await createDebt(row, cash && acc ? { accountId: acc, date: row.createdAt } : undefined);
    ui.toast('Enregistré'); onClose();
  }
  return (
    <Modal open={!!initial} onClose={onClose} title={initial?.id ? 'Modifier' : dette ? 'Nouvelle dette' : 'Nouvelle créance'} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={submit}>Enregistrer</Button></>}>
      <div className="space-y-3">
        {!initial?.id && <Tabs value={d.direction ?? 'dette'} onChange={(v) => set({ direction: v })} items={[{ value: 'dette', label: 'Je dois' }, { value: 'creance', label: 'On me doit' }]} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label={dette ? 'Créancier' : 'Personne concernée'}><Input value={d.person ?? ''} onChange={(e) => set({ person: e.target.value })} autoFocus /></Field>
          <Field label="Objet"><Input value={d.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder="ex. avance loyer" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant initial"><MoneyInput value={d.initialAmount ?? null} onChange={(v) => set({ initialAmount: v ?? 0 })} currency={d.currency ?? main} /></Field>
          <Field label="Devise"><Select value={d.currency} onChange={(e) => set({ currency: e.target.value })} options={currencyOptions} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><Input type="date" value={d.createdAt ?? ''} onChange={(e) => set({ createdAt: e.target.value })} /></Field>
          <Field label="Date limite"><Input type="date" value={d.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null })} /></Field>
          <Field label="Taux annuel (%)"><Input type="number" step="0.1" min={0} value={d.rate ?? ''} onChange={(e) => set({ rate: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
        </div>
        <Field label="Priorité"><Select value={String(d.priority)} onChange={(e) => set({ priority: Number(e.target.value) as 1 })} options={[{ value: '1', label: 'Haute' }, { value: '2', label: 'Moyenne' }, { value: '3', label: 'Basse' }]} /></Field>
        {!initial?.id && <div className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50"><Toggle checked={cash} onChange={setCash} label={dette ? "J'ai reçu cet argent sur un de mes comptes" : "J'ai prêté cet argent depuis un de mes comptes"} />{cash && <Select value={acc} onChange={(e) => setAcc(e.target.value)} options={o.accounts} />}<p className="text-xs text-slate-500">Sinon, la {dette ? 'dette' : 'créance'} est enregistrée sans mouvement sur tes comptes (ex. dette ancienne).</p></div>}
        <Field label="Commentaire"><Textarea rows={2} value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><Paperclip size={16} />{file ? file.name : 'Joindre une preuve ou reconnaissance de dette'}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        {initial?.id && <Toggle checked={!!d.archived} onChange={(v) => set({ archived: v })} label="Archivée" />}
      </div>
    </Modal>
  );
}

function PayForm({ d, onClose }: { d: Debt | null; onClose: () => void }) {
  const { L } = useData();
  const o = useOptions();
  const ui = useUI();
  const [acc, setAcc] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  useEffect(() => { if (d) { const a = o.accounts[0]?.value ?? ''; setAcc(a); setDate(today()); setNote(''); convertBetween(L.debtRemaining(d), d.currency, L.accCur(a)).then(setAmount); } }, [d]); // eslint-disable-line
  if (!d) return null;
  return (
    <Modal open onClose={onClose} title={d.direction === 'dette' ? `Rembourser ${d.person}` : `Remboursement de ${d.person}`} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={async () => { if (!amount) return; await recordDebtPayment(d, amount, acc, date, note); ui.toast('Remboursement enregistré'); onClose(); }}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">Reste dû : <b>{fmt(L.debtRemaining(d), d.currency)}</b>. Un paiement partiel est possible.</p>
        <div className="grid grid-cols-2 gap-3"><Field label="Montant"><MoneyInput value={amount} onChange={setAmount} currency={L.accCur(acc)} /></Field><Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
        <Field label={d.direction === 'dette' ? 'Compte débité' : 'Compte crédité'}><Select value={acc} onChange={(e) => setAcc(e.target.value)} options={o.accounts} /></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function DebtDetail({ d, onClose }: { d: Debt; onClose: () => void }) {
  const { s, L } = useData();
  const o = useOptions();
  const moves = s.txs.filter((t) => t.debtId === d.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const docs = d.docIds?.length ?? 0;
  const rows = () => moves.map((t) => ({ Date: t.date, Opération: t.label, Compte: o.accName(t.accountId), Montant: toMajor(t.amount, L.accCur(t.accountId)), Devise: L.accCur(t.accountId) }));
  return (
    <Modal open onClose={onClose} wide title={`Relevé : ${d.person}`} footer={<><Button icon={<FileDown size={15} />} onClick={() => download(exportRows([{ Personne: d.person, Objet: d.label ?? '', 'Montant initial': toMajor(d.initialAmount, d.currency), Remboursé: toMajor(L.debtPaid(d), d.currency), Reste: toMajor(L.debtRemaining(d), d.currency), Devise: d.currency }, ...rows().map((r) => ({ Personne: '', Objet: `${r.Date} ${r.Opération}`, 'Montant initial': '', Remboursé: r.Montant, Reste: '', Devise: r.Devise }))], 'csv'), `releve-${d.person}.csv`)}>Exporter le relevé</Button><Button onClick={() => window.print()}>Imprimer</Button></>}>
      <div className="grid grid-cols-3 gap-3 text-sm"><div>Initial<br /><b>{fmt(d.initialAmount, d.currency)}</b></div><div>Remboursé<br /><b>{fmt(L.debtPaid(d), d.currency)}</b></div><div>Reste<br /><b>{fmt(L.debtRemaining(d), d.currency)}</b></div></div>
      {d.notes && <p className="mt-3 text-sm text-slate-500">{d.notes}</p>}
      <Table className="mt-4" head={['Date', 'Opération', 'Compte', 'Montant']}>{moves.map((t) => <tr key={t.id}><td className={td}>{fmtDate(t.date)}</td><td className={td}>{t.label}{t.notes ? <div className="text-xs text-slate-500">{t.notes}</div> : null}</td><td className={td}>{o.accName(t.accountId)}</td><td className={td}><Money v={t.amount} cur={L.accCur(t.accountId)} /></td></tr>)}</Table>
      {!moves.length && <p className="py-4 text-sm text-slate-500">Aucun mouvement enregistré.</p>}
      {docs > 0 && <p className="mt-3 text-xs text-slate-500">{docs} justificatif(s) dans « Documents ».</p>}
    </Modal>
  );
}

function Strategies() {
  const { s, L, main } = useData();
  const debts = s.debts.filter((d) => d.direction === 'dette' && !d.archived && L.debtRemaining(d) > 0);
  const inputs = debts.map((d) => ({ id: d.id, name: d.person, balance: L.conv(L.debtRemaining(d), d.currency), rate: d.rate ?? 0, min: Math.round(L.activeRules().filter((r) => r.debtId === d.id).reduce((a, r) => a + L.ruleMonthly(r), 0)) }));
  const minSum = inputs.reduce((a, x) => a + x.min, 0);
  const [budget, setBudget] = useState<number | null>(Math.max(minSum, 10000));
  const [extra, setExtra] = useState<number | null>(5000);
  const b = budget ?? 0;
  const sn = useMemo(() => payoffPlan(inputs, b, 'boule_de_neige'), [inputs, b]); // eslint-disable-line
  const av = useMemo(() => payoffPlan(inputs, b, 'avalanche'), [inputs, b]); // eslint-disable-line
  const acc = useMemo(() => payoffPlan(inputs, b + (extra ?? 0), 'avalanche'), [inputs, b, extra]); // eslint-disable-line
  if (!debts.length) return <Card><Empty title="Aucune dette en cours" text="Les stratégies de remboursement apparaîtront dès que tu auras une dette." /></Card>;
  const len = Math.max(sn.timeline.length, av.timeline.length, acc.timeline.length);
  const chart = Array.from({ length: len }, (_, i) => ({ label: fmtDate(addMonths(L.ref, i), 'month'), 'Boule de neige': sn.timeline[i]?.remaining ?? 0, Avalanche: av.timeline[i]?.remaining ?? 0, Accéléré: acc.timeline[i]?.remaining ?? 0 }));
  const Res = ({ r, title, desc }: { r: typeof sn; title: string; desc: string }) => (
    <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
      <div className="font-medium">{title}</div><div className="text-xs text-slate-500">{desc}</div>
      {r.feasible ? <><div className="num mt-2 text-2xl font-semibold">{r.months} mois</div><div className="text-sm">fin : {fmtDate(addMonths(L.ref, r.months), 'month')}</div><div className="text-sm">intérêts : <b>{fmt(r.totalInterest, main)}</b></div><ol className="mt-2 list-decimal pl-4 text-xs text-slate-600 dark:text-slate-300">{r.order.map((x) => <li key={x.id}>{x.name} soldée au mois {x.month}</li>)}</ol></> : <div className="mt-2 text-sm text-rose-600">Budget insuffisant pour couvrir les intérêts.</div>}
    </div>
  );
  return (
    <div className="space-y-4">
      <Card title="Budget mensuel consacré aux dettes" subtitle={`Somme des échéanciers actuels : ${fmt(minSum, main)} par mois`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Budget mensuel"><MoneyInput value={budget} onChange={setBudget} currency={main} /></Field>
          <Field label="Effort supplémentaire (remboursement accéléré)"><MoneyInput value={extra} onChange={setExtra} currency={main} /></Field>
        </div>
      </Card>
      <div className="grid gap-3 md:grid-cols-3">
        <Res r={sn} title="Boule de neige" desc="Les plus petites dettes d'abord : des victoires rapides." />
        <Res r={av} title="Avalanche" desc="Les taux les plus élevés d'abord : le moins d'intérêts." />
        <Res r={acc} title={`Accéléré (+${fmt(extra ?? 0, main)}/mois)`} desc="Avalanche avec effort supplémentaire." />
      </div>
      <Card title="Évolution de l'endettement">
        <LinesChart data={chart} cur={main} lines={[{ key: 'Boule de neige', name: 'Boule de neige', color: '#0ea5e9' }, { key: 'Avalanche', name: 'Avalanche', color: '#8b5cf6' }, { key: 'Accéléré', name: 'Accéléré', color: '#10b981', dashed: true }]} />
        <p className="mt-2 text-sm">{av.totalInterest < sn.totalInterest ? `L'avalanche te fait économiser ${fmt(sn.totalInterest - av.totalInterest, main)} d'intérêts.` : 'Les deux méthodes ont le même coût : la boule de neige apporte des victoires plus rapides.'} {acc.feasible && av.feasible && av.months > acc.months ? `L'effort supplémentaire fait gagner ${av.months - acc.months} mois.` : ''}</p>
      </Card>
    </div>
  );
}
