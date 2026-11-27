import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Calculator, Check, Save, Trash2, Plus, Plane, Home, ShoppingBag, Sparkles, CalendarCheck } from 'lucide-react';
import { useData, useOptions } from '../state';
import { Badge, Button, Card, Field, Input, LevelBadge, Money, MoneyInput, PageHeader, Select, Stat, Tabs, Table, td, useUI, cx, Empty } from '../ui/ui';
import { BalanceChart, LinesChart } from '../ui/charts';
import { save, remove } from '../db/repo';
import { nowIso, uid } from '../db/db';
import { addDays, addMonths, diffDays, endOfMonth, fmtDate, today } from '../engine/date';
import { fmt } from '../engine/money';
import { capacity, compareModes, dateForAmount, endOfMonthScenarios, expandOp, opTotalCost, project, simulatePurchase, levelOf } from '../engine/projection';
import type { Change, Rule, VirtualMode, VirtualOp, Wish } from '../engine/types';

type TabT = 'achat' | 'fin' | 'capacite' | 'fois' | 'situation' | 'envies';

export default function Simulations() {
  const [tab, setTab] = useState<TabT>('achat');
  const loc = useLocation();
  const fromQuery = useMemo<Partial<VirtualOp> | null>(() => {
    const q = new URLSearchParams(loc.search);
    return q.get('prix') ? { label: q.get('objet') ?? 'Achat', amount: Number(q.get('prix')), ...(q.get('fois') ? { mode: 'plusieurs' as const, installments: Number(q.get('fois')) } : {}) } : null;
  }, [loc.search]);
  const [manual, setSeed] = useState<Partial<VirtualOp> | null>(null);
  const seed = manual ?? fromQuery;
  useEffect(() => { setSeed(null); if (fromQuery) setTab('achat'); }, [fromQuery]);
  return (
    <div className="space-y-5">
      <PageHeader title="Simulateur financier" subtitle="Toutes les simulations fonctionnent dans un environnement virtuel : tes comptes réels ne changent jamais tant que tu ne valides pas." />
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'achat', label: "Simulateur d'achat" }, { value: 'fin', label: 'Fin de mois' }, { value: 'capacite', label: "Capacité d'achat" },
        { value: 'fois', label: 'Paiement en plusieurs fois' }, { value: 'situation', label: 'Changement de situation' }, { value: 'envies', label: 'Achats souhaités' },
      ]} />
      {tab === 'achat' && <Purchase key={JSON.stringify(seed)} seed={seed} />}
      {tab === 'fin' && <EndOfMonth />}
      {tab === 'capacite' && <Capacity />}
      {tab === 'fois' && <Installments />}
      {tab === 'situation' && <Situation />}
      {tab === 'envies' && <Wishes onSimulate={(w) => { setSeed({ label: w.name, amount: w.price }); setTab('achat'); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ Achat
function Purchase({ seed }: { seed: Partial<VirtualOp> | null }) {
  const { s, L, main } = useData();
  const o = useOptions();
  const ui = useUI();
  const [op, setOp] = useState<VirtualOp>({ id: 'sim', label: seed?.label ?? 'Téléphone', amount: seed?.amount ?? 90000, date: addDays(today(), 7), direction: 'out', mode: seed?.mode ?? 'comptant', installments: seed?.installments ?? 3, fees: 0, downPayment: 0, rate: 0, months: 12 });
  const [acc, setAcc] = useState(s.accounts.find((a) => !a.projectId && a.liquid && !a.archived)?.id ?? '');
  const set = (p: Partial<VirtualOp>) => setOp((x) => ({ ...x, ...p }));
  const res = useMemo(() => (op.amount > 0 ? simulatePurchase(L, op) : null), [L, op]);
  const chart = useMemo(() => res ? res.base.days.map((d, i) => ({ date: d.date, past: d.free, free: res.withOp.days[i]?.free })) : [], [res]);

  async function validate() {
    if (!res || !acc) return;
    const sched = expandOp(op, L);
    const ok = await ui.confirm({ title: 'Valider cet achat ?', text: `L'achat sera ajouté à tes engagements (${sched.length} échéance(s), total ${fmt(res.cost.total, main)}). Il ne sera considéré comme payé qu'après confirmation de chaque échéance.`, confirmLabel: 'Ajouter aux engagements' });
    if (!ok) return;
    const at = nowIso();
    const base: Omit<Rule, 'id' | 'label' | 'amount' | 'freq' | 'startDate'> = { kind: 'expense', accountId: acc, interval: 1, certainty: 'certaine', essential: false, active: true, createdAt: at, updatedAt: at, categoryId: op.mode === 'comptant' || op.mode === 'epargne' ? 'divers' : 'mensualites' };
    if (op.mode === 'comptant' || op.mode === 'epargne') {
      await save('rules', { ...base, id: uid(), label: op.label, amount: L.conv(op.amount, main, L.accCur(acc)), freq: 'once', startDate: op.date } as Rule, `Achat validé : ${op.label}`);
      if (op.mode === 'epargne' && op.goalId) {
        const g = s.goals.find((x) => x.id === op.goalId);
        if (g) { const used = Math.min(L.conv(L.goalSaved(g), g.currency), op.amount); await save('goalMoves', { id: uid(), goalId: g.id, date: op.date, amount: -L.conv(used, main, g.currency), note: `Utilisé pour : ${op.label}`, createdAt: at }, 'Épargne mobilisée pour un achat'); }
      }
    } else {
      for (const e of sched) await save('rules', { ...base, id: uid(), label: e.label, amount: L.conv(-e.balance, main, L.accCur(acc)), freq: 'once', startDate: e.date } as Rule, `Achat validé : ${e.label}`);
    }
    const w = s.wishes.find((x) => x.name === op.label && x.status === 'envie');
    if (w) await save('wishes', { ...w, status: 'planifie', targetDate: op.date }, 'Achat planifié');
    ui.toast('Achat ajouté aux engagements');
  }
  async function saveScenario() {
    await save('scenarios', { id: uid(), name: `${op.label} · ${fmt(op.amount, main)}`, createdAt: nowIso(), ops: [op], changes: [], kind: 'achat' }, 'Scénario enregistré');
    ui.toast('Scénario enregistré');
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card title="L'achat envisagé" className="lg:col-span-2">
        <div className="space-y-3">
          <Field label="Objet"><Input value={op.label} onChange={(e) => set({ label: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prix"><MoneyInput value={op.amount} onChange={(v) => set({ amount: v ?? 0 })} currency={main} /></Field>
            <Field label="Date d'achat"><Input type="date" value={op.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          </div>
          <Field label="Mode de financement"><Select value={op.mode} onChange={(e) => set({ mode: e.target.value as VirtualMode })} options={[{ value: 'comptant', label: 'Comptant' }, { value: 'plusieurs', label: 'Paiement en plusieurs fois' }, { value: 'credit', label: 'Apport + financement externe (crédit)' }, { value: 'epargne', label: 'Financé par une épargne dédiée' }]} /></Field>
          {op.mode === 'plusieurs' && <div className="grid grid-cols-2 gap-3"><Field label="Nombre d'échéances"><Input type="number" min={2} max={24} value={op.installments} onChange={(e) => set({ installments: Number(e.target.value) })} /></Field><Field label="Frais"><MoneyInput value={op.fees ?? 0} onChange={(v) => set({ fees: v ?? 0 })} currency={main} /></Field></div>}
          {op.mode === 'credit' && <div className="grid grid-cols-2 gap-3">
            <Field label="Apport personnel"><MoneyInput value={op.downPayment ?? 0} onChange={(v) => set({ downPayment: v ?? 0 })} currency={main} /></Field>
            <Field label="Taux annuel (%)"><Input type="number" step="0.1" value={op.rate} onChange={(e) => set({ rate: Number(e.target.value) })} /></Field>
            <Field label="Durée (mois)"><Input type="number" min={1} value={op.months} onChange={(e) => set({ months: Number(e.target.value) })} /></Field>
            <Field label="Frais de dossier"><MoneyInput value={op.fees ?? 0} onChange={(v) => set({ fees: v ?? 0 })} currency={main} /></Field>
          </div>}
          {op.mode === 'epargne' && <Field label="Objectif d'épargne mobilisé" hint={op.goalId ? `Épargne disponible : ${fmt(L.conv(L.goalSaved(s.goals.find((g) => g.id === op.goalId)!), s.goals.find((g) => g.id === op.goalId)!.currency), main)}` : undefined}><Select value={op.goalId ?? ''} onChange={(e) => set({ goalId: e.target.value })} options={[{ value: '', label: 'Choisir…' }, ...o.goals]} /></Field>}
          {res && res.cost.count > 1 && <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60"><div className="flex justify-between"><span>Mensualité</span><b className="num">{fmt(res.cost.monthly, main)}</b></div><div className="flex justify-between"><span>Coût total</span><b className="num">{fmt(res.cost.total, main)}</b></div><div className="flex justify-between text-slate-500"><span>Surcoût</span><span className="num">{fmt(res.cost.total - op.amount, main)}</span></div></div>}
          <Field label="Compte utilisé (pour la validation)"><Select value={acc} onChange={(e) => setAcc(e.target.value)} options={o.accounts} /></Field>
        </div>
      </Card>
      <div className="space-y-4 lg:col-span-3">
        {res && (
          <Card>
            <div className={cx('rounded-xl p-4', res.level === 'ok' ? 'bg-emerald-50 dark:bg-emerald-500/10' : res.level === 'tendu' ? 'bg-amber-50 dark:bg-amber-500/10' : 'bg-rose-50 dark:bg-rose-500/10')}>
              <div className="text-lg font-semibold">{res.level === 'ok' ? '🟢 Achat raisonnable' : res.level === 'tendu' ? '🟠 Achat possible mais tendu' : '🔴 Achat risqué'}</div>
              <ul className="mt-2 space-y-1 text-sm">{res.reasons.map((r, i) => <li key={i}>• {r}</li>)}</ul>
            </div>
            {res.advice.length > 0 && <ul className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">{res.advice.map((a, i) => <li key={i} className="flex gap-2"><Sparkles size={14} className="mt-0.5 shrink-0 text-amber-500" />{a}</li>)}</ul>}
            <div className="mt-4 flex flex-wrap gap-2">
              {res.suggestion && res.suggestion.date !== op.date && <Button variant="soft" icon={<CalendarCheck size={16} />} onClick={() => set({ date: res.suggestion!.date })}>Simuler au {fmtDate(res.suggestion.date)}</Button>}
              <Button icon={<Save size={16} />} onClick={saveScenario}>Enregistrer le scénario</Button>
              <Button variant="primary" icon={<Check size={16} />} onClick={validate}>Valider l'achat</Button>
            </div>
          </Card>
        )}
        {res && (
          <Card title="Analyse" pad>
            <Table head={['Indicateur', 'Valeur']}>{res.table.map((r) => <tr key={r.label}><td className={td}>{r.label}</td><td className={td + ' text-right'}><Money v={r.value} cur={main} className="font-medium" colored={r.value < 0} /></td></tr>)}</Table>
            <div className="mt-4"><BalanceChart data={chart} cur={main} threshold={s.settings.safetyThreshold} height={220} /></div>
            <p className="mt-1 text-xs text-slate-500">Gris : sans l'achat · vert : avec l'achat (solde disponible hors épargne affectée).</p>
            {res.schedule.length > 1 && <div className="mt-4"><h4 className="mb-1 text-sm font-medium">Échéancier</h4><ul className="grid gap-1 text-sm sm:grid-cols-2">{res.schedule.map((e, i) => <li key={i} className="flex justify-between rounded bg-slate-50 px-2 py-1 dark:bg-slate-800/60"><span>{fmtDate(e.date)}</span><Money v={-e.balance} cur={main} /></li>)}</ul></div>}
          </Card>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Fin de mois
function EndOfMonth() {
  const { s, L, main } = useData();
  const [target, setTarget] = useState(endOfMonth(L.ref));
  const sc = useMemo(() => endOfMonthScenarios(L, target), [L, target]);
  const real = sc[1].projection;
  const chart = real.days.map((d, i) => ({ date: d.date, free: d.free, high: sc[0].projection.days[i]?.free, low: sc[2].projection.days[i]?.free }));
  const remainingEvents = real.events.filter((e) => e.date >= L.ref);
  return (
    <div className="space-y-4">
      <Card title="Si je continue à dépenser comme actuellement, combien me restera-t-il ?" action={<Input type="date" className="h-8 w-40 text-xs" value={target} min={L.ref} onChange={(e) => setTarget(e.target.value)} />}>
        <div className="grid gap-3 sm:grid-cols-3">
          {sc.map((x) => (
            <div key={x.scenario} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
              <div className="flex items-center justify-between"><span className="text-sm font-medium">{({ optimiste: 'Optimiste', realiste: 'Réaliste', pessimiste: 'Pessimiste' } as Record<string, string>)[x.scenario]}</span><LevelBadge level={x.level} /></div>
              <div className="num mt-1 text-2xl font-semibold">{fmt(x.end.free, main)}</div>
              <div className="text-xs text-slate-500">disponible · solde total {fmt(x.end.balance, main)}</div>
              <div className="mt-1 text-xs text-slate-500">point bas {fmt(x.min.value, main)} le {fmtDate(x.min.date)}</div>
            </div>
          ))}
        </div>
        <div className="mt-4"><BalanceChart data={chart} cur={main} threshold={s.settings.safetyThreshold} height={240} /></div>
        <p className="mt-2 text-xs text-slate-500">Optimiste : tous les revenus attendus et dépenses variables à 85 %. Réaliste : revenus certains et probables, dépenses au rythme actuel ({fmt(real.variableDaily, main)}/jour, {real.variableSource}). Pessimiste : revenus certains seulement, dépenses à 115 %.</p>
      </Card>
      <Card title="Opérations restantes prises en compte (scénario réaliste)" pad={false}>
        <div className="px-4 pb-3 sm:px-5">
          {remainingEvents.length ? <Table head={['Date', 'Opération', 'Montant']}>{remainingEvents.map((e, i) => <tr key={i}><td className={td + ' text-xs'}>{fmtDate(e.date, 'day')}</td><td className={td}>{e.label}{e.source === 'retard' && <Badge tone="red" className="ml-1">retard</Badge>}</td><td className={td + ' text-right'}><Money v={e.free} cur={main} colored /></td></tr>)}</Table> : <p className="py-4 text-sm text-slate-500">Aucune opération planifiée d'ici là.</p>}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Capacité
function Capacity() {
  const { L, main } = useData();
  const [price, setPrice] = useState<number | null>(120000);
  const cap = useMemo(() => capacity(L, 365), [L]);
  const when = price ? dateForAmount(cap, price, true) : null;
  const whenMin = price ? dateForAmount(cap, price, false) : null;
  const marks = [0, Math.max(0, diffDays(endOfMonth(L.ref), L.ref)), 30, 60, 90, 180, 364].map((i) => cap.series[Math.min(i, cap.series.length - 1)]);
  const data = cap.series.filter((_, i) => i % 3 === 0).map((x) => ({ label: x.date, 'Prix maximal raisonnable': x.reasonable, 'Maximum absolu': x.max }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Combien puis-je dépenser ?" className="lg:col-span-1">
        <div className="space-y-3">
          <Stat label="Prix maximal raisonnable aujourd'hui" value={fmt(cap.series[0].reasonable, main)} tone="good" hint={`en gardant ${fmt(cap.reserve, main)} de réserve`} />
          <Stat label="Maximum absolu aujourd'hui" value={fmt(cap.series[0].max, main)} hint={`sans descendre sous le seuil (${fmt(cap.S, main)})`} />
          <Field label="Prix de l'achat visé"><MoneyInput value={price} onChange={setPrice} currency={main} /></Field>
          {price ? <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">{when ? <>Achat <b>raisonnable</b> à partir du <b>{fmtDate(when, 'long')}</b>.</> : <>Pas d'achat raisonnable possible dans les 12 mois.</>}{whenMin && whenMin !== when && <div className="mt-1 text-slate-500">Possible (marge minimale) dès le {fmtDate(whenMin, 'long')}.</div>}</div> : null}
        </div>
      </Card>
      <Card title="Capacité d'achat dans le temps" className="lg:col-span-2" subtitle="Montant dépensable à chaque date sans franchir le seuil, compte tenu de toutes les échéances futures">
        <LinesChart data={data} xKey="label" cur={main} lines={[{ key: 'Prix maximal raisonnable', name: 'Raisonnable', color: '#10b981' }, { key: 'Maximum absolu', name: 'Maximum', color: '#94a3b8', dashed: true }]} />
        <Table className="mt-3" head={['Date', 'Raisonnable', 'Maximum']}>{marks.map((m) => <tr key={m.date}><td className={td}>{fmtDate(m.date, 'long')}</td><td className={td}><Money v={m.reasonable} cur={main} className="font-medium" /></td><td className={td}><Money v={m.max} cur={main} /></td></tr>)}</Table>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Plusieurs fois
function Installments() {
  const { L, main } = useData();
  const [amount, setAmount] = useState<number | null>(90000);
  const [date, setDate] = useState(today());
  const [n, setN] = useState(6);
  const [fees, setFees] = useState<number | null>(0);
  const [rate, setRate] = useState(9.9);
  const res = useMemo(() => amount ? compareModes(L, { id: 'c', label: 'Achat', amount, date, direction: 'out' }, [
    { label: 'Comptant', mode: 'comptant' }, { label: '2 fois sans frais', mode: 'plusieurs', installments: 2 }, { label: '3 fois sans frais', mode: 'plusieurs', installments: 3 },
    { label: '4 fois sans frais', mode: 'plusieurs', installments: 4 }, { label: `${n} fois (frais ${fmt(fees ?? 0, main)})`, mode: 'plusieurs', installments: n, fees: fees ?? 0 },
    { label: `Crédit 12 mois à ${rate} %`, mode: 'credit', months: 12, rate },
  ]) : [], [L, amount, date, n, fees, rate, main]);
  const debtRules = L.activeRules().filter((r) => r.kind === 'debt_repay' || r.categoryId === 'mensualites');
  return (
    <div className="space-y-4">
      <Card title="Comparer les modes de paiement">
        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="Montant"><MoneyInput value={amount} onChange={setAmount} currency={main} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Paiement personnalisé (fois)"><Input type="number" min={2} max={36} value={n} onChange={(e) => setN(Number(e.target.value))} /></Field>
          <Field label="Frais (personnalisé)"><MoneyInput value={fees} onChange={setFees} currency={main} /></Field>
          <Field label="Taux du crédit (%)"><Input type="number" step="0.1" value={rate} onChange={(e) => setRate(Number(e.target.value))} /></Field>
        </div>
        <Table className="mt-4" head={['Mode', 'Mensualité', 'Coût total', 'Surcoût', 'Point bas du disponible', 'Verdict']}>
          {res.map((r) => <tr key={r.label}><td className={td + ' font-medium'}>{r.label}</td><td className={td}>{r.cost.count > 1 ? <Money v={r.cost.monthly} cur={main} /> : '—'}</td><td className={td}><Money v={r.cost.total} cur={main} /></td><td className={td}><Money v={r.cost.total - (amount ?? 0)} cur={main} /></td><td className={td}><Money v={r.min} cur={main} colored={r.min < 0} /> <span className="text-xs text-slate-500">{fmtDate(r.minDate)}</span></td><td className={td}><LevelBadge level={r.level} /></td></tr>)}
        </Table>
      </Card>
      <Card title="Mensualités déjà en cours" subtitle="Risque d'accumulation : chaque paiement fractionné réduit ta marge des mois suivants">
        {debtRules.length ? <ul className="space-y-1 text-sm">{debtRules.map((r) => <li key={r.id} className="flex justify-between"><span>{r.label}</span><Money v={L.ruleMonthly(r)} cur={main} /></li>)}<li className="flex justify-between border-t border-slate-100 pt-1 font-semibold dark:border-slate-800"><span>Total mensuel</span><Money v={debtRules.reduce((a, r) => a + L.ruleMonthly(r), 0)} cur={main} /></li></ul> : <p className="text-sm text-slate-500">Aucune mensualité en cours.</p>}
        {debtRules.length >= 2 && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">Tu as déjà {debtRules.length} remboursements récurrents. Ajouter un paiement fractionné augmente le risque d'accumulation.</p>}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Changement de situation
function Situation() {
  const { s, L, main } = useData();
  const ui = useUI();
  const [changes, setChanges] = useState<Change[]>([]);
  const [ops, setOps] = useState<VirtualOp[]>([]);
  const [months, setMonths] = useState('12');
  const [name, setName] = useState('Mon scénario');
  const days = Number(months) * 30 + 1;
  const base = useMemo(() => project(L, { days }), [L, days]);
  const sim = useMemo(() => project(L, { days, changes, ops }), [L, days, changes, ops]);
  const step = Math.max(1, Math.floor(days / 120));
  const chart = base.days.filter((_, i) => i % step === 0).map((d) => ({ label: d.date, Actuel: d.free, Scénario: sim.days[base.days.indexOf(d)]?.free }));
  const add = (c: Change) => setChanges((x) => [...x, c]);
  const id = () => uid();
  const start = addMonths(L.ref, 0);
  const incomeRules = L.activeRules().filter((r) => r.kind === 'income');
  const rentRule = L.activeRules().find((r) => r.categoryId === 'loyer');
  const [moveRent, setMoveRent] = useState<number | null>(rentRule ? rentRule.amount + 15000 : 60000);
  const [moveCost, setMoveCost] = useState<number | null>(40000);
  const [deposit, setDeposit] = useState<number | null>(60000);
  const [moveDate, setMoveDate] = useState(addMonths(L.ref, 2).slice(0, 8) + '01');
  const [trip, setTrip] = useState({ date: addMonths(L.ref, 6), tickets: 75000 as number | null, stay: 30000 as number | null, onsite: 40000 as number | null });

  const marks = [30, 90, 180, 365].filter((d) => d <= days).map((d) => ({ d, a: base.days[d - 1]?.free ?? 0, b: sim.days[d - 1]?.free ?? 0 }));
  const label = (c: Change) => {
    switch (c.type) {
      case 'income_delta': return `${c.label} : ${fmt(c.amount, main, { sign: true })}/mois dès le ${fmtDate(c.from)}`;
      case 'expense_add': case 'saving_add': return `${c.label} : ${fmt(c.amount, main)}/mois dès le ${fmtDate(c.from)}`;
      case 'rule_off': return `Suppression : ${s.rules.find((r) => r.id === c.ruleId)?.label} dès le ${fmtDate(c.from)}`;
      case 'rule_amount': return `${s.rules.find((r) => r.id === c.ruleId)?.label} → ${fmt(c.amount, L.accCur(s.rules.find((r) => r.id === c.ruleId)?.accountId))} dès le ${fmtDate(c.from)}`;
      case 'variable_pct': return `Dépenses variables ${c.pct > 0 ? '+' : ''}${c.pct} %`;
      case 'payoff_debts': return `Remboursement de toutes les dettes le ${fmtDate(c.from)}`;
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        <Card title="Hypothèses rapides">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => add({ id: id(), type: 'income_delta', label: 'Hausse de salaire', amount: 10000, from: start })}>Salaire +100 €</Button>
            <Button size="sm" onClick={() => add({ id: id(), type: 'expense_add', label: 'Hausse de loyer', amount: 15000, from: addMonths(start, 1) })}>Loyer +150 €</Button>
            <Button size="sm" onClick={() => add({ id: id(), type: 'saving_add', label: 'Épargne mensuelle', amount: 10000, from: start })}>Épargner 100 €/mois</Button>
            <Button size="sm" onClick={() => add({ id: id(), type: 'payoff_debts', from: L.ref })}>Rembourser toutes mes dettes</Button>
            <Button size="sm" onClick={() => add({ id: id(), type: 'variable_pct', pct: -10 })}>Dépenses variables −10 %</Button>
            <Button size="sm" onClick={() => add({ id: id(), type: 'variable_pct', pct: 15 })}>Dépenses variables +15 %</Button>
          </div>
          {incomeRules.length > 0 && <div className="mt-3"><Field label="Perte d'une aide ou d'un revenu"><Select value="" onChange={(e) => e.target.value && add({ id: id(), type: 'rule_off', ruleId: e.target.value, from: addMonths(start, 1) })} options={[{ value: '', label: 'Choisir le revenu supprimé…' }, ...incomeRules.map((r) => ({ value: r.id, label: `${r.label} (${fmt(r.amount, L.accCur(r.accountId))})` }))]} /></Field></div>}
        </Card>
        <Card title={<span className="flex items-center gap-2"><Home size={16} />Simulateur de déménagement</span>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nouveau loyer"><MoneyInput value={moveRent} onChange={setMoveRent} currency={main} /></Field>
            <Field label="Date d'entrée"><Input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} /></Field>
            <Field label="Frais de déménagement"><MoneyInput value={moveCost} onChange={setMoveCost} currency={main} /></Field>
            <Field label="Dépôt de garantie"><MoneyInput value={deposit} onChange={setDeposit} currency={main} /></Field>
          </div>
          <Button size="sm" className="mt-3" variant="soft" onClick={() => {
            if (rentRule) add({ id: id(), type: 'rule_amount', ruleId: rentRule.id, amount: L.conv(moveRent ?? 0, main, L.accCur(rentRule.accountId)), from: moveDate });
            else add({ id: id(), type: 'expense_add', label: 'Nouveau loyer', amount: moveRent ?? 0, from: moveDate });
            setOps((x) => [...x, { id: id(), label: 'Déménagement et dépôt de garantie', date: addDays(moveDate, -7), amount: (moveCost ?? 0) + (deposit ?? 0), direction: 'out', mode: 'comptant' }]);
          }}>Appliquer au scénario</Button>
        </Card>
        <Card title={<span className="flex items-center gap-2"><Plane size={16} />Simulateur de voyage</span>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date de départ"><Input type="date" value={trip.date} onChange={(e) => setTrip({ ...trip, date: e.target.value })} /></Field>
            <Field label="Billets"><MoneyInput value={trip.tickets} onChange={(v) => setTrip({ ...trip, tickets: v })} currency={main} /></Field>
            <Field label="Hébergement"><MoneyInput value={trip.stay} onChange={(v) => setTrip({ ...trip, stay: v })} currency={main} /></Field>
            <Field label="Dépenses sur place"><MoneyInput value={trip.onsite} onChange={(v) => setTrip({ ...trip, onsite: v })} currency={main} /></Field>
          </div>
          <Button size="sm" className="mt-3" variant="soft" onClick={() => setOps((x) => [...x,
            { id: id(), label: 'Billets de voyage', date: addDays(trip.date, -60) < L.ref ? L.ref : addDays(trip.date, -60), amount: trip.tickets ?? 0, direction: 'out', mode: 'comptant' },
            { id: id(), label: 'Voyage : hébergement et sur place', date: trip.date, amount: (trip.stay ?? 0) + (trip.onsite ?? 0), direction: 'out', mode: 'comptant' },
          ])}>Appliquer au scénario</Button>
        </Card>
      </div>
      <div className="space-y-4 lg:col-span-3">
        <Card title="Scénario" action={<Select className="h-8 w-28 text-xs" value={months} onChange={(e) => setMonths(e.target.value)} options={[['3', '3 mois'], ['6', '6 mois'], ['12', '1 an'], ['36', '3 ans'], ['60', '5 ans']].map(([v, l]) => ({ value: v, label: l }))} />}>
          {changes.length + ops.length === 0 ? <p className="text-sm text-slate-500">Ajoute une ou plusieurs hypothèses à gauche pour recalculer l'ensemble de ton budget.</p> : (
            <ul className="space-y-1.5 text-sm">
              {changes.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 dark:bg-slate-800/60"><span>{label(c)}</span><button className="text-slate-400 hover:text-rose-600" onClick={() => setChanges(changes.filter((x) => x.id !== c.id))}><Trash2 size={14} /></button></li>)}
              {ops.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 dark:bg-slate-800/60"><span>{c.label} : {fmt(c.amount, main)} le {fmtDate(c.date)}</span><button className="text-slate-400 hover:text-rose-600" onClick={() => setOps(ops.filter((x) => x.id !== c.id))}><Trash2 size={14} /></button></li>)}
            </ul>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {marks.map((m) => <div key={m.d} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50"><div className="text-xs text-slate-500">à {m.d < 365 ? `${Math.round(m.d / 30)} mois` : '1 an'}</div><div className="num font-semibold">{fmt(m.b, main)}</div><div className={cx('num text-xs', m.b - m.a >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{fmt(m.b - m.a, main, { sign: true })}</div></div>)}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm"><span>Point bas : <b>{fmt(sim.min.value, main)}</b> le {fmtDate(sim.min.date)}</span><LevelBadge level={levelOf(sim.min.value, L)} /></div>
          <div className="mt-3"><LinesChart data={chart} cur={main} threshold={s.settings.safetyThreshold} lines={[{ key: 'Actuel', name: 'Situation actuelle', color: '#94a3b8', dashed: true }, { key: 'Scénario', name: 'Scénario', color: '#10b981' }]} /></div>
          {(changes.length + ops.length > 0) && <div className="mt-3 flex flex-wrap items-center gap-2"><Input className="h-8 max-w-56 text-sm" value={name} onChange={(e) => setName(e.target.value)} /><Button size="sm" icon={<Save size={14} />} onClick={async () => { await save('scenarios', { id: uid(), name, createdAt: nowIso(), ops, changes, kind: 'situation' }, 'Scénario enregistré'); ui.toast('Scénario enregistré'); }}>Enregistrer</Button><Button size="sm" variant="ghost" onClick={() => { setChanges([]); setOps([]); }}>Réinitialiser</Button></div>}
        </Card>
        <SavedScenarios kind="situation" onLoad={(sc) => { setChanges(sc.changes); setOps(sc.ops); setName(sc.name); }} />
      </div>
    </div>
  );
}

export function SavedScenarios({ kind, onLoad }: { kind: 'situation' | 'decision' | 'achat'; onLoad: (s: { changes: Change[]; ops: VirtualOp[]; name: string }) => void }) {
  const { s } = useData();
  const list = s.scenarios.filter((x) => x.kind === kind);
  if (!list.length) return null;
  return (
    <Card title="Scénarios enregistrés">
      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{list.map((x) => (
        <li key={x.id} className="flex items-center justify-between gap-2 py-2"><span>{x.name} <span className="text-xs text-slate-500">· {fmtDate(x.createdAt.slice(0, 10))}</span></span><span className="flex gap-1"><Button size="sm" variant="soft" onClick={() => onLoad(x)}>Charger</Button><Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => remove('scenarios', x.id, 'Scénario supprimé')} /></span></li>
      ))}</ul>
    </Card>
  );
}

// ------------------------------------------------------------------ Achats souhaités
function Wishes({ onSimulate }: { onSimulate: (w: Wish) => void }) {
  const { s, L, main } = useData();
  const ui = useUI();
  const [name, setName] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [prio, setPrio] = useState<1 | 2 | 3>(2);
  const cap = useMemo(() => capacity(L, 365), [L]);
  const list = s.wishes.filter((w) => w.status !== 'abandonne').sort((a, b) => a.priority - b.priority);
  return (
    <div className="space-y-4">
      <Card title="Ajouter un achat souhaité">
        <div className="grid gap-2 sm:grid-cols-5">
          <Input className="sm:col-span-2" placeholder="ex. Ordinateur portable" value={name} onChange={(e) => setName(e.target.value)} />
          <MoneyInput value={price} onChange={setPrice} currency={main} placeholder="Prix" />
          <Select value={String(prio)} onChange={(e) => setPrio(Number(e.target.value) as 1 | 2 | 3)} options={[{ value: '1', label: 'Priorité haute' }, { value: '2', label: 'Priorité moyenne' }, { value: '3', label: 'Envie' }]} />
          <Button variant="primary" icon={<Plus size={16} />} onClick={async () => { if (!name || !price) return ui.toast('Nom et prix requis', 'err'); await save('wishes', { id: uid(), name, price, currency: main, priority: prio, status: 'envie', createdAt: nowIso() }, 'Achat souhaité ajouté'); setName(''); setPrice(null); }}>Ajouter</Button>
        </div>
      </Card>
      <Card title="Comparateur d'achats" subtitle="Pour chaque achat : verdict s'il était fait aujourd'hui et date à partir de laquelle il devient raisonnable" pad={false}>
        <div className="px-4 pb-3 sm:px-5">
          {list.length ? <Table head={['Achat', 'Prix', 'Priorité', "Aujourd'hui", 'Raisonnable dès', 'Statut', '']}>
            {list.map((w) => {
              const p = L.conv(w.price, w.currency);
              const today0 = cap.series[0];
              const lvl = p <= today0.reasonable ? 'ok' : p <= today0.max ? 'tendu' : 'risque';
              const when = dateForAmount(cap, p, true);
              return (
                <tr key={w.id}>
                  <td className={td + ' font-medium'}><ShoppingBag size={14} className="mr-1.5 inline text-slate-400" />{w.name}</td>
                  <td className={td}><Money v={w.price} cur={w.currency} /></td>
                  <td className={td}><Badge tone={w.priority === 1 ? 'red' : w.priority === 2 ? 'amber' : 'slate'}>{['', 'Haute', 'Moyenne', 'Envie'][w.priority]}</Badge></td>
                  <td className={td}><LevelBadge level={lvl as 'ok'} /></td>
                  <td className={td + ' text-xs'}>{when ? fmtDate(when, 'long') : '> 12 mois'}</td>
                  <td className={td}><Select className="h-8 text-xs" value={w.status} onChange={(e) => save('wishes', { ...w, status: e.target.value as Wish['status'] }, 'Statut modifié')} options={[{ value: 'envie', label: 'Envie' }, { value: 'planifie', label: 'Planifié' }, { value: 'achete', label: 'Acheté' }, { value: 'abandonne', label: 'Abandonné' }]} /></td>
                  <td className={td + ' whitespace-nowrap text-right'}><Button size="sm" variant="soft" icon={<Calculator size={13} />} onClick={() => onSimulate(w)}>Simuler</Button><button className="ml-1 rounded p-1.5 text-slate-400 hover:text-rose-600" onClick={() => remove('wishes', w.id, 'Achat souhaité supprimé')}><Trash2 size={14} /></button></td>
                </tr>
              );
            })}
          </Table> : <Empty title="Aucun achat souhaité" text="Constitue ta liste d'achats à venir pour les comparer et les planifier." />}
        </div>
      </Card>
    </div>
  );
}
