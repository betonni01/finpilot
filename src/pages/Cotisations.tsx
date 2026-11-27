import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Users, Trash2, Receipt } from 'lucide-react';
import { useData, useOptions } from '../state';
import { Badge, Button, Card, Empty, Field, Input, Modal, Money, MoneyInput, PageHeader, Select, Stat, Table, Textarea, Toggle, td, useUI, currencyOptions, cx } from '../ui/ui';
import { ExecuteForm, FREQ_LABEL } from '../ui/forms';
import { remove, save, saveCotisation } from '../db/repo';
import { nowIso, uid } from '../db/db';
import { addDays, fmtDate, today } from '../engine/date';
import { fmt, sum } from '../engine/money';
import { occurrenceDates, pendingOccurrences } from '../engine/recurrence';
import type { Cotisation, CotisPayment, Freq } from '../engine/types';

const TYPES = [{ value: 'tontine', label: 'Tontine' }, { value: 'amis', label: 'Entre amis' }, { value: 'association', label: 'Association' }, { value: 'famille', label: 'Famille' }, { value: 'evenement', label: 'Événement' }, { value: 'projet', label: 'Projet collectif' }, { value: 'autre', label: 'Autre' }];

export default function Cotisations() {
  const { s } = useData();
  const [form, setForm] = useState<Partial<Cotisation> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const list = s.cotisations.filter((c) => !c.archived);
  const cur = s.cotisations.find((c) => c.id === (sel ?? list[0]?.id));
  return (
    <div className="space-y-5">
      <PageHeader title="Cotisations et gestion collective" subtitle="Tontines, associations, cotisations familiales, contributions à un événement. Ta part apparaît automatiquement dans tes engagements."
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setForm({})}>Nouvelle cotisation</Button>} />
      {!list.length ? <Card><Empty icon={<Users size={36} />} title="Aucune cotisation" text="Crée une tontine ou une cotisation pour suivre qui a payé, les retards et le solde collectif." action={<Button variant="primary" onClick={() => setForm({})}>Créer</Button>} /></Card> : (
        <>
          <div className="flex flex-wrap gap-2">{list.map((c) => <button key={c.id} onClick={() => setSel(c.id)} className={cx('rounded-xl px-3 py-2 text-left text-sm ring-1', cur?.id === c.id ? 'bg-slate-900 text-white ring-slate-900 dark:bg-slate-700' : 'bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-800')}><div className="font-medium">{c.name}</div><div className="text-xs opacity-70">{TYPES.find((t) => t.value === c.type)?.label} · {fmt(c.amount, c.currency)} {c.freq !== 'once' ? FREQ_LABEL[c.freq].toLowerCase() : ''}</div></button>)}</div>
          {cur && <Detail c={cur} onEdit={() => setForm(cur)} />}
        </>
      )}
      <CotisForm initial={form} onClose={() => setForm(null)} />
    </div>
  );
}

function periodsOf(c: Cotisation, ref: string) {
  const end = c.endDate && c.endDate < addDays(ref, 31) ? c.endDate : addDays(ref, 0);
  const ps = c.freq === 'once' ? [c.startDate] : occurrenceDates({ freq: c.freq, interval: 1, startDate: c.startDate, endDate: c.endDate }, c.startDate, end);
  return ps.length ? ps : [c.startDate];
}

