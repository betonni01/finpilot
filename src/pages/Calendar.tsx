import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useData } from '../state';
import { Badge, Button, Card, Money, PageHeader, Tabs, cx } from '../ui/ui';
import { ExecuteForm } from '../ui/forms';
import { addDays, addMonths, DAYS_FR, endOfMonth, fmtDate, monthLabel, startOfMonth, startOfWeek, today } from '../engine/date';
import { occurrenceDates, occId, type PendingOcc } from '../engine/recurrence';
import type { Rule } from '../engine/types';

type EvType = 'revenu' | 'charge' | 'remboursement' | 'cotisation' | 'epargne' | 'projet' | 'echeance' | 'reel';
interface Ev { date: string; type: EvType; label: string; amount?: number; cur?: string; status?: 'paid' | 'partial' | 'cancelled' | 'pending' | 'late'; rule?: Rule; remaining?: number }
const TYPE_META: Record<EvType, { label: string; color: string }> = {
  revenu: { label: 'Revenus', color: 'bg-emerald-500' }, charge: { label: 'Factures et charges', color: 'bg-rose-500' }, remboursement: { label: 'Remboursements', color: 'bg-violet-500' },
  cotisation: { label: 'Cotisations', color: 'bg-amber-500' }, epargne: { label: 'Épargne', color: 'bg-teal-500' }, projet: { label: 'Projets', color: 'bg-sky-500' },
  echeance: { label: 'Échéances (dettes, objectifs)', color: 'bg-orange-500' }, reel: { label: 'Opérations réelles', color: 'bg-slate-400' },
};

