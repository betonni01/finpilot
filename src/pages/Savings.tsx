import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, ArrowDownCircle, ArrowUpCircle, CalendarPlus, ShieldCheck, PiggyBank } from 'lucide-react';
import { useData, useOptions } from '../state';
import { Badge, Button, Card, Empty, Field, Input, Modal, Money, MoneyInput, PageHeader, Progress, Select, Stat, Table, Toggle, td, useUI, currencyOptions } from '../ui/ui';
import { RuleForm } from '../ui/forms';
import { BarsChart, LinesChart } from '../ui/charts';
import { goalMovement, save } from '../db/repo';
import { nowIso, uid } from '../db/db';
import { addDays, addMonths, fmtDate, monthsBetween, today, startOfMonth, monthLabel } from '../engine/date';
import { fmt, sum } from '../engine/money';
import { monthsToGoal, requiredMonthly } from '../engine/debts';
import type { Goal, Rule } from '../engine/types';

export default function Savings() {
  const { s, L, main } = useData();
  const ui = useUI();
  const [form, setForm] = useState<Partial<Goal> | null>(null);
  const [move, setMove] = useState<{ g: Goal; dir: 1 | -1 } | null>(null);
  const [rule, setRule] = useState<Partial<Rule> | null>(null);
  const goals = s.goals.filter((g) => !g.archived).sort((a, b) => Number(b.isEmergency) - Number(a.isEmergency) || a.priority - b.priority);
  const ess = L.essentialMonthly();
  const ef = goals.find((g) => g.isEmergency);
  const efSaved = ef ? L.conv(L.goalSaved(ef), ef.currency) : 0;
  const cover = ess.total ? efSaved / ess.total : 0;

  const history = useMemo(() => {
    const out: Record<string, unknown>[] = [];
    for (let i = 11; i >= 0; i--) {
      const end = addDays(startOfMonth(addMonths(startOfMonth(L.ref), -i + 1)), -1);
      out.push({ label: monthLabel(end.slice(0, 7)).slice(0, 4) + '.', Épargne: sum(s.goalMoves.filter((m) => m.date <= end).map((m) => { const g = s.goals.find((x) => x.id === m.goalId); return g ? L.conv(m.amount, g.currency) : 0; })) });
    }
    return out;
  }, [s.goalMoves, s.goals, L]);

  return (
    <div className="space-y-5">
      <PageHeader title="Épargne et objectifs" subtitle="L'épargne n'est pas une dépense : elle reste à toi, mais elle est réservée et retirée de ton disponible réel."
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setForm({})}>Nouvel objectif</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Épargne totale" value={fmt(L.totalSavings(), main)} tone="good" />
        <Stat label="Affectée aux objectifs" value={fmt(sum(goals.map((g) => L.conv(L.goalSaved(g), g.currency))), main)} />
        <Stat label="Versements programmés / mois" value={fmt(sum(L.activeRules().filter((r) => r.kind === 'saving').map((r) => L.ruleMonthly(r))), main)} />
        <Stat label="Objectifs actifs" value={String(goals.length)} />
      </div>

      <Card title={<span className="flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-500" />Fonds d'urgence</span>} subtitle="Ta capacité à absorber un imprévu (perte de revenu, réparation, santé)">
        <div className="grid gap-5 lg:grid-cols-3">
          <div>
            <div className="text-xs text-slate-500">Dépenses essentielles mensuelles</div>
            <div className="num text-2xl font-semibold">{fmt(ess.total, main)}</div>
            <ul className="mt-2 space-y-0.5 text-xs text-slate-500">{ess.lines.map((l, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{l.label}</span><span className="num">{fmt(l.amount, main)}</span></li>)}</ul>
            {!ess.total && <p className="mt-2 text-xs text-amber-600">Marque tes charges comme essentielles dans « Engagements » pour calculer ce montant.</p>}
          </div>
          <div className="space-y-2">
            {[1, 3, 6].map((m) => (
              <div key={m}><div className="mb-1 flex justify-between text-sm"><span>{m} mois de sécurité</span><span className="num">{fmt(ess.total * m, main)}</span></div><Progress value={ess.total ? efSaved / (ess.total * m) : 0} tone="brand" /></div>
            ))}
          </div>
          <div className="flex flex-col items-center justify-center rounded-xl bg-slate-50 p-4 text-center dark:bg-slate-800/50">
            <div className="text-xs text-slate-500">Couverture actuelle</div>
            <div className={`num text-4xl font-semibold ${cover >= 3 ? 'text-emerald-600' : cover >= 1 ? 'text-amber-600' : 'text-rose-600'}`}>{cover.toFixed(1)} <span className="text-base font-normal">mois</span></div>
            <div className="text-xs text-slate-500">{ef ? `${fmt(efSaved, main)} dans « ${ef.name} »` : 'Aucun objectif fonds d\'urgence'}</div>
            {!ef && <Button size="sm" className="mt-2" variant="soft" onClick={() => setForm({ name: "Fonds d'urgence", isEmergency: true, target: ess.total * 3, priority: 1 })}>Créer le fonds d'urgence (3 mois)</Button>}
          </div>
        </div>
      </Card>

      {!goals.length ? <Card><Empty icon={<PiggyBank size={36} />} title="Aucun objectif" text="Fonds d'urgence, ordinateur, voyage au Bénin, capital de projet…" action={<Button variant="primary" onClick={() => setForm({})}>Créer un objectif</Button>} /></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {goals.map((g) => {
            const saved = L.goalSaved(g);
            const left = Math.max(0, g.target - saved);
            const planned = sum(L.activeRules().filter((r) => r.kind === 'saving' && r.goalId === g.id).map((r) => L.conv(L.ruleMonthly(r), main, g.currency)));
            const m = monthsToGoal(left, planned);
            const need = g.deadline ? requiredMonthly(left, Math.max(1, monthsBetween(L.ref, g.deadline))) : 0;
            const eta = m != null ? addMonths(L.ref, m) : null;
            const onTrack = !g.deadline || (eta != null && eta <= g.deadline);
            return (
              <div key={g.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate font-medium">{g.name}</div><div className="text-xs text-slate-500">{g.accountId ? `sur ${s.accounts.find((a) => a.id === g.accountId)?.name}` : 'affecté sur tes comptes disponibles'}</div></div><div className="flex gap-1">{g.isEmergency && <Badge tone="green">Urgence</Badge>}<Badge tone={g.priority === 1 ? 'red' : g.priority === 2 ? 'amber' : 'slate'}>P{g.priority}</Badge></div></div>
                <div className="mt-3 flex items-end justify-between"><Money v={saved} cur={g.currency} className="text-2xl font-semibold" /><span className="text-xs text-slate-500">sur {fmt(g.target, g.currency)}</span></div>
                <div className="mt-2"><Progress value={g.target ? saved / g.target : 0} tone="brand" /></div>
                <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                  <div>Reste {fmt(left, g.currency)}{g.deadline && <> · avant le {fmtDate(g.deadline)}</>}</div>
                  {planned > 0 ? <div>Versements programmés {fmt(planned, g.currency)}/mois → atteint {eta ? `en ${fmtDate(eta, 'month')}` : '—'} {g.deadline && (onTrack ? <Badge tone="green">dans les temps</Badge> : <Badge tone="red">en retard</Badge>)}</div> : <div>Aucun versement programmé</div>}
                  {g.deadline && left > 0 && <div>Pour tenir l'échéance : <b>{fmt(need, g.currency)}/mois</b></div>}
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  <Button size="sm" variant="soft" icon={<ArrowDownCircle size={13} />} onClick={() => setMove({ g, dir: 1 })}>Verser</Button>
                  <Button size="sm" variant="ghost" icon={<ArrowUpCircle size={13} />} onClick={() => setMove({ g, dir: -1 })}>Retirer</Button>
                  <Button size="sm" variant="ghost" icon={<CalendarPlus size={13} />} onClick={() => setRule({ kind: 'saving', goalId: g.id, label: `Épargne : ${g.name}`, amount: L.conv(need || 5000, g.currency, main), freq: 'monthly' })}>Programmer</Button>
                  <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setForm(g)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Évolution de l'épargne affectée (12 mois)"><LinesChart data={history} cur={main} lines={[{ key: 'Épargne', name: 'Épargne', color: '#10b981' }]} /></Card>
        <Card title="Comparaison des objectifs"><BarsChart data={goals.map((g) => ({ label: g.name.slice(0, 14), Épargné: L.conv(L.goalSaved(g), g.currency), Reste: L.conv(Math.max(0, g.target - L.goalSaved(g)), g.currency) }))} cur={main} stacked bars={[{ key: 'Épargné', name: 'Épargné', color: '#10b981' }, { key: 'Reste', name: 'Reste', color: '#e2e8f0' }]} /></Card>
      </div>
      <Card title="Historique des mouvements" pad={false}>
        <div className="px-4 pb-3 sm:px-5">
          <Table head={['Date', 'Objectif', 'Note', 'Montant']}>
            {s.goalMoves.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 60).map((m) => { const g = s.goals.find((x) => x.id === m.goalId); return <tr key={m.id}><td className={td + ' text-xs'}>{fmtDate(m.date)}</td><td className={td}>{g?.name}</td><td className={td + ' text-xs text-slate-500'}>{m.note}</td><td className={td + ' text-right'}><Money v={m.amount} cur={g?.currency ?? main} colored sign /></td></tr>; })}
          </Table>
          {!s.goalMoves.length && <p className="py-4 text-sm text-slate-500">Aucun mouvement.</p>}
        </div>
      </Card>
      <GoalForm initial={form} onClose={() => setForm(null)} />
      <MoveForm m={move} onClose={() => setMove(null)} />
      <RuleForm open={!!rule} onClose={() => setRule(null)} initial={rule ?? undefined} />
    </div>
  );
}

function GoalForm({ initial, onClose }: { initial: Partial<Goal> | null; onClose: () => void }) {
  const { s, main } = useData();
  const ui = useUI();
  const [g, setG] = useState<Partial<Goal>>({});
  useEffect(() => { if (initial) setG({ currency: main, priority: 2, isEmergency: false, archived: false, ...initial }); }, [initial]); // eslint-disable-line
  const set = (p: Partial<Goal>) => setG((x) => ({ ...x, ...p }));
  return (
    <Modal open={!!initial} onClose={onClose} title={initial?.id ? "Modifier l'objectif" : 'Nouvel objectif'} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={async () => { if (!g.name || !g.target) return ui.toast('Nom et montant cible requis', 'err'); await save('goals', { id: uid(), createdAt: nowIso(), ...g } as Goal, 'Objectif enregistré'); ui.toast('Objectif enregistré'); onClose(); }}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <Field label="Nom"><Input value={g.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus placeholder="ex. Voyage au Bénin" /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Montant cible"><MoneyInput value={g.target ?? null} onChange={(v) => set({ target: v ?? 0 })} currency={g.currency ?? main} /></Field><Field label="Devise"><Select value={g.currency} onChange={(e) => set({ currency: e.target.value })} options={currencyOptions} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label="Date limite"><Input type="date" value={g.deadline ?? ''} onChange={(e) => set({ deadline: e.target.value || null })} /></Field><Field label="Priorité"><Select value={String(g.priority)} onChange={(e) => set({ priority: Number(e.target.value) as 1 })} options={[{ value: '1', label: 'Haute' }, { value: '2', label: 'Moyenne' }, { value: '3', label: 'Basse' }]} /></Field></div>
        <Field label="Compte associé" hint="Si l'épargne est placée sur un compte dédié (livret), les versements créeront un transfert vers ce compte."><Select value={g.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value || null })} options={[{ value: '', label: 'Aucun (réservé sur mes comptes disponibles)' }, ...s.accounts.filter((a) => !a.projectId && !a.archived).map((a) => ({ value: a.id, label: a.name }))]} /></Field>
        <Toggle checked={!!g.isEmergency} onChange={(v) => set({ isEmergency: v })} label="C'est mon fonds d'urgence" />
        {initial?.id && <Toggle checked={!!g.archived} onChange={(v) => set({ archived: v })} label="Archivé" />}
      </div>
    </Modal>
  );
}

function MoveForm({ m, onClose }: { m: { g: Goal; dir: 1 | -1 } | null; onClose: () => void }) {
  const o = useOptions();
  const ui = useUI();
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [acc, setAcc] = useState('');
  useEffect(() => { if (m) { setAmount(null); setDate(today()); setNote(''); setAcc(''); } }, [m]);
  if (!m) return null;
  const { g, dir } = m;
  return (
    <Modal open onClose={onClose} title={`${dir > 0 ? 'Versement' : 'Retrait'} : ${g.name}`} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={async () => { if (!amount) return; await goalMovement(g, dir * amount, date, note, acc || undefined); ui.toast('Mouvement enregistré'); onClose(); }}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3"><Field label="Montant"><MoneyInput value={amount} onChange={setAmount} currency={g.currency} /></Field><Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
        {g.accountId && <Field label={dir > 0 ? 'Depuis le compte (transfert vers le compte épargne)' : 'Vers le compte'} hint="Laisse vide si l'argent est déjà sur le compte d'épargne."><Select value={acc} onChange={(e) => setAcc(e.target.value)} options={[{ value: '', label: 'Aucun mouvement de compte' }, ...o.accounts.filter((a) => a.value !== g.accountId)]} /></Field>}
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
