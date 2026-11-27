import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Wand2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useData, useOptions } from '../state';
import { Badge, Button, Card, Empty, Field, Modal, Money, MoneyInput, PageHeader, Progress, Select, Stat, Toggle, Table, td, useUI } from '../ui/ui';
import { BarsChart } from '../ui/charts';
import { remove, save } from '../db/repo';
import { nowIso, uid } from '../db/db';
import { addDays, addMonths, endOfMonth, monthLabel, startOfMonth } from '../engine/date';
import { fmt, sum } from '../engine/money';
import type { Budget } from '../engine/types';

export default function Budgets() {
  const { s, L, main } = useData();
  const o = useOptions();
  const ui = useUI();
  const [form, setForm] = useState<Partial<Budget> | null>(null);
  const [offset, setOffset] = useState(0);
  const ref = offset === 0 ? L.ref : endOfMonth(addMonths(startOfMonth(L.ref), offset));
  const name = (b: Budget) => (b.categoryId ? o.cat(b.categoryId ?? undefined)?.name ?? '?' : 'Budget global') + (b.projectId ? ` · ${s.projects.find((p) => p.id === b.projectId)?.name}` : '') + (b.accountId ? ` · ${o.accName(b.accountId)}` : '');
  const rows = useMemo(() => s.budgets.filter((b) => b.active).map((b) => ({ b, u: L.budgetUsage(b, ref) })).sort((a, b) => b.u.pct - a.u.pct), [s.budgets, L, ref]);
  const monthly = rows.filter((r) => r.b.period === 'monthly' && r.b.categoryId && !r.b.projectId);
  const totalBudget = sum(monthly.map((r) => r.u.limit)), totalSpent = sum(monthly.map((r) => r.u.spent));

  const history = useMemo(() => {
    const out: Record<string, unknown>[] = [];
    for (let i = 5; i >= 0; i--) {
      const r = endOfMonth(addMonths(startOfMonth(L.ref), -i));
      const bs = s.budgets.filter((b) => b.active && b.period === 'monthly' && b.categoryId && !b.projectId);
      out.push({ label: monthLabel(r.slice(0, 7)).slice(0, 4) + '.', Prévu: sum(bs.map((b) => b.amount)), Réel: sum(bs.map((b) => L.budgetUsage(b, r).spent)) });
    }
    return out;
  }, [s.budgets, L]);

  async function suggest() {
    const from = startOfMonth(addMonths(startOfMonth(L.ref), -3)), to = addDays(startOfMonth(L.ref), -1);
    const byCat = L.expenseByCategory(from, to);
    const existing = new Set(s.budgets.filter((b) => b.active && b.period === 'monthly').map((b) => b.categoryId));
    const ruled = new Set(L.activeRules().map((r) => r.categoryId));
    let n = 0;
    for (const [k, v] of byCat) {
      if (k === 'sans' || existing.has(k) || ruled.has(k)) continue;
      const avg = Math.round(v / 3 / 500) * 500;
      if (avg < 1000) continue;
      await save('budgets', { id: uid(), categoryId: k, amount: avg, period: 'monthly', rollover: false, active: true, createdAt: nowIso() }, 'Budget suggéré');
      n++;
    }
    ui.toast(n ? `${n} budget(s) créés d'après tes 3 derniers mois` : 'Aucune nouvelle suggestion (historique insuffisant ou budgets déjà définis)', n ? 'ok' : 'info');
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Budgets" subtitle={`Alertes à ${s.settings.budgetAlerts.join(' %, ')} %`}
        actions={<><Button icon={<Wand2 size={16} />} onClick={suggest}>Suggérer d'après mes dépenses</Button><Button variant="primary" icon={<Plus size={16} />} onClick={() => setForm({})}>Nouveau budget</Button></>} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" icon={<ChevronLeft size={16} />} onClick={() => setOffset(offset - 1)} />
        <span className="min-w-36 text-center text-sm font-medium capitalize">{monthLabel(ref.slice(0, 7))}</span>
        <Button size="sm" variant="ghost" icon={<ChevronRight size={16} />} onClick={() => setOffset(Math.min(0, offset + 1))} disabled={offset >= 0} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Budgets mensuels (catégories)" value={fmt(totalBudget, main)} />
        <Stat label="Dépensé" value={fmt(totalSpent, main)} tone={totalSpent > totalBudget ? 'bad' : 'default'} />
        <Stat label="Reste" value={fmt(totalBudget - totalSpent, main)} tone={totalBudget - totalSpent < 0 ? 'bad' : 'good'} />
      </div>
      {!rows.length ? <Card><Empty title="Aucun budget" text="Fixe une enveloppe par catégorie (courses, loisirs…) ou un budget global. FINPILOT t'alerte à chaque palier." action={<Button variant="primary" onClick={() => setForm({})}>Créer un budget</Button>} /></Card> : (
        <Card pad={false}>
          <div className="px-4 pb-3 sm:px-5">
            <Table head={['Budget', 'Période', 'Consommation', 'Dépensé', 'Limite', 'Reste', '']}>
              {rows.map(({ b, u }) => (
                <tr key={b.id}>
                  <td className={td}><div className="font-medium">{o.cat(b.categoryId ?? undefined)?.icon} {name(b)}</div>{b.rollover && <Badge tone="blue">report {u.carry ? fmt(u.carry, main) : ''}</Badge>}</td>
                  <td className={td + ' text-xs'}>{b.period === 'monthly' ? 'Mensuel' : b.period === 'weekly' ? 'Hebdomadaire' : 'Annuel'}</td>
                  <td className={td + ' w-40'}><Progress value={u.pct} /><div className="mt-0.5 text-[11px] text-slate-500">{Math.round(u.pct * 100)} %</div></td>
                  <td className={td}><Money v={u.spent} cur={main} /></td>
                  <td className={td}><Money v={u.limit} cur={main} /></td>
                  <td className={td}><Money v={u.left} cur={main} colored className="font-semibold" /></td>
                  <td className={td + ' whitespace-nowrap text-right'}>
                    <button className="rounded p-1.5 text-slate-400 hover:text-slate-700" onClick={() => setForm(b)}><Pencil size={15} /></button>
                    <button className="rounded p-1.5 text-slate-400 hover:text-rose-600" onClick={async () => { if (await ui.confirm({ title: 'Supprimer ce budget ?', danger: true })) await remove('budgets', b.id, 'Budget supprimé'); }}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      )}
      <Card title="Prévu et réel sur 6 mois" subtitle="Budgets mensuels par catégorie"><BarsChart data={history} cur={main} bars={[{ key: 'Prévu', name: 'Prévu', color: '#94a3b8' }, { key: 'Réel', name: 'Réel', color: '#0ea5e9' }]} /></Card>
      <BudgetForm initial={form} onClose={() => setForm(null)} />
    </div>
  );
}

function BudgetForm({ initial, onClose }: { initial: Partial<Budget> | null; onClose: () => void }) {
  const { main } = useData();
  const o = useOptions();
  const ui = useUI();
  const [b, setB] = useState<Partial<Budget>>({});
  useEffect(() => { if (initial) setB({ period: 'monthly', rollover: false, active: true, categoryId: null, ...initial }); }, [initial]);
  const set = (p: Partial<Budget>) => setB((x) => ({ ...x, ...p }));
  async function submit() {
    if (!b.amount) return ui.toast('Montant requis', 'err');
    await save('budgets', { id: uid(), createdAt: nowIso(), ...b } as Budget, initial?.id ? 'Budget modifié' : 'Budget créé');
    ui.toast('Budget enregistré'); onClose();
  }
  return (
    <Modal open={!!initial} onClose={onClose} title={initial?.id ? 'Modifier le budget' : 'Nouveau budget'} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={submit}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <Field label="Catégorie"><Select value={b.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value || null })} options={[{ value: '', label: 'Budget global (toutes dépenses)' }, ...o.catOpts('expense')]} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant"><MoneyInput value={b.amount ?? null} onChange={(v) => set({ amount: v ?? 0 })} currency={main} /></Field>
          <Field label="Période"><Select value={b.period} onChange={(e) => set({ period: e.target.value as Budget['period'] })} options={[{ value: 'weekly', label: 'Hebdomadaire' }, { value: 'monthly', label: 'Mensuel' }, { value: 'yearly', label: 'Annuel' }]} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Limiter à un compte"><Select value={b.accountId ?? ''} onChange={(e) => set({ accountId: e.target.value || null })} options={[{ value: '', label: 'Tous' }, ...o.accounts]} /></Field>
          <Field label="Budget de projet"><Select value={b.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || null })} options={[{ value: '', label: 'Non (personnel)' }, ...o.projects]} /></Field>
        </div>
        <Toggle checked={!!b.rollover} onChange={(v) => set({ rollover: v })} label="Reporter l'excédent du mois précédent" />
      </div>
    </Modal>
  );
}
