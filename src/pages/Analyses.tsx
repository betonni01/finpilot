import { useMemo, useState } from 'react';
import { Printer, FileSpreadsheet, Download } from 'lucide-react';
import { useData, useOptions } from '../state';
import { Badge, Button, Card, Field, Input, Money, PageHeader, Select, Stat, Tabs, Table, Toggle, td, download, cx } from '../ui/ui';
import { BarsChart, DonutChart, LinesChart } from '../ui/charts';
import { accountBalances } from '../engine/ledger';
import { addDays, addMonths, endOfMonth, fmtDate, monthLabel, startOfMonth, weekday, DAYS_FR } from '../engine/date';
import { fmt, sum, toMajor } from '../engine/money';
import { exportSheets, exportRows } from '../ui/exporters';
import { KIND_LABEL } from '../ui/forms';

export default function Analyses() {
  const [tab, setTab] = useState<'stats' | 'mensuel' | 'annuel' | 'exports'>('stats');
  return (
    <div className="space-y-5">
      <PageHeader title="Analyses et rapports" subtitle="Statistiques, rapports mensuels et annuels, exports PDF, Excel et CSV" />
      <div className="no-print"><Tabs value={tab} onChange={setTab} items={[{ value: 'stats', label: 'Statistiques' }, { value: 'mensuel', label: 'Rapport mensuel' }, { value: 'annuel', label: 'Rapport annuel' }, { value: 'exports', label: 'Exports' }]} /></div>
      {tab === 'stats' && <Stats />}
      {tab === 'mensuel' && <Monthly />}
      {tab === 'annuel' && <Yearly />}
      {tab === 'exports' && <Exports />}
    </div>
  );
}