export default function CalendarPage() {
  const { s, L } = useData();
  const [view, setView] = useState<'mois' | 'semaine' | 'jour'>('mois');
  const [cursor, setCursor] = useState(today());
  const [sel, setSel] = useState(today());
  const [filters, setFilters] = useState<Record<EvType, boolean>>({ revenu: true, charge: true, remboursement: true, cotisation: true, epargne: true, projet: true, echeance: true, reel: false });
  const [exec, setExec] = useState<PendingOcc | null>(null);

  const range = view === 'mois' ? [startOfWeek(startOfMonth(cursor)), addDays(startOfWeek(endOfMonth(cursor)), 6)] : view === 'semaine' ? [startOfWeek(cursor), addDays(startOfWeek(cursor), 6)] : [cursor, cursor];
  const events = useMemo(() => {
    const out: Ev[] = [];
    const occ = new Map(s.occurrences.map((o) => [o.id, o]));
    for (const r of s.rules.filter((x) => x.active)) {
      const type: EvType = r.cotisationId ? 'cotisation' : r.projectId ? 'projet' : r.kind === 'income' || r.kind === 'loan_back' ? 'revenu' : r.kind === 'debt_repay' ? 'remboursement' : r.kind === 'saving' ? 'epargne' : 'charge';
      for (const d of occurrenceDates(r, range[0], range[1])) {
        const o = occ.get(occId(r.id, d));
        const status = o?.status === 'paid' ? 'paid' : o?.status === 'cancelled' ? 'cancelled' : o?.status === 'partial' ? 'partial' : d < L.ref ? 'late' : 'pending';
        if (status === 'late' && d < (r.createdAt?.slice(0, 10) ?? r.startDate)) continue;
        out.push({ date: d, type, label: r.label, amount: r.amount, cur: L.accCur(r.accountId), status, rule: r, remaining: r.amount - (o?.paidAmount ?? 0) });
      }
    }
    for (const d of s.debts) if (!d.archived && d.dueDate && d.dueDate >= range[0] && d.dueDate <= range[1]) out.push({ date: d.dueDate, type: 'echeance', label: `${d.direction === 'dette' ? 'Dette' : 'Créance'} : ${d.person}`, amount: L.debtRemaining(d), cur: d.currency });
    for (const g of s.goals) if (!g.archived && g.deadline && g.deadline >= range[0] && g.deadline <= range[1]) out.push({ date: g.deadline, type: 'echeance', label: `Objectif : ${g.name}`, amount: g.target, cur: g.currency });
    for (const p of s.projects) { if (p.archived) continue; if (p.startDate >= range[0] && p.startDate <= range[1]) out.push({ date: p.startDate, type: 'projet', label: `Lancement : ${p.name}` }); if (p.endDate && p.endDate >= range[0] && p.endDate <= range[1]) out.push({ date: p.endDate, type: 'projet', label: `Fin prévue : ${p.name}` }); }
    for (const t of s.txs) if (!t.ruleId && t.date >= range[0] && t.date <= range[1]) out.push({ date: t.date, type: 'reel', label: t.label, amount: t.amount, cur: L.accCur(t.accountId), status: 'paid' });
    return out.filter((e) => filters[e.type]);
  }, [s, L, range[0], range[1], filters]); // eslint-disable-line
  const byDay = useMemo(() => { const m = new Map<string, Ev[]>(); for (const e of events) m.set(e.date, [...(m.get(e.date) ?? []), e]); return m; }, [events]);
  const move = (n: number) => setCursor(view === 'mois' ? addMonths(startOfMonth(cursor), n) : addDays(cursor, n * (view === 'semaine' ? 7 : 1)));
  const days: string[] = [];
  for (let d = range[0]; d <= range[1]; d = addDays(d, 1)) days.push(d);
  const title = view === 'mois' ? monthLabel(cursor.slice(0, 7)) : view === 'semaine' ? `Semaine du ${fmtDate(range[0], 'long')}` : fmtDate(cursor, 'long');
  const selEvents = byDay.get(view === 'jour' ? cursor : sel) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Calendrier financier" subtitle="Salaires, factures, remboursements, cotisations, épargne, échéances de projets" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><Button size="sm" variant="ghost" icon={<ChevronLeft size={16} />} onClick={() => move(-1)} /><span className="min-w-44 text-center font-medium capitalize">{title}</span><Button size="sm" variant="ghost" icon={<ChevronRight size={16} />} onClick={() => move(1)} /><Button size="sm" onClick={() => { setCursor(today()); setSel(today()); }}>Aujourd'hui</Button></div>
        <Tabs value={view} onChange={setView} items={[{ value: 'mois', label: 'Mois' }, { value: 'semaine', label: 'Semaine' }, { value: 'jour', label: 'Jour' }]} />
      </div>
      <div className="flex flex-wrap gap-2">{(Object.keys(TYPE_META) as EvType[]).map((k) => <button key={k} onClick={() => setFilters({ ...filters, [k]: !filters[k] })} className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1', filters[k] ? 'bg-white ring-slate-300 dark:bg-slate-800 dark:ring-slate-600' : 'opacity-50 ring-slate-200 dark:ring-slate-800')}><span className={cx('h-2 w-2 rounded-full', TYPE_META[k].color)} />{TYPE_META[k].label}</button>)}</div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" pad={false}>
          {view !== 'jour' ? (
            <div className="p-2 sm:p-3">
              <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-medium text-slate-500">{DAYS_FR.map((d) => <div key={d}>{d}</div>)}</div>
              <div className="grid grid-cols-7 gap-1">
                {days.map((d) => {
                  const ev = byDay.get(d) ?? [];
                  const out = view === 'mois' && d.slice(0, 7) !== cursor.slice(0, 7);
                  return (
                    <button key={d} onClick={() => setSel(d)} className={cx('flex flex-col rounded-lg p-1 text-left ring-1 transition', view === 'mois' ? 'min-h-[74px]' : 'min-h-[220px]', sel === d ? 'ring-slate-900 dark:ring-white' : 'ring-slate-100 hover:ring-slate-300 dark:ring-slate-800', out && 'opacity-40', d === L.ref && 'bg-brand-50 dark:bg-brand-500/10')}>
                      <span className={cx('text-xs font-medium', d === L.ref && 'text-brand-700 dark:text-brand-400')}>{Number(d.slice(8))}</span>
                      <div className="mt-0.5 space-y-0.5 overflow-hidden">
                        {ev.slice(0, view === 'mois' ? 3 : 10).map((e, i) => <div key={i} className={cx('flex items-center gap-1 truncate text-[10px] leading-tight', e.status === 'cancelled' && 'line-through opacity-50')}><span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', TYPE_META[e.type].color)} /><span className="hidden truncate sm:inline">{e.label}</span></div>)}
                        {ev.length > (view === 'mois' ? 3 : 10) && <div className="text-[10px] text-slate-400">+{ev.length - 3}</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : <DayList events={selEvents} onExec={setExec} />}
        </Card>
        <Card title={fmtDate(view === 'jour' ? cursor : sel, 'long')} pad={false}><DayList events={selEvents} onExec={setExec} /></Card>
      </div>
      <ExecuteForm open={!!exec} onClose={() => setExec(null)} rule={exec?.rule} date={exec?.date} remaining={exec?.remaining} />
    </div>
  );
}

function DayList({ events, onExec }: { events: Ev[]; onExec: (p: PendingOcc) => void }) {
  if (!events.length) return <p className="px-5 pb-5 pt-2 text-sm text-slate-500">Aucune opération ce jour-là.</p>;
  return (
    <ul className="divide-y divide-slate-100 px-4 pb-2 dark:divide-slate-800 sm:px-5">
      {events.map((e, i) => {
        const inc = e.type === 'revenu';
        return (
          <li key={i} className="flex items-center justify-between gap-2 py-2.5">
            <div className="min-w-0"><div className="flex items-center gap-1.5 text-sm font-medium"><span className={cx('h-2 w-2 shrink-0 rounded-full', TYPE_META[e.type].color)} /><span className="truncate">{e.label}</span></div>
              <div className="mt-0.5 flex gap-1">{e.status === 'paid' && <Badge tone="green">exécutée</Badge>}{e.status === 'partial' && <Badge tone="amber">partielle</Badge>}{e.status === 'cancelled' && <Badge>annulée</Badge>}{e.status === 'late' && <Badge tone="red">en retard</Badge>}{e.status === 'pending' && <Badge tone="blue">prévue</Badge>}</div></div>
            <div className="flex items-center gap-2">{e.amount != null && e.cur && <Money v={(inc ? 1 : -1) * (e.status === 'partial' ? e.remaining ?? e.amount : e.amount)} cur={e.cur} colored={e.type !== 'echeance' && e.type !== 'reel'} className="text-sm" />}
              {e.rule && (e.status === 'pending' || e.status === 'late' || e.status === 'partial') && <Button size="sm" variant="soft" onClick={() => onExec({ rule: e.rule!, date: e.date, remaining: e.remaining ?? e.rule!.amount, overdue: e.status === 'late', status: 'planifiee' })}>{inc ? 'Reçu' : 'Payé'}</Button>}</div>
          </li>
        );
      })}
    </ul>
  );
}
