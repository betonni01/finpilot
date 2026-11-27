import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../state';
import { Badge, Card, LevelBadge, Money, PageHeader, Stat, Tabs, Table, Toggle, td } from '../ui/ui';
import { BalanceChart } from '../ui/charts';
import { addDays, addMonths, endOfMonth, fmtDate, monthLabel } from '../engine/date';
import { fmt, sum } from '../engine/money';
import { capacity, dateForAmount, levelOf, project } from '../engine/projection';
import { pendingOccurrences } from '../engine/recurrence';

const H = [['7', '7 jours'], ['30', '30 jours'], ['90', '3 mois'], ['180', '6 mois'], ['365', '1 an'], ['1095', '3 ans'], ['1825', '5 ans']].map(([value, label]) => ({ value, label }));

export default function Planning() {
  const { s, L, main } = useData();
  const [h, setH] = useState('180');
  const [variable, setVariable] = useState(true);
  const days = Number(h);
  const M = (v: number) => fmt(v, main);
  const data = useMemo(() => {
    const r = project(L, { days, includeVariable: variable });
    const lo = project(L, { days, scenario: 'pessimiste', includeVariable: variable });
    const hi = project(L, { days, scenario: 'optimiste', includeVariable: variable });
    const step = days > 400 ? 7 : 1;
    const chart = r.days.filter((_, i) => i % step === 0).map((d) => { const i = r.days.indexOf(d); return { date: d.date, free: d.free, balance: d.balance, low: lo.days[i].free, high: hi.days[i].free }; });
    // tableau mensuel
    const months: { key: string; end: number; free: number; inflow: number; outflow: number; variable: number }[] = [];
    let cur = '';
    for (const d of r.days) {
      const k = d.date.slice(0, 7);
      if (k !== cur) { months.push({ key: k, end: 0, free: 0, inflow: 0, outflow: 0, variable: 0 }); cur = k; }
      const m = months[months.length - 1];
      m.end = d.balance; m.free = d.free; m.variable += d.variable;
      for (const e of d.events) { if (e.free > 0) m.inflow += e.free; else m.outflow += e.free; }
    }
    return { r, lo, hi, chart, months };
  }, [L, days, variable]);
  const cap = useMemo(() => capacity(L, 365), [L]);
  const debtsPlan = s.debts.filter((d) => d.direction === 'dette' && !d.archived && L.debtRemaining(d) > 0).map((d) => {
    const rem = L.debtRemaining(d);
    const rules = L.activeRules().filter((r) => r.debtId === d.id);
    const occ = pendingOccurrences(rules, s.occurrences, L.ref, addDays(L.ref, 3650), 0, L.ref);
    let acc = 0, date: string | null = null;
    for (const o of occ) { acc += L.conv(o.remaining, L.accCur(o.rule.accountId), d.currency); if (acc >= rem) { date = o.date; break; } }
    return { d, rem, date: date ?? (rules.length ? null : d.dueDate ?? null), planned: rules.length > 0 };
  });
  const allDebtsDate = debtsPlan.length && debtsPlan.every((x) => x.date) ? debtsPlan.map((x) => x.date!).sort().slice(-1)[0] : null;
  const saving12 = sum(s.goals.filter((g) => !g.archived).map((g) => L.conv(L.goalSaved(g), g.currency))) + sum(pendingOccurrences(L.activeRules().filter((r) => r.kind === 'saving'), s.occurrences, L.ref, addMonths(L.ref, 12), 0, L.ref).map((o) => L.conv(o.remaining, L.accCur(o.rule.accountId))));
  const in3 = project(L, { days: 92 });
  const wishes = s.wishes.filter((w) => w.status === 'envie' || w.status === 'planifie');

  return (
    <div className="space-y-5">
      <PageHeader title="Planification financière" subtitle="Projection jour par jour : les dates réelles des revenus, charges, remboursements et épargnes sont prises en compte." actions={<Toggle checked={variable} onChange={setVariable} label="Inclure les dépenses variables estimées" />} />
      <Tabs value={h} onChange={setH} items={H} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Disponible dans ${H.find((x) => x.value === h)?.label}`} value={M(data.r.end.free)} tone={data.r.end.free < 0 ? 'bad' : 'brand'} hint={`solde total ${M(data.r.end.balance)}`} />
        <Stat label="Point bas sur la période" value={M(data.r.min.value)} tone={data.r.min.value < s.settings.safetyThreshold ? 'bad' : 'good'} hint={<span>le {fmtDate(data.r.min.date)} · <LevelBadge level={levelOf(data.r.min.value, L)} /></span>} />
        <Stat label="Fourchette à l'horizon" value={<span className="text-base">{M(data.lo.end.free)} → {M(data.hi.end.free)}</span>} hint="pessimiste → optimiste" />
        <Stat label="Dépenses variables estimées" value={M(data.r.variableDaily) + '/j'} hint={data.r.variableSource} />
      </div>
      <Card title="Trajectoire projetée" subtitle="Vert : disponible (scénario réaliste) · bleu : solde total · pointillés : scénarios optimiste et pessimiste">
        <BalanceChart data={data.chart} cur={main} threshold={s.settings.safetyThreshold} height={300} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Questions de planification">
          <ul className="space-y-3 text-sm">
            <li><div className="font-medium">Combien aurai-je dans trois mois ?</div><div className="text-slate-600 dark:text-slate-300">{M(in3.end.free)} disponibles ({M(in3.end.balance)} au total) le {fmtDate(addDays(L.ref, 91), 'long')}.</div></li>
            <li><div className="font-medium">Quand pourrai-je rembourser toutes mes dettes ?</div><div className="text-slate-600 dark:text-slate-300">{!debtsPlan.length ? 'Aucune dette en cours.' : allDebtsDate ? `D'après tes échéanciers, le ${fmtDate(allDebtsDate, 'long')}.` : "Certaines dettes n'ont pas d'échéancier suffisant : crée-en un dans « Dettes »."}</div>
              {debtsPlan.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-slate-500">{debtsPlan.map((x) => <li key={x.d.id}>{x.d.person} ({fmt(x.rem, x.d.currency)}) : {x.date ? fmtDate(x.date) : 'non planifié'}{!x.planned && x.d.dueDate ? ' (échéance)' : ''}</li>)}</ul>}</li>
            <li><div className="font-medium">Combien aurai-je économisé dans un an ?</div><div className="text-slate-600 dark:text-slate-300">{M(saving12)} affectés à tes objectifs si les versements programmés sont respectés.</div></li>
            {wishes.slice(0, 3).map((w) => { const d = dateForAmount(cap, L.conv(w.price, w.currency), true); return <li key={w.id}><div className="font-medium">À quelle date pourrai-je acheter « {w.name} » ?</div><div className="text-slate-600 dark:text-slate-300">{d ? `De façon raisonnable à partir du ${fmtDate(d, 'long')}.` : 'Pas dans les 12 prochains mois sans changement.'}</div></li>; })}
            <li><div className="font-medium">Puis-je financer plusieurs projets ou achats simultanément ?</div><div className="text-slate-600 dark:text-slate-300">Utilise le <Link to="/decision" className="font-medium text-brand-600 hover:underline">centre de décision</Link> pour tester la combinaison et obtenir un calendrier.</div></li>
            <li><div className="font-medium">Quel sera mon solde si je déménage ?</div><div className="text-slate-600 dark:text-slate-300">Voir le <Link to="/simulations" className="font-medium text-brand-600 hover:underline">simulateur de déménagement</Link> (onglet « Changement de situation »).</div></li>
          </ul>
        </Card>
        <Card title="Projection mois par mois" pad={false}>
          <div className="scroll-thin max-h-[420px] overflow-y-auto px-4 pb-3 sm:px-5">
            <Table head={['Mois', 'Entrées', 'Sorties', 'Variables', 'Disponible fin']}>
              {data.months.map((m) => <tr key={m.key}><td className={td + ' capitalize'}>{monthLabel(m.key)}</td><td className={td}><Money v={m.inflow} cur={main} className="text-emerald-600" /></td><td className={td}><Money v={m.outflow} cur={main} className="text-rose-600" /></td><td className={td}><Money v={-m.variable} cur={main} className="text-slate-500" /></td><td className={td + ' font-semibold'}><Money v={m.free} cur={main} colored={m.free < 0} />{m.free < s.settings.safetyThreshold && <Badge tone="red" className="ml-1">seuil</Badge>}</td></tr>)}
            </Table>
          </div>
        </Card>
      </div>
      <Card title="Prochaines opérations prévues" pad={false}>
        <div className="px-4 pb-3 sm:px-5">
          <Table head={['Date', 'Opération', 'Effet sur le disponible']}>
            {data.r.events.filter((e) => e.date <= endOfMonth(addMonths(L.ref, 1))).slice(0, 40).map((e, i) => <tr key={i}><td className={td + ' text-xs'}>{fmtDate(e.date, 'day')}</td><td className={td}>{e.label}{e.source === 'retard' && <Badge tone="red" className="ml-1">retard</Badge>}{e.source === 'dette' && <Badge tone="amber" className="ml-1">échéance</Badge>}</td><td className={td + ' text-right'}><Money v={e.free} cur={main} colored /></td></tr>)}
          </Table>
        </div>
      </Card>
    </div>
  );
}
