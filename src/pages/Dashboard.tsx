import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, ChevronRight, Wallet, Calculator, MessageCircle, Plus } from 'lucide-react';
import { useData } from '../state';
import { Badge, Button, Card, Money, PageHeader, Progress, Stat, Tabs, cx, LevelBadge } from '../ui/ui';
import { BalanceChart, BarsChart, DonutChart } from '../ui/charts';
import { ExecuteForm } from '../ui/forms';
import { computeAlerts } from '../engine/insights';
import { endOfMonthScenarios, project } from '../engine/projection';
import { pendingOccurrences, type PendingOcc } from '../engine/recurrence';
import { addDays, endOfMonth, fmtDate, monthLabel, startOfMonth } from '../engine/date';
import { fmt } from '../engine/money';

const HORIZONS = [{ value: '30', label: '30 j' }, { value: '90', label: '3 mois' }, { value: '180', label: '6 mois' }, { value: '365', label: '1 an' }];

export default function Dashboard() {
  const { s, L, main } = useData();
  const nav = useNavigate();
  const [h, setH] = useState('90');
  const [exec, setExec] = useState<PendingOcc | null>(null);
  const M = (v: number) => fmt(v, main);
  const ref = L.ref;
  const som = startOfMonth(ref), eom = endOfMonth(ref);

  const data = useMemo(() => {
    const avail = L.available();
    const rav = L.resteAVivre();
    const alerts = computeAlerts(L);
    const income = L.incomeBetween(som, eom), expense = L.expenseBetween(som, eom);
    const days = Number(h);
    const proj = project(L, { days });
    const low = project(L, { days, scenario: 'pessimiste' });
    const high = project(L, { days, scenario: 'optimiste' });
    const past = L.liquidHistory(days);
    const alloc = L.liquidAllocations();
    const chart = [
      ...past.slice(0, -1).map((p) => ({ date: p.date, past: p.value - alloc, free: null as number | null })),
      ...proj.days.map((d, i) => ({ date: d.date, past: i === 0 ? proj.startFree : null, free: d.free, low: low.days[i]?.free, high: high.days[i]?.free })),
    ];
    const byCat = [...L.expenseByCategory(som, eom)].map(([k, v]) => { const c = s.categories.find((x) => x.id === k); return { name: c?.name ?? 'Sans catégorie', value: v, color: c?.color ?? '#94a3b8' }; }).sort((a, b) => b.value - a.value);
    const months = L.monthSeries(6).map((m) => ({ label: monthLabel(m.key).split(' ')[0].slice(0, 4) + '.', Revenus: m.income, Dépenses: m.expense }));
    const upcoming = pendingOccurrences(L.activeRules(), s.occurrences, ref, addDays(ref, 14), 120, ref);
    const eomSc = endOfMonthScenarios(L);
    const budgets = s.budgets.filter((b) => b.active && !b.projectId && b.period === 'monthly').map((b) => ({ b, u: L.budgetUsage(b), name: b.categoryId ? s.categories.find((c) => c.id === b.categoryId)?.name ?? '?' : 'Global' })).sort((a, b) => b.u.pct - a.u.pct);
    const commit30 = L.capByDebt(pendingOccurrences(L.activeRules(), s.occurrences, ref, addDays(ref, 30), 120, ref).filter((p) => p.rule.kind !== 'income' && p.rule.kind !== 'loan_back' && L.isPersonal(p.rule.accountId))).total;
    return { avail, rav, alerts, income, expense, proj, chart, byCat, months, upcoming, eomSc, budgets, commit30 };
  }, [L, h, s, ref, som, eom]);

  const { avail, rav } = data;
  const hello = new Date().getHours() < 18 ? 'Bonjour' : 'Bonsoir';
  const lvlTone = avail.value < 0 ? 'bad' : avail.value < s.settings.safetyThreshold ? 'warn' : 'good';

  return (
    <div className="space-y-5">
      <PageHeader title={`${hello}${s.settings.userName ? ' ' + s.settings.userName : ''}`} subtitle={`Situation au ${fmtDate(ref, 'long')}`}
        actions={<>
          <Button variant="ghost" icon={<MessageCircle size={16} />} onClick={() => nav('/assistant')}>Poser une question</Button>
          <Button icon={<Calculator size={16} />} onClick={() => nav('/simulations')}>Simuler un achat</Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => window.dispatchEvent(new Event('finpilot:add'))}>Opération</Button>
        </>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" pad={false}>
          <div className="grid gap-0 sm:grid-cols-2">
            <div className="border-b border-slate-100 p-5 sm:border-b-0 sm:border-r dark:border-slate-800">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Disponible réel</div>
              <div className={cx('num mt-1 text-4xl font-semibold tracking-tight', lvlTone === 'bad' ? 'text-rose-600' : lvlTone === 'warn' ? 'text-amber-600' : 'text-slate-900 dark:text-white')}>{M(avail.value)}</div>
              <p className="mt-1 text-xs text-slate-500">Ce que tu peux dépenser {avail.next ? `d'ici le ${fmtDate(avail.next.date, 'day')}` : `jusqu'au ${fmtDate(avail.until, 'day')}`} sans toucher à tes obligations ni à ta réserve.</p>
              <dl className="mt-4 space-y-1.5 text-sm">
                <Row k="Liquidités sur les comptes" v={M(avail.liquid)} />
                <Row k="− Épargne affectée" v={M(-avail.alloc)} muted />
                <Row k={`− Engagements jusqu'au ${fmtDate(avail.until, 'day')}`} v={M(-avail.commitments)} muted />
                <Row k="− Réserve de sécurité" v={M(-avail.reserve)} muted />
              </dl>
              {avail.next && <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">Prochain revenu certain : <b>{avail.next.label}</b> {M(avail.next.amount)} le {fmtDate(avail.next.date, 'day')}</div>}
            </div>
            <div className="p-5">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Reste à vivre mensuel</div>
              <div className={cx('num mt-1 text-3xl font-semibold tracking-tight', rav.reste < 0 ? 'text-rose-600' : '')}>{M(rav.reste)}</div>
              <p className="mt-1 text-xs text-slate-500">Revenus certains moins obligations récurrentes, par mois.</p>
              <div className="scroll-thin mt-3 max-h-48 space-y-1 overflow-y-auto pr-1 text-sm">
                <Row k="Revenus mensuels" v={M(rav.totalIncome)} strong />
                {rav.charges.sort((a, b) => b.amount - a.amount).map((c, i) => <Row key={i} k={c.label} v={M(-c.amount)} muted badge={c.kind !== 'Charge' ? c.kind : undefined} />)}
              </div>
              <Link to="/engagements" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">Gérer les engagements <ChevronRight size={14} /></Link>
            </div>
          </div>
        </Card>
        <Card title="Alertes" subtitle="Analyse automatique de tes données" pad={false}>
          <ul className="scroll-thin max-h-[360px] divide-y divide-slate-100 overflow-y-auto px-4 pb-3 dark:divide-slate-800">
            {data.alerts.map((a) => (
              <li key={a.id}>
                <button onClick={() => a.to && nav(a.to)} className="flex w-full items-start gap-2.5 py-2.5 text-left">
                  {a.level === 'danger' ? <AlertOctagon size={16} className="mt-0.5 shrink-0 text-rose-500" /> : a.level === 'warning' ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" /> : a.level === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" /> : <Info size={16} className="mt-0.5 shrink-0 text-sky-500" />}
                  <span className="min-w-0"><span className="block text-sm font-medium">{a.title}</span>{a.detail && <span className="block text-xs text-slate-500">{a.detail}</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Solde total (liquidités)" value={M(L.liquidTotal())} hint={`dont espèces ${M(L.cashTotal())}`} onClick={() => nav('/comptes')} />
        <Stat label="Revenus du mois" value={M(data.income)} tone="good" hint={`Dépenses : ${M(data.expense)}`} onClick={() => nav('/analyses')} />
        <Stat label="Épargne totale" value={M(L.totalSavings())} onClick={() => nav('/epargne')} />
        <Stat label="Engagements à 30 jours" value={M(data.commit30)} tone="warn" onClick={() => nav('/engagements')} />
        <Stat label="Dettes restantes" value={M(L.totalDebts())} tone={L.totalDebts() > 0 ? 'bad' : 'default'} onClick={() => nav('/dettes')} />
        <Stat label="Créances à récupérer" value={M(L.totalClaims())} onClick={() => nav('/dettes')} />
        <Stat label="Patrimoine financier net" value={M(L.netWorth())} tone="brand" hint="comptes + créances − dettes" />
        <Stat label="Prévision fin de mois" value={M(data.eomSc[1].end.free)} hint={<span>disponible · <LevelBadge level={data.eomSc[1].level} /></span>} onClick={() => nav('/planification')} />
      </div>

      <Card title="Évolution et prévision du solde disponible" subtitle={`Point bas prévu : ${M(data.proj.min.value)} le ${fmtDate(data.proj.min.date, 'long')} · dépenses variables estimées ${M(data.proj.variableDaily)}/jour`} action={<Tabs value={h} onChange={setH} items={HORIZONS} />}>
        <BalanceChart data={data.chart} cur={main} threshold={s.settings.safetyThreshold} splitDate={ref} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Dépenses par catégorie · ${monthLabel(ref.slice(0, 7))}`} subtitle="Consommation personnelle (hors transferts, apports projets et remboursements)">
          {data.byCat.length ? <DonutChart data={data.byCat} cur={main} /> : <p className="py-8 text-center text-sm text-slate-500">Aucune dépense ce mois-ci.</p>}
        </Card>
        <Card title="Revenus et dépenses sur 6 mois">
          <BarsChart data={data.months} cur={main} bars={[{ key: 'Revenus', name: 'Revenus', color: '#10b981' }, { key: 'Dépenses', name: 'Dépenses', color: '#f43f5e' }]} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="À venir sur 14 jours" className="lg:col-span-2" action={<Link to="/calendrier" className="text-xs font-medium text-brand-600 hover:underline">Calendrier</Link>} pad={false}>
          {data.upcoming.length ? (
            <ul className="divide-y divide-slate-100 px-4 pb-2 dark:divide-slate-800 sm:px-5">
              {data.upcoming.slice(0, 10).map((p) => {
                const inc = p.rule.kind === 'income' || p.rule.kind === 'loan_back';
                return (
                  <li key={p.rule.id + p.date} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.rule.label}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">{fmtDate(p.date, 'day')}{p.status === 'en_retard' && <Badge tone="red">En retard</Badge>}{p.status === 'partielle' && <Badge tone="amber">Partiel</Badge>}{p.status === 'due' && <Badge tone="blue">Aujourd'hui</Badge>}{inc && p.rule.certainty !== 'certaine' && <Badge>{p.rule.certainty}</Badge>}</div>
                    </div>
                    <div className="flex items-center gap-2"><Money v={(inc ? 1 : -1) * p.remaining} cur={L.accCur(p.rule.accountId)} colored />
                      {p.date <= addDays(ref, 3) && <Button size="sm" variant="soft" onClick={() => setExec(p)}>{inc ? 'Reçu' : 'Payé'}</Button>}</div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="px-5 pb-5 text-sm text-slate-500">Rien de prévu. Ajoute tes revenus et charges récurrents dans « Engagements ».</p>}
        </Card>
        <Card title="Fin de mois : 3 scénarios" subtitle={`au ${fmtDate(eom, 'long')}`}>
          <div className="space-y-3">
            {data.eomSc.map((x) => (
              <div key={x.scenario} className="flex items-center justify-between">
                <div><div className="text-sm font-medium">{({ optimiste: 'Optimiste', realiste: 'Réaliste', pessimiste: 'Pessimiste' } as Record<string, string>)[x.scenario]}</div><div className="text-xs text-slate-500">point bas {M(x.min.value)}</div></div>
                <div className="text-right"><div className="num font-semibold">{M(x.end.free)}</div><LevelBadge level={x.level} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Comptes" action={<Link to="/comptes" className="text-xs font-medium text-brand-600 hover:underline">Tout voir</Link>}>
          <ul className="space-y-2.5">
            {s.accounts.filter((a) => !a.archived).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: a.color ?? '#64748b' }}><Wallet size={15} /></span>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{a.name}</span><span className="block text-xs text-slate-500">{a.projectId ? 'Projet' : a.liquid ? 'Disponible' : 'Épargne'}{a.currency !== main ? ` · ≈ ${M(L.balanceMain(a.id))}` : ''}</span></span></span>
                <Money v={L.balances.get(a.id) ?? 0} cur={a.currency} className="text-sm font-semibold" />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Budget prévu et réel du mois" action={<Link to="/budgets" className="text-xs font-medium text-brand-600 hover:underline">Budgets</Link>}>
          {data.budgets.length ? (
            <ul className="space-y-3">
              {data.budgets.slice(0, 6).map(({ b, u, name }) => (
                <li key={b.id}>
                  <div className="mb-1 flex justify-between text-sm"><span>{name}</span><span className="num text-slate-500"><span className={u.pct > 1 ? 'font-semibold text-rose-600' : ''}>{M(u.spent)}</span> / {M(u.limit)}</span></div>
                  <Progress value={u.pct} />
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">Aucun budget défini.</p>}
        </Card>
      </div>
      <ExecuteForm open={!!exec} onClose={() => setExec(null)} rule={exec?.rule} date={exec?.date} remaining={exec?.remaining} />
    </div>
  );
}

function Row({ k, v, muted, strong, badge }: { k: string; v: string; muted?: boolean; strong?: boolean; badge?: string }) {
  return <div className="flex items-center justify-between gap-3"><dt className={cx('min-w-0 truncate', muted ? 'text-slate-500' : '', strong && 'font-medium')}>{k}{badge && <Badge className="ml-1.5" tone="violet">{badge}</Badge>}</dt><dd className={cx('num shrink-0', strong && 'font-semibold')}>{v}</dd></div>;
}
