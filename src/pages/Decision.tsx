import { useMemo, useState } from 'react';
import { Plus, Trash2, Wand2, Check, Save } from 'lucide-react';
import { useData, useOptions } from '../state';
import { Badge, Button, Card, Input, LevelBadge, Money, MoneyInput, PageHeader, Select, Table, Toggle, td, useUI, cx } from '../ui/ui';
import { LinesChart } from '../ui/charts';
import { SavedScenarios } from './Simulations';
import { save } from '../db/repo';
import { nowIso, uid } from '../db/db';
import { addDays, fmtDate, monthLabel, today } from '../engine/date';
import { fmt } from '../engine/money';
import { levelOf, optimizeDecisions, project } from '../engine/projection';
import type { Rule, VirtualOp } from '../engine/types';

type Op = VirtualOp & { kindHint: NonNullable<VirtualOp['kindHint']>; linkId?: string };
const KINDS = [{ value: 'achat', label: 'Achat' }, { value: 'remboursement', label: 'Remboursement' }, { value: 'epargne', label: 'Épargne' }, { value: 'projet', label: 'Financement projet' }, { value: 'autre', label: 'Autre dépense' }];
const EFFECT: Record<string, string> = { achat: 'Réduction de la trésorerie', remboursement: "Réduction de l'endettement", epargne: 'Augmentation de la réserve', projet: 'Mobilisation de trésorerie vers le projet', autre: 'Réduction de la trésorerie' };

