import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, FolderKanban, Wallet, CalendarPlus, FileSpreadsheet, Trash2, HandCoins } from 'lucide-react';
import { useData, useOptions } from '../state';
import { Badge, Button, Card, Empty, Field, Input, Modal, Money, MoneyInput, PageHeader, Progress, Select, Stat, Table, Textarea, td, useUI, currencyOptions, cx, download } from '../ui/ui';
import { RuleForm, TxForm, KIND_LABEL } from '../ui/forms';
import { LinesChart, DonutChart } from '../ui/charts';
import { save } from '../db/repo';
import { nowIso, uid } from '../db/db';
import { addDays, fmtDate, today } from '../engine/date';
import { fmt, toMajor } from '../engine/money';
import { pendingOccurrences } from '../engine/recurrence';
import { exportSheets } from '../ui/exporters';
import type { Account, Project, Rule, Tx } from '../engine/types';

const STATUS: Record<Project['status'], { label: string; tone: 'slate' | 'green' | 'amber' | 'blue' }> = { idee: { label: 'Idée', tone: 'slate' }, en_cours: { label: 'En cours', tone: 'green' }, suspendu: { label: 'Suspendu', tone: 'amber' }, termine: { label: 'Terminé', tone: 'blue' } };

export default function Projects() {
  const { s, L } = useData();
  const [form, setForm] = useState<Partial<Project> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const list = s.projects.filter((p) => !p.archived);
  const cur = s.projects.find((p) => p.id === sel);
  return (
    <div className="space-y-5">
      <PageHeader title="Projets" subtitle="Finances de chaque projet, séparées de tes finances personnelles. Un apport personnel est enregistré comme tel, pas comme une dépense ordinaire."
        actions={<>{cur && <Button onClick={() => setSel(null)}>Tous les projets</Button>}<Button variant="primary" icon={<Plus size={16} />} onClick={() => setForm({})}>Nouveau projet</Button></>} />
      {!cur && (!list.length ? <Card><Empty icon={<FolderKanban size={36} />} title="Aucun projet" text="Boutique, atelier, activité indépendante, projet associatif… Pilote le budget, les financements et la trésorerie de chacun." action={<Button variant="primary" onClick={() => setForm({})}>Créer un projet</Button>} /></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const st = L.projectStats(p);
            return (
              <button key={p.id} onClick={() => setSel(p.id)} className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/80 hover:ring-slate-300 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-slate-700">
                <div className="flex items-start justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.color ?? '#8b5cf6' }} /><span className="truncate font-medium">{p.name}</span></div><Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge></div>
                <div className="mt-1 truncate text-xs text-slate-500">{p.domain}{p.description ? ` · ${p.description}` : ''}</div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><div className="text-slate-500">Budget</div><div className="num font-semibold">{fmt(p.budget, p.currency, { compact: true })}</div></div><div><div className="text-slate-500">Dépensé</div><div className="num font-semibold">{fmt(st.expenses, p.currency, { compact: true })}</div></div><div><div className="text-slate-500">Trésorerie</div><div className={cx('num font-semibold', st.treasury < 0 && 'text-rose-600')}>{fmt(st.treasury, p.currency, { compact: true })}</div></div></div>
                <div className="mt-2"><Progress value={st.consumedPct} /></div>
                <div className="mt-1 text-[11px] text-slate-500">{Math.round(st.consumedPct * 100)} % du budget consommé · engagé {fmt(st.committed, p.currency)}</div>
              </button>
            );
          })}
        </div>
      ))}
      {cur && <ProjectDetail p={cur} onEdit={() => setForm(cur)} />}
      <ProjectForm initial={form} onClose={() => setForm(null)} />
    </div>
  );
}

