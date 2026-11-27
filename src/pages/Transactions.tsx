import { useMemo, useState } from 'react';
import { Search, Download, Pencil, Trash2, Paperclip, Plus, ArrowRight, FileSpreadsheet } from 'lucide-react';
import { useData, useOptions } from '../state';
import { Badge, Button, Card, Empty, Input, Money, PageHeader, Select, Stat, useUI, download } from '../ui/ui';
import { TxForm, KIND_LABEL } from '../ui/forms';
import { deleteTx } from '../db/repo';
import { addDays, endOfMonth, fmtDate, startOfMonth } from '../engine/date';
import { fmt, toMajor } from '../engine/money';
import { exportRows } from '../ui/exporters';
import type { Tx } from '../engine/types';

const PERIODS = [
  { value: 'month', label: 'Ce mois' }, { value: 'last', label: 'Mois dernier' }, { value: '30', label: '30 derniers jours' },
  { value: '90', label: '3 derniers mois' }, { value: 'year', label: 'Cette année' }, { value: 'all', label: 'Tout' }, { value: 'custom', label: 'Personnalisée' },
];

export default function Transactions() {
  const { s, L, main } = useData();
  const o = useOptions();
  const ui = useUI();
  const [period, setPeriod] = useState('month');
  const [from, setFrom] = useState(startOfMonth(L.ref));
  const [to, setTo] = useState(endOfMonth(L.ref));
  const [kind, setKind] = useState('');
  const [acc, setAcc] = useState('');
  const [cat, setCat] = useState('');
  const [proj, setProj] = useState('');
  const [q, setQ] = useState('');
  const [min, setMin] = useState('');
  const [edit, setEdit] = useState<Partial<Tx> | null>(null);
  const [limit, setLimit] = useState(200);

  const range = useMemo(() => {
    const r = L.ref;
    switch (period) {
      case 'month': return [startOfMonth(r), endOfMonth(r)];
      case 'last': { const p = addDays(startOfMonth(r), -1); return [startOfMonth(p), endOfMonth(p)]; }
      case '30': return [addDays(r, -29), r];
      case '90': return [addDays(r, -89), r];
      case 'year': return [r.slice(0, 4) + '-01-01', r.slice(0, 4) + '-12-31'];
      case 'all': return ['0000-01-01', '9999-12-31'];
      default: return [from, to];
    }
  }, [period, from, to, L.ref]);

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const mn = Number(min.replace(',', '.'));
    return s.txs.filter((t) => {
      if (t.date < range[0] || t.date > range[1]) return false;
      if (kind && t.kind !== kind) return false;
      if (acc && t.accountId !== acc && t.toAccountId !== acc) return false;
      if (cat && t.categoryId !== cat) return false;
      if (proj && t.projectId !== proj) return false;
      if (min && Number.isFinite(mn) && toMajor(t.amount, L.accCur(t.accountId)) < mn) return false;
      if (qq && !`${t.label} ${t.payee ?? ''} ${t.notes ?? ''} ${o.cat(t.categoryId)?.name ?? ''}`.toLowerCase().includes(qq)) return false;
      return true;
    }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt)));
  }, [s.txs, range, kind, acc, cat, proj, q, min, o, L]);

  const totals = useMemo(() => {
    let inc = 0, exp = 0, neutral = 0;
    for (const t of list) { const c = L.classify(t); const v = L.txMain(t); if (c === 'revenu') inc += v; else if (c === 'depense') exp += v; else neutral += v; }
    return { inc, exp, neutral };
  }, [list, L]);

  const groups = useMemo(() => {
    const g: { date: string; items: Tx[] }[] = [];
    for (const t of list.slice(0, limit)) { const last = g[g.length - 1]; if (last && last.date === t.date) last.items.push(t); else g.push({ date: t.date, items: [t] }); }
    return g;
  }, [list, limit]);

  const rows = () => list.map((t) => ({
    Date: t.date, Type: KIND_LABEL[t.kind], Libellé: t.label, 'Bénéficiaire/Source': t.payee ?? '', Compte: o.accName(t.accountId), 'Vers compte': t.toAccountId ? o.accName(t.toAccountId) : '',
    Catégorie: o.cat(t.categoryId)?.name ?? '', Montant: toMajor(t.amount, L.accCur(t.accountId)) * (L.classify(t) === 'revenu' || t.kind === 'debt_borrow' || t.kind === 'loan_back' ? 1 : -1), Devise: L.accCur(t.accountId),
    [`Montant (${main})`]: toMajor(L.txMain(t), main), Projet: s.projects.find((p) => p.id === t.projectId)?.name ?? '', Mode: t.method ?? '', Priorité: t.priority ?? '', Commentaire: t.notes ?? '',
  }));

  async function del(t: Tx) {
    if (await ui.confirm({ title: 'Supprimer cette opération ?', text: `${t.label} · ${fmt(t.amount, L.accCur(t.accountId))} du ${fmtDate(t.date)}. Les soldes, dettes et échéances liées seront recalculés. L'opération reste tracée dans le journal.`, danger: true, confirmLabel: 'Supprimer' })) {
      await deleteTx(t); ui.toast('Opération supprimée');
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Transactions" subtitle="Revenus, dépenses, transferts et mouvements de dettes réellement exécutés"
        actions={<>
          <Button icon={<Download size={16} />} onClick={() => download(exportRows(rows(), 'csv'), `finpilot-transactions-${range[0]}.csv`)}>CSV</Button>
          <Button icon={<FileSpreadsheet size={16} />} onClick={() => download(exportRows(rows(), 'xlsx'), `finpilot-transactions-${range[0]}.xlsx`)}>Excel</Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEdit({})}>Nouvelle opération</Button>
        </>} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Revenus" value={fmt(totals.inc, main)} tone="good" />
        <Stat label="Dépenses (consommation)" value={fmt(totals.exp, main)} tone="bad" />
        <Stat label="Solde de la période" value={fmt(totals.inc - totals.exp, main, { sign: true })} hint={`${list.length} opération(s)`} />
      </div>
      <Card pad>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative lg:col-span-2"><Search size={16} className="absolute left-3 top-3 text-slate-400" /><Input className="pl-9" placeholder="Rechercher libellé, bénéficiaire, note…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select value={period} onChange={(e) => setPeriod(e.target.value)} options={PERIODS} />
          <Select value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: 'Tous les types' }, ...Object.entries(KIND_LABEL).map(([k, v]) => ({ value: k, label: v }))]} />
          <Select value={acc} onChange={(e) => setAcc(e.target.value)} options={[{ value: '', label: 'Tous les comptes' }, ...s.accounts.map((a) => ({ value: a.id, label: a.name }))]} />
          <Select value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: 'Toutes catégories' }, ...o.catOpts('all')]} />
          {period === 'custom' && <><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></>}
          {o.projects.length > 0 && <Select value={proj} onChange={(e) => setProj(e.target.value)} options={[{ value: '', label: 'Tous projets' }, ...o.projects]} />}
          <Input placeholder="Montant minimum" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
        </div>
      </Card>
      {!list.length ? (
        <Card><Empty title="Aucune opération" text="Modifie les filtres ou enregistre ta première opération (raccourci : touche N)." action={<Button variant="primary" onClick={() => setEdit({})}>Ajouter</Button>} /></Card>
      ) : (
        <Card pad={false}>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {groups.map((g) => (
              <div key={g.date}>
                <div className="sticky top-12 z-10 bg-slate-50/95 px-4 py-1.5 text-xs font-medium text-slate-500 backdrop-blur lg:top-0 dark:bg-slate-950/90 sm:px-5">{fmtDate(g.date, 'day')} {g.date.slice(0, 4)}</div>
                {g.items.map((t) => {
                  const c = o.cat(t.categoryId);
                  const cls = L.classify(t);
                  const sign = t.kind === 'transfer' ? 0 : ['revenu', 'dette', 'recouvrement', 'retour_projet'].includes(cls) || (cls === 'hors_perimetre' && (t.kind === 'income')) ? 1 : -1;
                  return (
                    <div key={t.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5 dark:hover:bg-slate-800/40">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base" style={{ background: (c?.color ?? '#94a3b8') + '22' }}>{t.kind === 'transfer' ? '⇄' : c?.icon ?? (sign > 0 ? '↓' : '↑')}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 truncate text-sm font-medium">{t.label}{t.docIds?.length ? <Paperclip size={12} className="text-slate-400" /> : null}</div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <span>{o.accName(t.accountId)}{t.toAccountId && <> <ArrowRight size={10} className="inline" /> {o.accName(t.toAccountId)}</>}</span>
                          {c && <span>· {c.name}</span>}{t.payee && <span>· {t.payee}</span>}
                          {t.kind !== 'income' && t.kind !== 'expense' && <Badge tone="blue">{KIND_LABEL[t.kind]}</Badge>}
                          {cls === 'apport_projet' && <Badge tone="violet">Apport projet</Badge>}
                          {cls === 'hors_perimetre' && <Badge tone="violet">Projet</Badge>}
                          {t.projectId && cls !== 'apport_projet' && cls !== 'hors_perimetre' && <Badge tone="violet">{s.projects.find((p) => p.id === t.projectId)?.name}</Badge>}
                          {t.ruleId && <Badge>planifiée</Badge>}
                        </div>
                      </div>
                      <div className="text-right">
                        <Money v={sign === 0 ? t.amount : sign * t.amount} cur={L.accCur(t.accountId)} colored={sign !== 0} className="text-sm font-semibold" />
                        {t.toAmount && t.toAccountId && L.accCur(t.toAccountId) !== L.accCur(t.accountId) && <div className="text-[11px] text-slate-500">→ {fmt(t.toAmount, L.accCur(t.toAccountId))}</div>}
                      </div>
                      <div className="flex gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                        <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" onClick={() => setEdit(t)} aria-label="Modifier"><Pencil size={15} /></button>
                        <button className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" onClick={() => del(t)} aria-label="Supprimer"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {list.length > limit && <div className="p-4 text-center"><Button onClick={() => setLimit(limit + 300)}>Afficher plus ({list.length - limit} restantes)</Button></div>}
        </Card>
      )}
      <TxForm open={!!edit} onClose={() => setEdit(null)} initial={edit ?? undefined} />
    </div>
  );
}