export default function Decision() {
  const { s, L, main } = useData();
  const o = useOptions();
  const ui = useUI();
  const t0 = today();
  const firstDebt = s.debts.find((d) => d.direction === 'dette' && !d.archived && L.debtRemaining(d) > 0);
  const [ops, setOps] = useState<Op[]>(() => [
    { id: uid(), label: 'Ordinateur', kindHint: 'achat', amount: 100000, date: t0, direction: 'out', mode: 'comptant', priority: 3 },
    { id: uid(), label: firstDebt ? `Rembourser ${firstDebt.person}` : 'Rembourser un ami', kindHint: 'remboursement', amount: 20000, date: t0, direction: 'out', mode: 'comptant', priority: 1, linkId: firstDebt?.id },
    { id: uid(), label: 'Épargne de précaution', kindHint: 'epargne', amount: 10000, date: t0, direction: 'out', mode: 'comptant', priority: 2, linkId: s.goals.find((g) => g.isEmergency)?.id },
    { id: uid(), label: 'Financement du projet', kindHint: 'projet', amount: 15000, date: t0, direction: 'out', mode: 'comptant', priority: 2, linkId: s.projects[0]?.id },
  ]);
  const [prudent, setPrudent] = useState(true);
  const [applied, setApplied] = useState(false);
  const [name, setName] = useState('Plan de décisions');
  const set = (id: string, p: Partial<Op>) => { setOps((x) => x.map((y) => (y.id === id ? { ...y, ...p } : y))); setApplied(false); };

  const asIs = useMemo(() => project(L, { days: 400, ops }), [L, ops]);
  const base = useMemo(() => project(L, { days: 400 }), [L]);
  const opt = useMemo(() => optimizeDecisions(L, ops, prudent), [L, ops, prudent]);
  const optOps = opt.placed.filter((p) => p.date).map((p) => p.op);
  const optProj = useMemo(() => project(L, { days: 400, ops: optOps }), [L, optOps]);
  const step = 4;
  const chart = base.days.filter((_, i) => i % step === 0).map((d, k) => ({ label: d.date, 'Sans décision': d.free, 'Tout aux dates choisies': asIs.days[k * step]?.free, 'Calendrier proposé': optProj.days[k * step]?.free }));
  const calendar = useMemo(() => {
    const m = new Map<string, { label: string; amount: number }[]>();
    for (const p of opt.placed) { if (!p.date) continue; const k = p.date.slice(0, 7); m.set(k, [...(m.get(k) ?? []), { label: p.op.label, amount: p.op.amount }]); }
    return [...m.entries()].sort();
  }, [opt]);

  async function applyPlan(useOpt: boolean) {
    const list = useOpt ? opt.placed.filter((p) => p.date).map((p) => p.op as Op) : ops;
    const acc = s.accounts.find((a) => !a.projectId && a.liquid && !a.archived);
    if (!acc) return ui.toast('Crée d\'abord un compte', 'err');
    if (!(await ui.confirm({ title: 'Ajouter ces décisions à tes engagements ?', text: `${list.length} opération(s) planifiée(s) seront créées. Elles alimenteront tes prévisions et ne seront considérées comme exécutées qu'après confirmation.`, confirmLabel: 'Planifier' }))) return;
    const at = nowIso();
    for (const op of list) {
      const amt = L.conv(op.amount, main, acc.currency);
      const r: Rule = { id: uid(), label: op.label, kind: 'expense', amount: amt, accountId: acc.id, freq: 'once', interval: 1, startDate: op.date, certainty: 'certaine', essential: false, active: true, createdAt: at, updatedAt: at };
      if (op.kindHint === 'remboursement' && op.linkId) { r.kind = 'debt_repay'; r.debtId = op.linkId; r.essential = true; }
      else if (op.kindHint === 'epargne' && op.linkId) { r.kind = 'saving'; r.goalId = op.linkId; }
      else if (op.kindHint === 'projet' && op.linkId) {
        const pa = s.accounts.find((a) => a.projectId === op.linkId && !a.archived);
        if (pa) { r.kind = 'transfer'; r.toAccountId = pa.id; } else { r.categoryId = 'proj-presta'; }
        r.projectId = op.linkId;
      } else r.categoryId = 'divers';
      await save('rules', r, `Décision planifiée : ${op.label}`);
    }
    setApplied(true);
    ui.toast('Décisions planifiées');
  }

  const linkOptions = (k: Op['kindHint']) => k === 'remboursement' ? s.debts.filter((d) => d.direction === 'dette' && !d.archived).map((d) => ({ value: d.id, label: d.person })) : k === 'epargne' ? o.goals : k === 'projet' ? o.projects : [];

  return (
    <div className="space-y-5">
      <PageHeader title="Centre de décision" subtitle="Rassemble tes décisions financières, observe leurs conséquences combinées et obtiens un calendrier réaliste. Rien n'est écrit dans tes comptes tant que tu ne valides pas." />
      <Card title="Mes décisions envisagées" action={<Button size="sm" icon={<Plus size={14} />} onClick={() => setOps([...ops, { id: uid(), label: 'Nouvelle décision', kindHint: 'autre', amount: 5000, date: t0, direction: 'out', mode: 'comptant', priority: 2 }])}>Ajouter</Button>} pad={false}>
        <div className="px-4 pb-3 sm:px-5">
          <Table head={['Décision', 'Type', 'Lien', 'Montant', 'Date souhaitée', 'Au plus tard', 'Priorité', '']}>
            {ops.map((op) => (
              <tr key={op.id}>
                <td className={td}><Input className="h-8 min-w-40" value={op.label} onChange={(e) => set(op.id, { label: e.target.value })} /></td>
                <td className={td}><Select className="h-8 min-w-32" value={op.kindHint} onChange={(e) => set(op.id, { kindHint: e.target.value as Op['kindHint'], linkId: undefined })} options={KINDS} /></td>
                <td className={td}>{linkOptions(op.kindHint).length ? <Select className="h-8 min-w-32" value={op.linkId ?? ''} onChange={(e) => set(op.id, { linkId: e.target.value || undefined })} options={[{ value: '', label: '—' }, ...linkOptions(op.kindHint)]} /> : <span className="text-xs text-slate-400">—</span>}</td>
                <td className={td + ' min-w-32'}><MoneyInput value={op.amount} onChange={(v) => set(op.id, { amount: v ?? 0 })} currency={main} /></td>
                <td className={td}><Input type="date" className="h-8" value={op.date} onChange={(e) => set(op.id, { date: e.target.value, earliest: e.target.value })} /></td>
                <td className={td}><Input type="date" className="h-8" value={op.latest ?? ''} onChange={(e) => set(op.id, { latest: e.target.value || null })} /></td>
                <td className={td}><Select className="h-8 w-28" value={String(op.priority ?? 2)} onChange={(e) => set(op.id, { priority: Number(e.target.value) as 1 })} options={[{ value: '1', label: 'Haute' }, { value: '2', label: 'Moyenne' }, { value: '3', label: 'Basse' }]} /></td>
                <td className={td}><button className="rounded p-1.5 text-slate-400 hover:text-rose-600" onClick={() => setOps(ops.filter((x) => x.id !== op.id))}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Si tout est fait aux dates choisies">
          <div className="mb-3 flex items-center gap-3"><LevelBadge level={levelOf(asIs.min.value, L)} /><span className="text-sm">Point bas : <b className="num">{fmt(asIs.min.value, main)}</b> le {fmtDate(asIs.min.date)}</span></div>
          <Table head={['Décision', 'Conséquence', 'Montant']}>
            {ops.map((op) => <tr key={op.id}><td className={td + ' font-medium'}>{op.label}</td><td className={td + ' text-sm text-slate-600 dark:text-slate-300'}>{EFFECT[op.kindHint]}</td><td className={td + ' text-right'}><Money v={-op.amount} cur={main} colored /></td></tr>)}
            <tr><td className={td + ' font-semibold'}>Total</td><td className={td} /><td className={td + ' text-right font-semibold'}><Money v={-ops.reduce((a, x) => a + x.amount, 0)} cur={main} /></td></tr>
          </Table>
          <p className="mt-3 text-xs text-slate-500">Endettement après remboursements : {fmt(Math.max(0, L.totalDebts() - ops.filter((x) => x.kindHint === 'remboursement').reduce((a, x) => a + x.amount, 0)), main)} (actuellement {fmt(L.totalDebts(), main)}).</p>
        </Card>
        <Card title="Calendrier alternatif proposé" action={<Toggle checked={prudent} onChange={setPrudent} label="Marge prudente" />}>
          <p className="mb-3 text-sm text-slate-500">Chaque décision est placée, par ordre de priorité, à la première date où ton disponible reste au-dessus {prudent ? 'du seuil prudent' : 'du seuil de sécurité'} ({fmt(opt.target, main)}) sur toute la période.</p>
          <ul className="space-y-3">
            {calendar.map(([k, items]) => (
              <li key={k}><div className="text-sm font-semibold capitalize">{monthLabel(k)}</div><ul className="mt-1 space-y-1">{items.map((i, j) => <li key={j} className="flex justify-between text-sm"><span>{i.label}</span><Money v={i.amount} cur={main} /></li>)}</ul></li>
            ))}
            {opt.placed.filter((p) => !p.date).map((p) => <li key={p.op.id} className="text-sm text-rose-600">{p.op.label} : non finançable sur 18 mois avec ce montant.</li>)}
          </ul>
          <Table className="mt-3" head={['Décision', 'Date proposée', 'Décalage', 'Niveau']}>
            {opt.placed.map((p) => <tr key={p.op.id}><td className={td}>{p.op.label}</td><td className={td + ' text-xs'}>{p.date ? fmtDate(p.date, 'long') : '—'}</td><td className={td + ' text-xs'}>{p.date ? (p.shiftDays ? `+${p.shiftDays} j` : 'aucun') : '—'}</td><td className={td}><LevelBadge level={p.level} /></td></tr>)}
          </Table>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="soft" icon={<Wand2 size={15} />} onClick={() => setOps(ops.map((x) => { const p = opt.placed.find((y) => y.op.id === x.id); return p?.date ? { ...x, date: p.date, earliest: p.date } : x; }))}>Reprendre ces dates</Button>
            <Button variant="primary" icon={<Check size={15} />} disabled={applied} onClick={() => applyPlan(true)}>{applied ? 'Planifié' : 'Planifier ce calendrier'}</Button>
          </div>
        </Card>
      </div>
      <Card title="Trajectoire du disponible">
        <LinesChart data={chart} cur={main} threshold={s.settings.safetyThreshold} lines={[{ key: 'Sans décision', name: 'Sans décision', color: '#94a3b8', dashed: true }, { key: 'Tout aux dates choisies', name: 'Dates choisies', color: '#f43f5e' }, { key: 'Calendrier proposé', name: 'Calendrier proposé', color: '#10b981' }]} />
        <div className="mt-3 flex flex-wrap items-center gap-2"><Input className="h-8 max-w-56 text-sm" value={name} onChange={(e) => setName(e.target.value)} /><Button size="sm" icon={<Save size={14} />} onClick={async () => { await save('scenarios', { id: uid(), name, createdAt: nowIso(), ops, changes: [], kind: 'decision' }, 'Plan enregistré'); ui.toast('Plan enregistré'); }}>Enregistrer ce plan</Button><Button size="sm" variant="ghost" onClick={() => applyPlan(false)}>Planifier aux dates choisies</Button></div>
      </Card>
      <SavedScenarios kind="decision" onLoad={(sc) => { setOps(sc.ops.map((x) => ({ kindHint: 'autre', ...x })) as Op[]); setName(sc.name); }} />
    </div>
  );
}