function Stats() {
  const { s, L, main } = useData();
  const o = useOptions();
  const [months, setMonths] = useState('3');
  const n = Number(months);
  const ref = L.ref;
  const cur = { from: startOfMonth(ref), to: endOfMonth(ref) };
  const prevFrom = startOfMonth(addMonths(startOfMonth(ref), -n)), prevTo = addDays(startOfMonth(ref), -1);
  const now = L.expenseByCategory(cur.from, cur.to), prev = L.expenseByCategory(prevFrom, prevTo);
  const keys = [...new Set([...now.keys(), ...prev.keys()])];
  const rows = keys.map((k) => { const a = now.get(k) ?? 0, b = (prev.get(k) ?? 0) / n; return { k, name: o.cat(k)?.name ?? 'Sans catégorie', icon: o.cat(k)?.icon, a, b, d: b ? (a - b) / b : null }; }).sort((x, y) => y.a - x.a);
  const period = { from: addDays(ref, -89), to: ref };
  const exp = s.txs.filter((t) => t.date >= period.from && t.date <= period.to && L.classify(t) === 'depense');
  const payees = [...exp.reduce((m, t) => m.set(t.payee || t.label, (m.get(t.payee || t.label) ?? 0) + L.txMain(t)), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const prio = ['essentielle', 'utile', 'confort', ''].map((p) => ({ name: p ? p[0].toUpperCase() + p.slice(1) : 'Non renseignée', value: sum(exp.filter((t) => (t.priority ?? '') === p).map((t) => L.txMain(t))), color: { essentielle: '#0ea5e9', utile: '#10b981', confort: '#f59e0b', '': '#cbd5e1' }[p]! })).filter((x) => x.value);
  const wd = DAYS_FR.map((d, i) => ({ label: d, Dépenses: Math.round(sum(exp.filter((t) => weekday(t.date) === i).map((t) => L.txMain(t))) / 13) }));
  const byAcc = s.accounts.filter((a) => !a.projectId).map((a, i) => ({ name: a.name, value: sum(exp.filter((t) => t.accountId === a.id).map((t) => L.txMain(t))), color: a.color ?? ['#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6'][i % 4] })).filter((x) => x.value);
  const series = L.monthSeries(12).map((m) => ({ label: monthLabel(m.key).slice(0, 4) + '. ' + m.key.slice(2, 4), Revenus: m.income, Dépenses: m.expense, Solde: m.net }));
  const avgIn = sum(series.slice(-4, -1).map((x) => x.Revenus)) / 3, avgOut = sum(series.slice(-4, -1).map((x) => x.Dépenses)) / 3;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenus moyens (3 derniers mois)" value={fmt(Math.round(avgIn), main)} tone="good" />
        <Stat label="Dépenses moyennes (3 derniers mois)" value={fmt(Math.round(avgOut), main)} tone="bad" />
        <Stat label="Taux d'épargne moyen" value={avgIn ? `${Math.round(((avgIn - avgOut) / avgIn) * 100)} %` : '—'} hint="(revenus − consommation) / revenus" />
        <Stat label="Dépense moyenne par jour" value={fmt(Math.round(sum(exp.map((t) => L.txMain(t))) / 90), main)} hint="90 derniers jours" />
      </div>
      <Card title="Revenus, dépenses et solde mensuel (12 mois)"><BarsChart data={series} cur={main} bars={[{ key: 'Revenus', name: 'Revenus', color: '#10b981' }, { key: 'Dépenses', name: 'Dépenses', color: '#f43f5e' }]} /></Card>
      <Card title="Comparaison avec les mois précédents" action={<Select className="h-8 w-44 text-xs" value={months} onChange={(e) => setMonths(e.target.value)} options={[{ value: '1', label: 'vs mois dernier' }, { value: '3', label: 'vs moyenne 3 mois' }, { value: '6', label: 'vs moyenne 6 mois' }]} />} pad={false}>
        <div className="px-4 pb-3 sm:px-5"><Table head={['Catégorie', 'Ce mois', 'Référence', 'Évolution']}>
          {rows.map((r) => <tr key={r.k}><td className={td}>{r.icon} {r.name}</td><td className={td}><Money v={r.a} cur={main} className="font-medium" /></td><td className={td}><Money v={Math.round(r.b)} cur={main} className="text-slate-500" /></td><td className={td}>{r.d == null ? <Badge>nouveau</Badge> : <Badge tone={r.d > 0.25 ? 'red' : r.d < -0.1 ? 'green' : 'slate'}>{r.d > 0 ? '+' : ''}{Math.round(r.d * 100)} %</Badge>}</td></tr>)}
        </Table></div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Dépenses par priorité (90 jours)">{prio.length ? <DonutChart data={prio} cur={main} height={180} /> : <p className="text-sm text-slate-500">Aucune donnée.</p>}</Card>
        <Card title="Dépenses par compte (90 jours)">{byAcc.length ? <DonutChart data={byAcc} cur={main} height={180} /> : <p className="text-sm text-slate-500">Aucune donnée.</p>}</Card>
        <Card title="Bénéficiaires principaux (90 jours)"><ul className="space-y-1.5 text-sm">{payees.map(([k, v]) => <li key={k} className="flex justify-between"><span className="truncate">{k}</span><Money v={v} cur={main} /></li>)}</ul></Card>
        <Card title="Dépense moyenne par jour de la semaine"><BarsChart data={wd} cur={main} height={200} bars={[{ key: 'Dépenses', name: 'Moyenne hebdomadaire', color: '#0ea5e9' }]} /></Card>
      </div>
    </div>
  );
}

function Monthly() {
  const { s, L, main } = useData();
  const o = useOptions();
  const [month, setMonth] = useState(addDays(startOfMonth(L.ref), -1).slice(0, 7));
  const from = month + '-01', to = endOfMonth(from);
  const M = (v: number) => fmt(v, main);
  const txs = s.txs.filter((t) => t.date >= from && t.date <= to);
  const income = L.incomeBetween(from, to), expense = L.expenseBetween(from, to);
  const byCat = [...L.expenseByCategory(from, to)].sort((a, b) => b[1] - a[1]);
  const incByCat = [...txs.filter((t) => L.classify(t) === 'revenu').reduce((m, t) => m.set(t.categoryId ?? 'sans', (m.get(t.categoryId ?? 'sans') ?? 0) + L.txMain(t)), new Map<string, number>())];
  const saved = sum(s.goalMoves.filter((m) => m.date >= from && m.date <= to).map((m) => { const g = s.goals.find((x) => x.id === m.goalId); return g ? L.conv(m.amount, g.currency) : 0; }));
  const repaid = sum(txs.filter((t) => t.kind === 'debt_repay' && L.isPersonal(t.accountId)).map((t) => L.txMain(t)));
  const recovered = sum(txs.filter((t) => t.kind === 'loan_back').map((t) => L.txMain(t)));
  const cotis = sum(txs.filter((t) => t.cotisationId).map((t) => L.txMain(t)));
  const proj = sum(txs.filter((t) => L.classify(t) === 'apport_projet').map((t) => L.txMain(t)));
  const balEnd = accountBalances(s.accounts, s.txs, to), balStart = accountBalances(s.accounts, s.txs, addDays(from, -1));
  const liquidIds = s.accounts.filter((a) => !a.projectId && a.liquid).map((a) => a.id);
  const tot = (m: Map<string, number>, ids: string[]) => sum(ids.map((id) => L.conv(m.get(id) ?? 0, L.accCur(id))));
  const months = Array.from({ length: 18 }, (_, i) => addMonths(startOfMonth(L.ref), -i).slice(0, 7));
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end gap-3"><Field label="Mois"><Select value={month} onChange={(e) => setMonth(e.target.value)} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} /></Field><Button icon={<Printer size={16} />} onClick={() => window.print()}>Imprimer / PDF</Button></div>
      <Card className="print-area">
        <div className="mb-4 flex items-end justify-between border-b border-slate-100 pb-3 dark:border-slate-800"><div><div className="text-xs uppercase tracking-wide text-slate-500">Rapport mensuel FINPILOT</div><h2 className="text-xl font-semibold capitalize">{monthLabel(month)}</h2></div><div className="text-right text-xs text-slate-500">{s.settings.userName}<br />édité le {fmtDate(L.ref, 'long')}</div></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Revenus" value={M(income)} tone="good" /><Stat label="Dépenses" value={M(expense)} tone="bad" /><Stat label="Solde du mois" value={M(income - expense)} /><Stat label="Liquidités fin de mois" value={M(tot(balEnd, liquidIds))} hint={`début : ${M(tot(balStart, liquidIds))}`} />
          <Stat label="Épargne versée" value={M(saved)} /><Stat label="Dettes remboursées" value={M(repaid)} /><Stat label="Créances récupérées" value={M(recovered)} /><Stat label="Cotisations · apports projets" value={`${M(cotis)} · ${M(proj)}`} />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div><h3 className="mb-2 text-sm font-semibold">Dépenses par catégorie</h3><Table head={['Catégorie', 'Montant', '%']}>{byCat.map(([k, v]) => <tr key={k}><td className={td}>{o.cat(k)?.name ?? 'Sans catégorie'}</td><td className={td}><Money v={v} cur={main} /></td><td className={td + ' text-xs text-slate-500'}>{expense ? Math.round((v / expense) * 100) : 0} %</td></tr>)}</Table></div>
          <div><h3 className="mb-2 text-sm font-semibold">Revenus par source</h3><Table head={['Source', 'Montant']}>{incByCat.map(([k, v]) => <tr key={k}><td className={td}>{o.cat(k)?.name ?? 'Autres revenus'}</td><td className={td}><Money v={v} cur={main} /></td></tr>)}</Table>
            <h3 className="mb-2 mt-5 text-sm font-semibold">Situation à la fin du mois</h3>
            <Table head={['Élément', 'Montant']}>
              {s.accounts.filter((a) => !a.archived).map((a) => <tr key={a.id}><td className={td}>{a.name}</td><td className={td}><Money v={balEnd.get(a.id) ?? 0} cur={a.currency} /></td></tr>)}
              <tr><td className={td}>Dettes restantes (aujourd'hui)</td><td className={td}><Money v={-L.totalDebts()} cur={main} /></td></tr>
              <tr><td className={td}>Créances (aujourd'hui)</td><td className={td}><Money v={L.totalClaims()} cur={main} /></td></tr>
            </Table></div>
        </div>
        {s.projects.length > 0 && <div className="mt-5"><h3 className="mb-2 text-sm font-semibold">Projets (cumul)</h3><Table head={['Projet', 'Dépenses', 'Recettes', 'Trésorerie', 'Résultat']}>{s.projects.filter((p) => !p.archived).map((p) => { const st = L.projectStats(p); return <tr key={p.id}><td className={td}>{p.name}</td><td className={td}><Money v={st.expenses} cur={p.currency} /></td><td className={td}><Money v={st.revenues} cur={p.currency} /></td><td className={td}><Money v={st.treasury} cur={p.currency} /></td><td className={td}><Money v={st.result} cur={p.currency} colored /></td></tr>; })}</Table></div>}
      </Card>
    </div>
  );
}

function Yearly() {
  const { s, L, main } = useData();
  const [year, setYear] = useState(L.ref.slice(0, 4));
  const years = [...new Set([L.ref.slice(0, 4), ...s.txs.map((t) => t.date.slice(0, 4))])].sort().reverse();
  const data = useMemo(() => {
    const out: Record<string, number | string>[] = [];
    for (let m = 1; m <= 12; m++) {
      const from = `${year}-${String(m).padStart(2, '0')}-01`; const to = endOfMonth(from);
      if (from > L.ref) break;
      const bal = accountBalances(s.accounts, s.txs, to);
      const assets = sum(s.accounts.filter((a) => !a.projectId).map((a) => L.conv(bal.get(a.id) ?? 0, a.currency)));
      const debtAt = (dir: 'dette' | 'creance') => sum(s.debts.filter((d) => d.direction === dir && d.createdAt <= to).map((d) => { const paid = sum(s.txs.filter((t) => t.debtId === d.id && t.date <= to && t.kind === (dir === 'dette' ? 'debt_repay' : 'loan_back')).map((t) => L.conv(t.amount, L.accCur(t.accountId), d.currency))); return L.conv(Math.max(0, d.initialAmount - paid), d.currency); }));
      const debts = debtAt('dette'), claims = debtAt('creance');
      const income = L.incomeBetween(from, to), expense = L.expenseBetween(from, to);
      out.push({ label: monthLabel(from.slice(0, 7)).slice(0, 4) + '.', Revenus: income, Dépenses: expense, 'Capacité d\'épargne': income - expense, Patrimoine: assets + claims - debts, Endettement: debts });
    }
    return out;
  }, [s, L, year]);
  const ti = sum(data.map((d) => d.Revenus as number)), te = sum(data.map((d) => d.Dépenses as number));
  return (
    <div className="space-y-4">
      <div className="no-print flex items-end gap-3"><Field label="Année"><Select value={year} onChange={(e) => setYear(e.target.value)} options={years.map((y) => ({ value: y, label: y }))} /></Field><Button icon={<Printer size={16} />} onClick={() => window.print()}>Imprimer / PDF</Button></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Revenus ${year}`} value={fmt(ti, main)} tone="good" /><Stat label={`Dépenses ${year}`} value={fmt(te, main)} tone="bad" />
        <Stat label="Capacité d'épargne" value={fmt(ti - te, main)} hint={ti ? `${Math.round(((ti - te) / ti) * 100)} % des revenus` : undefined} />
        <Stat label="Patrimoine net (dernier mois)" value={fmt((data[data.length - 1]?.Patrimoine as number) ?? 0, main)} tone="brand" />
      </div>
      <Card title="Revenus et dépenses"><BarsChart data={data} cur={main} bars={[{ key: 'Revenus', name: 'Revenus', color: '#10b981' }, { key: 'Dépenses', name: 'Dépenses', color: '#f43f5e' }]} /></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Évolution du patrimoine financier"><LinesChart data={data} cur={main} lines={[{ key: 'Patrimoine', name: 'Patrimoine net', color: '#0f766e' }]} /></Card>
        <Card title="Évolution de l'endettement"><LinesChart data={data} cur={main} lines={[{ key: 'Endettement', name: 'Dettes restantes', color: '#f43f5e' }]} /></Card>
      </div>
      <Card title="Capacité d'épargne mensuelle"><BarsChart data={data} cur={main} bars={[{ key: "Capacité d'épargne", name: "Capacité d'épargne", color: '#0ea5e9' }]} /></Card>
      {s.projects.length > 0 && <Card title="Rentabilité des projets"><Table head={['Projet', 'Budget', 'Dépensé', 'Recettes', 'Financements', 'Résultat']}>{s.projects.map((p) => { const st = L.projectStats(p); return <tr key={p.id}><td className={td}>{p.name}</td><td className={td}><Money v={p.budget} cur={p.currency} /></td><td className={td}><Money v={st.expenses} cur={p.currency} /></td><td className={td}><Money v={st.revenues} cur={p.currency} /></td><td className={td}><Money v={st.financing} cur={p.currency} /></td><td className={td}><Money v={st.result} cur={p.currency} colored /></td></tr>; })}</Table></Card>}
    </div>
  );
}

function Exports() {
  const { s, L, main } = useData();
  const o = useOptions();
  const [from, setFrom] = useState(L.ref.slice(0, 4) + '-01-01');
  const [to, setTo] = useState(L.ref);
  const [sets, setSets] = useState({ txs: true, accounts: true, rules: true, debts: true, goals: true, cotis: true, projects: true, budgets: true });
  const build = () => {
    const sh: { name: string; rows: Record<string, string | number>[] }[] = [];
    if (sets.txs) sh.push({ name: 'Transactions', rows: s.txs.filter((t) => t.date >= from && t.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1)).map((t) => ({ Date: t.date, Type: KIND_LABEL[t.kind], Libellé: t.label, Bénéficiaire: t.payee ?? '', Compte: o.accName(t.accountId), 'Vers': t.toAccountId ? o.accName(t.toAccountId) : '', Catégorie: o.cat(t.categoryId)?.name ?? '', Montant: toMajor(t.amount, L.accCur(t.accountId)), Devise: L.accCur(t.accountId), [`En ${main}`]: toMajor(L.txMain(t), main), Projet: s.projects.find((p) => p.id === t.projectId)?.name ?? '', Note: t.notes ?? '' })) });
    if (sets.accounts) sh.push({ name: 'Comptes', rows: s.accounts.map((a) => ({ Compte: a.name, Établissement: a.institution ?? '', Type: a.type, Devise: a.currency, 'Solde initial': toMajor(a.initialBalance, a.currency), 'Solde actuel': toMajor(L.balances.get(a.id) ?? 0, a.currency), Ouverture: a.openedAt, Statut: a.archived ? 'archivé' : 'actif' })) });
    if (sets.rules) sh.push({ name: 'Engagements', rows: s.rules.map((r) => ({ Nom: r.label, Type: r.kind, Montant: toMajor(r.amount, L.accCur(r.accountId)), Devise: L.accCur(r.accountId), Fréquence: r.freq, Début: r.startDate, Fin: r.endDate ?? '', Actif: r.active ? 'oui' : 'non' })) });
    if (sets.debts) sh.push({ name: 'Dettes et créances', rows: s.debts.map((d) => ({ Sens: d.direction, Personne: d.person, Initial: toMajor(d.initialAmount, d.currency), Remboursé: toMajor(L.debtPaid(d), d.currency), Reste: toMajor(L.debtRemaining(d), d.currency), Devise: d.currency, Échéance: d.dueDate ?? '', Taux: d.rate ?? 0 })) });
    if (sets.goals) sh.push({ name: 'Épargne', rows: s.goals.map((g) => ({ Objectif: g.name, Cible: toMajor(g.target, g.currency), Épargné: toMajor(L.goalSaved(g), g.currency), Devise: g.currency, Échéance: g.deadline ?? '' })) });
    if (sets.cotis) sh.push({ name: 'Cotisations', rows: s.cotisPayments.filter((p) => p.date >= from && p.date <= to).map((p) => { const c = s.cotisations.find((x) => x.id === p.cotisationId); return { Cotisation: c?.name ?? '', Participant: c?.participants.find((x) => x.id === p.participantId)?.name ?? '', Période: p.period, Date: p.date, Montant: toMajor(p.amount, c?.currency ?? main) }; }) });
    if (sets.projects) sh.push({ name: 'Projets', rows: s.projects.map((p) => { const st = L.projectStats(p); return { Projet: p.name, Statut: p.status, Budget: toMajor(p.budget, p.currency), Dépenses: toMajor(st.expenses, p.currency), Recettes: toMajor(st.revenues, p.currency), Financements: toMajor(st.financing, p.currency), Trésorerie: toMajor(st.treasury, p.currency), Résultat: toMajor(st.result, p.currency), Devise: p.currency }; }) });
    if (sets.budgets) sh.push({ name: 'Budgets', rows: s.budgets.map((b) => { const u = L.budgetUsage(b); return { Catégorie: b.categoryId ? o.cat(b.categoryId)?.name ?? '' : 'Global', Période: b.period, Limite: toMajor(u.limit, main), Dépensé: toMajor(u.spent, main), Reste: toMajor(u.left, main) }; }) });
    return sh;
  };
  const labels: Record<keyof typeof sets, string> = { txs: 'Transactions (période)', accounts: 'Comptes', rules: 'Engagements', debts: 'Dettes et créances', goals: 'Épargne', cotis: 'Cotisations (période)', projects: 'Projets', budgets: 'Budgets' };
  return (
    <Card title="Exporter les données" subtitle="Choisis la période et les données à inclure">
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Du"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Au"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">{(Object.keys(sets) as (keyof typeof sets)[]).map((k) => <Toggle key={k} checked={sets[k]} onChange={(v) => setSets({ ...sets, [k]: v })} label={labels[k]} />)}</div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="primary" icon={<FileSpreadsheet size={16} />} onClick={() => download(exportSheets(build()), `finpilot-export-${from}-${to}.xlsx`)}>Excel (un onglet par donnée)</Button>
        <Button icon={<Download size={16} />} onClick={() => { const t = build()[0]; if (t) download(exportRows(t.rows, 'csv'), `finpilot-${t.name}.csv`); }}>CSV (première sélection)</Button>
        <Button icon={<Printer size={16} />} onClick={() => window.print()}>PDF (impression)</Button>
      </div>
      <p className={cx('mt-3 text-xs text-slate-500')}>Pour une sauvegarde complète restaurable (y compris documents), utilise « Paramètres › Sauvegarde ».</p>
    </Card>
  );
}