function Detail({ c, onEdit }: { c: Cotisation; onEdit: () => void }) {
  const { s, L } = useData();
  const ui = useUI();
  const [cell, setCell] = useState<{ pid: string; period: string } | null>(null);
  const [exp, setExp] = useState(false);
  const [exec, setExec] = useState(false);
  const periods = periodsOf(c, L.ref).slice(-12);
  const pays = s.cotisPayments.filter((p) => p.cotisationId === c.id);
  const expenses = s.cotisExpenses.filter((e) => e.cotisationId === c.id);
  const collected = sum(pays.map((p) => p.amount));
  const spent = sum(expenses.map((e) => e.amount));
  const expected = c.participants.length * periodsOf(c, L.ref).length * c.amount;
  const paidFor = (pid: string, period: string) => sum(pays.filter((p) => p.participantId === pid && p.period === period).map((p) => p.amount));
  const late = c.participants.map((p) => ({ p, owed: sum(periodsOf(c, L.ref).filter((d) => d < L.ref).map((d) => Math.max(0, c.amount - paidFor(p.id, d)))) })).filter((x) => x.owed > 0);
  const myRule = s.rules.find((r) => r.cotisationId === c.id && r.active);
  const myPending = myRule ? pendingOccurrences([myRule], s.occurrences, L.ref, addDays(L.ref, 31), 365, L.ref)[0] : undefined;
  const order = [...c.participants].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const beneficiary = (i: number) => (c.type === 'tontine' && order.length ? order[i % order.length] : null);
  const allPeriods = periodsOf(c, L.ref);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total collecté" value={fmt(collected, c.currency)} hint={`attendu à ce jour ${fmt(expected, c.currency)}`} />
        <Stat label="Dépenses de la caisse" value={fmt(spent, c.currency)} />
        <Stat label="Solde collectif" value={fmt(collected - spent, c.currency)} tone="brand" />
        <Stat label="Participants en retard" value={String(late.length)} tone={late.length ? 'bad' : 'good'} hint={late.length ? `${fmt(sum(late.map((l) => l.owed)), c.currency)} dus` : 'tout le monde est à jour'} />
      </div>
      <Card title={c.name} subtitle={`${c.organizer ? `Organisé par ${c.organizer} · ` : ''}${c.participants.length} participants · ${fmt(c.amount, c.currency)} ${c.freq !== 'once' ? FREQ_LABEL[c.freq].toLowerCase() : '(ponctuelle)'} · depuis le ${fmtDate(c.startDate)}`}
        action={<>{myPending && <Button size="sm" variant="soft" onClick={() => setExec(true)}>Payer ma part ({fmtDate(myPending.date, 'day')})</Button>}<Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={onEdit}>Modifier</Button></>} pad={false}>
        <div className="scroll-thin overflow-x-auto px-4 pb-4 sm:px-5">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-500"><th className="py-2 pr-3 text-left font-medium">Participant</th>{periods.map((p) => <th key={p} className="px-1.5 py-2 text-center font-medium">{c.freq === 'once' ? 'Versement' : fmtDate(p, 'day').replace(/^\S+\s/, '')}</th>)}<th className="py-2 pl-3 text-right font-medium">Total</th></tr></thead>
            <tbody>
              {order.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="whitespace-nowrap py-2 pr-3 font-medium">{p.name}{p.id === c.myParticipantId && <Badge tone="blue" className="ml-1">moi</Badge>}</td>
                  {periods.map((d) => {
                    const v = paidFor(p.id, d);
                    const st = v >= c.amount ? 'ok' : v > 0 ? 'part' : d < L.ref ? 'late' : 'todo';
                    const bIdx = allPeriods.indexOf(d);
                    const isBen = beneficiary(bIdx)?.id === p.id;
                    return <td key={d} className="px-1 py-1 text-center"><button title={isBen ? 'Bénéficiaire de ce tour' : ''} onClick={() => setCell({ pid: p.id, period: d })} className={cx('h-8 w-full min-w-12 rounded-lg text-xs font-medium', st === 'ok' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' : st === 'part' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' : st === 'late' ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800', isBen && 'ring-2 ring-violet-400')}>{st === 'ok' ? '✓' : st === 'part' ? fmt(v, c.currency, { compact: true }) : st === 'late' ? 'retard' : '—'}</button></td>;
                  })}
                  <td className="py-2 pl-3 text-right"><Money v={sum(pays.filter((x) => x.participantId === p.id).map((x) => x.amount))} cur={c.currency} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Clique sur une case pour enregistrer un versement. {c.type === 'tontine' && 'Le contour violet indique le bénéficiaire du tour.'}</p>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Dépenses de la caisse" action={<Button size="sm" icon={<Receipt size={14} />} onClick={() => setExp(true)}>Ajouter</Button>}>
          {expenses.length ? <Table head={['Date', 'Objet', 'Montant', '']}>{expenses.sort((a, b) => (a.date < b.date ? 1 : -1)).map((e) => <tr key={e.id}><td className={td + ' text-xs'}>{fmtDate(e.date)}</td><td className={td}>{e.label}</td><td className={td}><Money v={e.amount} cur={c.currency} /></td><td className={td + ' text-right'}><button className="text-slate-400 hover:text-rose-600" onClick={() => remove('cotisExpenses', e.id, 'Dépense de caisse supprimée')}><Trash2 size={14} /></button></td></tr>)}</Table> : <p className="text-sm text-slate-500">Aucune dépense.</p>}
        </Card>
        <Card title={c.type === 'tontine' ? 'Ordre des bénéficiaires' : 'Retards'}>
          {c.type === 'tontine' ? <ol className="space-y-1 text-sm">{allPeriods.slice(0, Math.max(order.length, 1)).map((d, i) => <li key={d} className="flex justify-between"><span>{i + 1}. {beneficiary(i)?.name}</span><span className="text-xs text-slate-500">{fmtDate(d, 'month')} · {fmt(c.amount * c.participants.length, c.currency)}</span></li>)}</ol>
            : late.length ? <ul className="space-y-1 text-sm">{late.map((l) => <li key={l.p.id} className="flex justify-between"><span>{l.p.name}</span><Money v={l.owed} cur={c.currency} className="text-rose-600" /></li>)}</ul> : <p className="text-sm text-slate-500">Aucun retard.</p>}
        </Card>
      </div>
      <PayCell c={c} cell={cell} onClose={() => setCell(null)} />
      <ExpenseForm c={c} open={exp} onClose={() => setExp(false)} />
      {myRule && myPending && <ExecuteForm open={exec} onClose={() => setExec(false)} rule={myRule} date={myPending.date} remaining={myPending.remaining} />}
    </div>
  );
}

function PayCell({ c, cell, onClose }: { c: Cotisation; cell: { pid: string; period: string } | null; onClose: () => void }) {
  const { s } = useData();
  const ui = useUI();
  const [amount, setAmount] = useState<number | null>(c.amount);
  const [date, setDate] = useState(today());
  useEffect(() => { if (cell) { setAmount(c.amount); setDate(today()); } }, [cell]); // eslint-disable-line
  if (!cell) return null;
  const p = c.participants.find((x) => x.id === cell.pid);
  const existing = s.cotisPayments.filter((x) => x.cotisationId === c.id && x.participantId === cell.pid && x.period === cell.period);
  return (
    <Modal open onClose={onClose} title={`${p?.name} · ${fmtDate(cell.period, 'long')}`} footer={<><Button variant="ghost" onClick={onClose}>Fermer</Button><Button variant="primary" onClick={async () => { if (!amount) return; await save('cotisPayments', { id: uid(), cotisationId: c.id, participantId: cell.pid, period: cell.period, amount, date } as CotisPayment, `Versement de ${p?.name}`); ui.toast('Versement enregistré'); onClose(); }}>Enregistrer le versement</Button></>}>
      <div className="space-y-3">
        {cell.pid === c.myParticipantId && <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">Pour ta propre part, utilise plutôt « Payer ma part » : le compte sera débité automatiquement.</p>}
        {existing.length > 0 && <ul className="space-y-1 text-sm">{existing.map((e) => <li key={e.id} className="flex items-center justify-between"><span>{fmtDate(e.date)} : {fmt(e.amount, c.currency)}</span><button className="text-slate-400 hover:text-rose-600" onClick={() => remove('cotisPayments', e.id, 'Versement supprimé')}><Trash2 size={14} /></button></li>)}</ul>}
        <div className="grid grid-cols-2 gap-3"><Field label="Montant"><MoneyInput value={amount} onChange={setAmount} currency={c.currency} /></Field><Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}

function ExpenseForm({ c, open, onClose }: { c: Cotisation; open: boolean; onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(today());
  return (
    <Modal open={open} onClose={onClose} title="Dépense de la caisse commune" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={async () => { if (!label || !amount) return; await save('cotisExpenses', { id: uid(), cotisationId: c.id, label, amount, date }, 'Dépense de caisse'); setLabel(''); setAmount(null); onClose(); }}>Enregistrer</Button></>}>
      <div className="space-y-3"><Field label="Objet"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Montant"><MoneyInput value={amount} onChange={setAmount} currency={c.currency} /></Field><Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div></div>
    </Modal>
  );
}

function CotisForm({ initial, onClose }: { initial: Partial<Cotisation> | null; onClose: () => void }) {
  const { main, s } = useData();
  const o = useOptions();
  const ui = useUI();
  const [c, setC] = useState<Partial<Cotisation>>({});
  const [names, setNames] = useState('');
  const [mine, setMine] = useState(true);
  useEffect(() => {
    if (!initial) return;
    setC({ type: 'tontine', currency: main, freq: 'monthly', startDate: today(), collective: true, archived: false, accountId: o.accounts[0]?.value, ...initial });
    setNames(initial.participants ? initial.participants.map((p) => p.name).join('\n') : 'Moi\n');
    setMine(initial.id ? !!initial.myParticipantId : true);
  }, [initial]); // eslint-disable-line
  const set = (p: Partial<Cotisation>) => setC((x) => ({ ...x, ...p }));
  const usedMonthly = useMemo(() => s.rules.find((r) => r.cotisationId === initial?.id), [s.rules, initial]);
  async function submit() {
    if (!c.name || !c.amount) return ui.toast('Nom et montant requis', 'err');
    const old = initial?.participants ?? [];
    const list = names.split('\n').map((n) => n.trim()).filter(Boolean);
    const participants = list.map((n, i) => ({ id: old.find((p) => p.name === n)?.id ?? uid(), name: n, order: i + 1 }));
    const me = mine ? (participants.find((p) => /^moi$/i.test(p.name)) ?? participants[0]) : undefined;
    const row = { id: uid(), createdAt: nowIso(), ...c, participants, myParticipantId: me?.id ?? null } as Cotisation;
    await saveCotisation(row, mine && !!c.accountId);
    ui.toast('Cotisation enregistrée'); onClose();
  }
  return (
    <Modal open={!!initial} onClose={onClose} title={initial?.id ? 'Modifier la cotisation' : 'Nouvelle cotisation'} footer={<>{initial?.id && <Button variant="ghost" className="mr-auto" onClick={async () => { await save('cotisations', { ...(initial as Cotisation), archived: true }, 'Cotisation archivée'); if (usedMonthly) await save('rules', { ...usedMonthly, active: false }, 'Engagement désactivé'); onClose(); }}>Archiver</Button>}<Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={submit}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3"><Field label="Nom"><Input value={c.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field><Field label="Type"><Select value={c.type} onChange={(e) => set({ type: e.target.value as Cotisation['type'] })} options={TYPES} /></Field></div>
        <div className="grid grid-cols-3 gap-3"><Field label="Montant par participant"><MoneyInput value={c.amount ?? null} onChange={(v) => set({ amount: v ?? 0 })} currency={c.currency ?? main} /></Field><Field label="Devise"><Select value={c.currency} onChange={(e) => set({ currency: e.target.value })} options={currencyOptions} /></Field><Field label="Fréquence"><Select value={c.freq} onChange={(e) => set({ freq: e.target.value as Freq })} options={(['once', 'weekly', 'monthly', 'quarterly', 'yearly'] as Freq[]).map((f) => ({ value: f, label: FREQ_LABEL[f] }))} /></Field></div>
        <div className="grid grid-cols-3 gap-3"><Field label={c.freq === 'once' ? 'Date limite' : 'Premier versement'}><Input type="date" value={c.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value })} /></Field><Field label="Fin"><Input type="date" value={c.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || null })} /></Field><Field label="Organisateur"><Input value={c.organizer ?? ''} onChange={(e) => set({ organizer: e.target.value })} /></Field></div>
        <Field label="Participants (un par ligne, dans l'ordre des bénéficiaires)" hint="Écris « Moi » pour ta propre participation."><Textarea rows={5} value={names} onChange={(e) => setNames(e.target.value)} /></Field>
        <div className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
          <Toggle checked={mine} onChange={setMine} label="Je participe : ajouter ma part à mes engagements" />
          {mine && <Field label="Compte débité pour ma part"><Select value={c.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value })} options={o.accounts} /></Field>}
        </div>
        <Field label="Notes"><Textarea rows={2} value={c.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