function ProjectDetail({ p, onEdit }: { p: Project; onEdit: () => void }) {
  const { s, L } = useData();
  const o = useOptions();
  const ui = useUI();
  const [tx, setTx] = useState<Partial<Tx> | null>(null);
  const [rule, setRule] = useState<Partial<Rule> | null>(null);
  const st = useMemo(() => L.projectStats(p), [L, p]);
  const c = p.currency;
  const pAcc = st.accounts[0];
  const personal = s.accounts.find((a) => !a.projectId && a.liquid && !a.archived);
  const txs = s.txs.filter((t) => t.projectId === p.id || st.accounts.some((a) => a.id === t.accountId || a.id === t.toAccountId)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const forecast = useMemo(() => {
    const days = 365;
    const ev = pendingOccurrences(L.activeRules().filter((r) => r.projectId === p.id || st.accounts.some((a) => a.id === r.accountId || a.id === r.toAccountId)), s.occurrences, L.ref, addDays(L.ref, days), 60, L.ref);
    let v = st.treasury;
    const byDay = new Map<string, number>();
    for (const e of ev) {
      const amt = L.conv(e.remaining, L.accCur(e.rule.accountId), c);
      const intoProj = e.rule.kind === 'transfer' && st.accounts.some((a) => a.id === e.rule.toAccountId);
      const sign = e.rule.kind === 'income' || intoProj ? 1 : -1;
      const d = e.date < L.ref ? L.ref : e.date;
      byDay.set(d, (byDay.get(d) ?? 0) + sign * amt);
    }
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < days; i += 1) { const d = addDays(L.ref, i); v += byDay.get(d) ?? 0; if (i % 7 === 0) out.push({ label: d, Trésorerie: v }); }
    return out;
  }, [L, p, st, s.occurrences, c]);
  const byCat = [...st.byCat].map(([k, v]) => ({ name: o.cat(k)?.name ?? 'Sans catégorie', value: v, color: o.cat(k)?.color ?? '#94a3b8' })).sort((a, b) => b.value - a.value);
  const roi = st.financing > 0 ? st.result / st.financing : 0;
  const monthlyNet = L.activeRules().filter((r) => r.projectId === p.id && r.freq === 'monthly').reduce((a, r) => a + (r.kind === 'income' ? 1 : r.kind === 'expense' ? -1 : 0) * L.conv(r.amount, L.accCur(r.accountId), c), 0);

  async function createAccount() {
    const at = nowIso();
    const a: Account = { id: uid(), name: `Caisse ${p.name}`, type: 'pro', currency: p.currency, initialBalance: 0, openedAt: today(), archived: false, liquid: true, projectId: p.id, createdAt: at, updatedAt: at, color: p.color };
    await save('accounts', a, 'Compte projet créé'); ui.toast('Compte du projet créé');
  }
  function report() {
    const rows = txs.map((t) => ({ Date: t.date, Type: KIND_LABEL[t.kind], Libellé: t.label, Catégorie: o.cat(t.categoryId)?.name ?? '', Phase: p.phases.find((x) => x.id === t.phaseId)?.name ?? '', Compte: o.accName(t.accountId), Montant: toMajor(L.conv(t.amount, L.accCur(t.accountId), c, t.date), c), Devise: c }));
    const summary = [
      ['Budget initial', p.budget], ['Dépenses réelles', st.expenses], ['Dépenses engagées (planifiées)', st.committed], ['Budget restant', st.budgetLeft], ['Recettes', st.revenues],
      ['Financements et apports', st.financing], ['dont apport personnel', st.personalContrib], ['Trésorerie', st.treasury], ['Résultat (recettes − dépenses)', st.result],
    ].map(([k, v]) => ({ Indicateur: k as string, Montant: toMajor(v as number, c), Devise: c }));
    const phases = p.phases.map((ph) => ({ Phase: ph.name, Budget: toMajor(ph.budget, c), Dépensé: toMajor(st.byPhase.get(ph.id) ?? 0, c), Écart: toMajor(ph.budget - (st.byPhase.get(ph.id) ?? 0), c) }));
    const fin = [...st.contributors].map(([k, v]) => ({ Source: k, Montant: toMajor(v, c) }));
    download(exportSheets([{ name: 'Synthèse', rows: summary }, { name: 'Phases', rows: phases }, { name: 'Financements', rows: fin }, { name: 'Opérations', rows }]), `rapport-${p.name.replace(/\W+/g, '-')}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: p.color ?? '#8b5cf6' }} /><h2 className="text-lg font-semibold">{p.name}</h2><Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge></div>
            <p className="mt-1 text-sm text-slate-500">{p.description}{p.owner ? ` · Responsable : ${p.owner}` : ''} · du {fmtDate(p.startDate)}{p.endDate ? ` au ${fmtDate(p.endDate)}` : ''}</p></div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={() => setTx({ kind: 'expense', projectId: p.id, accountId: pAcc?.id ?? personal?.id })}>Dépense</Button>
            <Button size="sm" variant="soft" onClick={() => setTx({ kind: 'income', projectId: p.id, accountId: pAcc?.id ?? personal?.id, categoryId: 'proj-ventes' })}>Recette / financement</Button>
            {pAcc ? <Button size="sm" variant="soft" icon={<HandCoins size={14} />} onClick={() => setTx({ kind: 'transfer', accountId: personal?.id, toAccountId: pAcc.id, label: `Apport personnel ${p.name}` })}>Apport personnel</Button> : <Button size="sm" icon={<Wallet size={14} />} onClick={createAccount}>Créer un compte projet</Button>}
            <Button size="sm" icon={<CalendarPlus size={14} />} onClick={() => setRule({ projectId: p.id, accountId: pAcc?.id ?? personal?.id, kind: 'expense' })}>Planifier</Button>
            <Button size="sm" icon={<FileSpreadsheet size={14} />} onClick={report}>Rapport</Button>
            <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={onEdit}>Modifier</Button>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Budget initial" value={fmt(p.budget, c)} hint={`${Math.round(st.consumedPct * 100)} % consommé`} />
        <Stat label="Dépenses réelles" value={fmt(st.expenses, c)} tone="bad" hint={`engagées : ${fmt(st.committed, c)}`} />
        <Stat label="Budget restant" value={fmt(st.budgetLeft, c)} tone={st.budgetLeft < 0 ? 'bad' : 'good'} hint="budget − réel − engagé" />
        <Stat label="Trésorerie disponible" value={fmt(st.treasury, c)} tone={st.treasury < 0 ? 'bad' : 'brand'} hint={pAcc ? `compte ${pAcc.name}` : 'apports + recettes − dépenses'} />
        <Stat label="Recettes générées" value={fmt(st.revenues, c)} tone="good" hint={`prévues : ${fmt(st.plannedIncome, c)}`} />
        <Stat label="Financements et apports" value={fmt(st.financing, c)} hint={`dont personnel ${fmt(st.personalContrib, c)}`} />
        <Stat label="Résultat financier" value={fmt(st.result, c, { sign: true })} tone={st.result >= 0 ? 'good' : 'bad'} hint={st.financing ? `rentabilité ${(roi * 100).toFixed(0)} % des fonds engagés` : undefined} />
        <Stat label="Objectif financier" value={p.target ? fmt(p.target, c) : '—'} hint={p.target ? `atteint à ${Math.round((st.revenues / p.target) * 100)} %` : monthlyNet ? `flux mensuel planifié ${fmt(monthlyNet, c, { sign: true })}` : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Budget par phase">
          {p.phases.length ? <ul className="space-y-3">{p.phases.map((ph) => { const sp = st.byPhase.get(ph.id) ?? 0; return <li key={ph.id}><div className="mb-1 flex justify-between text-sm"><span>{ph.name}</span><span className="num text-slate-500">{fmt(sp, c)} / {fmt(ph.budget, c)}</span></div><Progress value={ph.budget ? sp / ph.budget : 0} /></li>; })}</ul> : <p className="text-sm text-slate-500">Aucune phase définie. Ajoute des phases dans « Modifier ».</p>}
        </Card>
        <Card title="Dépenses par activité">{byCat.length ? <DonutChart data={byCat} cur={c} height={180} /> : <p className="text-sm text-slate-500">Aucune dépense.</p>}</Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Prévision de trésorerie (12 mois)" subtitle="À partir des opérations planifiées liées au projet"><LinesChart data={forecast} cur={c} lines={[{ key: 'Trésorerie', name: 'Trésorerie', color: p.color ?? '#8b5cf6' }]} /></Card>
        <Card title="Financements, investisseurs et associés">
          {st.contributors.size ? <ul className="space-y-1.5 text-sm">{[...st.contributors].sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k} className="flex justify-between"><span>{k}</span><Money v={v} cur={c} className="font-medium" /></li>)}</ul> : <p className="text-sm text-slate-500">Aucun financement. Les apports personnels, subventions, investissements et apports d'associés apparaissent ici (indique le nom dans « Source / payeur »).</p>}
        </Card>
      </div>
      <Card title="Opérations du projet" pad={false}>
        <div className="px-4 pb-3 sm:px-5">
          <Table head={['Date', 'Opération', 'Catégorie', 'Compte', 'Montant']}>
            {txs.slice(0, 100).map((t) => { const into = t.kind === 'transfer' && st.accounts.some((a) => a.id === t.toAccountId); const sign = t.kind === 'income' || into ? 1 : -1; return <tr key={t.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setTx(t)}><td className={td + ' text-xs'}>{fmtDate(t.date)}</td><td className={td}>{t.label}{L.isPersonal(t.accountId) && t.kind !== 'income' && <Badge tone="violet" className="ml-1">apport perso</Badge>}</td><td className={td + ' text-xs'}>{o.cat(t.categoryId)?.name ?? (t.kind === 'transfer' ? 'Transfert' : '')}</td><td className={td + ' text-xs'}>{o.accName(t.accountId)}</td><td className={td + ' text-right'}><Money v={sign * L.conv(t.amount, L.accCur(t.accountId), c, t.date)} cur={c} colored /></td></tr>; })}
          </Table>
          {!txs.length && <p className="py-4 text-sm text-slate-500">Aucune opération.</p>}
        </div>
      </Card>
      <TxForm open={!!tx} onClose={() => setTx(null)} initial={tx ?? undefined} />
      <RuleForm open={!!rule} onClose={() => setRule(null)} initial={rule ?? undefined} />
    </div>
  );
}

function ProjectForm({ initial, onClose }: { initial: Partial<Project> | null; onClose: () => void }) {
  const { main } = useData();
  const ui = useUI();
  const [p, setP] = useState<Partial<Project>>({});
  useEffect(() => { if (initial) setP({ currency: main, status: 'en_cours', startDate: today(), budget: 0, phases: [], archived: false, color: '#8b5cf6', ...initial }); }, [initial]); // eslint-disable-line
  const set = (x: Partial<Project>) => setP((y) => ({ ...y, ...x }));
  return (
    <Modal open={!!initial} onClose={onClose} title={initial?.id ? 'Modifier le projet' : 'Nouveau projet'} footer={<>{initial?.id && <Button variant="ghost" className="mr-auto" onClick={async () => { await save('projects', { ...(p as Project), archived: true }, 'Projet archivé'); onClose(); }}>Archiver</Button>}<Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={async () => { if (!p.name) return ui.toast('Nom requis', 'err'); await save('projects', { id: uid(), createdAt: nowIso(), ...p } as Project, 'Projet enregistré'); ui.toast('Projet enregistré'); onClose(); }}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3"><Field label="Nom"><Input value={p.name ?? ''} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field><Field label="Domaine"><Input value={p.domain ?? ''} onChange={(e) => set({ domain: e.target.value })} /></Field></div>
        <Field label="Description"><Textarea rows={2} value={p.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3"><Field label="Lancement"><Input type="date" value={p.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value })} /></Field><Field label="Fin prévue"><Input type="date" value={p.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || null })} /></Field><Field label="Responsable"><Input value={p.owner ?? ''} onChange={(e) => set({ owner: e.target.value })} /></Field></div>
        <div className="grid grid-cols-3 gap-3"><Field label="Budget initial"><MoneyInput value={p.budget ?? 0} onChange={(v) => set({ budget: v ?? 0 })} currency={p.currency ?? main} /></Field><Field label="Devise"><Select value={p.currency} onChange={(e) => set({ currency: e.target.value })} options={currencyOptions} /></Field><Field label="Statut"><Select value={p.status} onChange={(e) => set({ status: e.target.value as Project['status'] })} options={Object.entries(STATUS).map(([k, v]) => ({ value: k, label: v.label }))} /></Field></div>
        <Field label="Objectif financier (recettes visées)"><MoneyInput value={p.target ?? null} onChange={(v) => set({ target: v ?? undefined })} currency={p.currency ?? main} /></Field>
        <Field label="Phases et budgets">
          <div className="space-y-2">
            {(p.phases ?? []).map((ph, i) => (
              <div key={ph.id} className="flex gap-2"><Input value={ph.name} onChange={(e) => set({ phases: p.phases!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /><div className="w-40"><MoneyInput value={ph.budget} onChange={(v) => set({ phases: p.phases!.map((x, j) => (j === i ? { ...x, budget: v ?? 0 } : x)) })} currency={p.currency ?? main} /></div><button className="text-slate-400 hover:text-rose-600" onClick={() => set({ phases: p.phases!.filter((_, j) => j !== i) })}><Trash2 size={15} /></button></div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => set({ phases: [...(p.phases ?? []), { id: uid(), name: `Phase ${(p.phases?.length ?? 0) + 1}`, budget: 0 }] })}>Ajouter une phase</Button>
          </div>
        </Field>
        <Field label="Couleur"><input type="color" value={p.color ?? '#8b5cf6'} onChange={(e) => set({ color: e.target.value })} className="h-9 w-16 rounded" /></Field>
      </div>
    </Modal>
  );
}
