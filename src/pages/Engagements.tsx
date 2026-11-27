import { useMemo, useState } from 'react';
import { Plus, Pencil, Check, X, RotateCcw, Pause, Play, Trash2, Sparkles, Repeat } from 'lucide-react';
import { useData, useOptions } from '../state';
import { Badge, Button, Card, Empty, Money, PageHeader, Select, Stat, Tabs, Table, td, useUI } from '../ui/ui';
import { ExecuteForm, FREQ_LABEL, RULE_KIND_LABEL, RuleForm } from '../ui/forms';
import { cancelOccurrence, remove, resetOccurrence, save } from '../db/repo';
import { addDays, fmtDate } from '../engine/date';
import { fmt, sum } from '../engine/money';
import { pendingOccurrences, type PendingOcc } from '../engine/recurrence';
import { detectRecurring } from '../engine/insights';
import type { Rule, RuleKind } from '../engine/types';

export default function Engagements() {
  const { s, L, main } = useData();
  const o = useOptions();
  const ui = useUI();
  const [tab, setTab] = useState<'echeancier' | 'regles' | 'abonnements' | 'historique'>('echeancier');
  const [form, setForm] = useState<Partial<Rule> | null>(null);
  const [exec, setExec] = useState<PendingOcc | null>(null);
  const [horizon, setHorizon] = useState('45');
  const [filter, setFilter] = useState('');

  const pending = useMemo(() => pendingOccurrences(L.activeRules(), s.occurrences, L.ref, addDays(L.ref, Number(horizon)), 365, L.ref).filter((p) => !filter || p.rule.kind === filter), [L, s.occurrences, horizon, filter]);
  const late = pending.filter((p) => p.overdue);
  const outSum = sum(pending.filter((p) => !['income', 'loan_back'].includes(p.rule.kind)).map((p) => L.conv(p.remaining, L.accCur(p.rule.accountId))));
  const inSum = sum(pending.filter((p) => ['income', 'loan_back'].includes(p.rule.kind)).map((p) => L.conv(p.remaining, L.accCur(p.rule.accountId))));
  const suggestions = useMemo(() => detectRecurring(L), [L]);
  const subs = s.rules.filter((r) => r.active && (r.categoryId === 'abonnements' || /abonnement|streaming|netflix|spotify|forfait/i.test(r.label)));

  const nextOf = (r: Rule) => pendingOccurrences([r], s.occurrences, L.ref, addDays(L.ref, 800), 0, L.ref).find((p) => !p.overdue)?.date;
  const kinds: RuleKind[] = ['income', 'expense', 'debt_repay', 'saving', 'transfer', 'loan_back'];

  const history = useMemo(() => s.occurrences.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 200), [s.occurrences]);

  return (
    <div className="space-y-5">
      <PageHeader title="Engagements et opérations planifiées" subtitle="Revenus récurrents, factures, loyers, abonnements, remboursements, cotisations, épargne programmée. Une opération planifiée n'est jamais considérée comme payée tant que tu ne l'as pas confirmée."
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setForm({})}>Nouvelle opération planifiée</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="En retard" value={String(late.length)} tone={late.length ? 'bad' : 'default'} hint={late.length ? fmt(sum(late.map((p) => L.conv(p.remaining, L.accCur(p.rule.accountId)))), main) : 'aucun'} />
        <Stat label={`Sorties prévues (${horizon} j)`} value={fmt(outSum, main)} tone="warn" />
        <Stat label={`Entrées prévues (${horizon} j)`} value={fmt(inSum, main)} tone="good" />
        <Stat label="Règles actives" value={String(s.rules.filter((r) => r.active).length)} hint={`${s.rules.length} au total`} />
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'echeancier', label: 'Échéancier' }, { value: 'regles', label: 'Règles récurrentes' }, { value: 'abonnements', label: 'Abonnements' }, { value: 'historique', label: 'Historique' }]} />

      {tab === 'echeancier' && (
        <Card pad={false} title="Échéances à venir et en retard" action={<>
          <Select className="h-8 w-40 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} options={[{ value: '', label: 'Tous les types' }, ...kinds.map((k) => ({ value: k, label: RULE_KIND_LABEL[k] }))]} />
          <Select className="h-8 w-28 text-xs" value={horizon} onChange={(e) => setHorizon(e.target.value)} options={[['7', '7 jours'], ['15', '15 jours'], ['45', '45 jours'], ['90', '3 mois'], ['180', '6 mois']].map(([v, l]) => ({ value: v, label: l }))} />
        </>}>
          {pending.length ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {pending.map((p) => {
                const inc = p.rule.kind === 'income' || p.rule.kind === 'loan_back';
                return (
                  <div key={p.rule.id + p.date} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="w-20 shrink-0 text-xs"><div className="font-medium">{fmtDate(p.date, 'day')}</div><div className="text-slate-500">{p.date.slice(0, 4)}</div></div>
                    <div className="min-w-[55%] flex-1 sm:min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium">{p.rule.label}</div>
                      <div className="flex flex-wrap gap-1.5 text-xs text-slate-500">
                        <span>{RULE_KIND_LABEL[p.rule.kind]} · {o.accName(p.rule.accountId)}</span>
                        {p.status === 'en_retard' && <Badge tone="red">En retard</Badge>}{p.status === 'partielle' && <Badge tone="amber">Partiellement réglée</Badge>}{p.status === 'due' && <Badge tone="blue">Due aujourd'hui</Badge>}{p.status === 'planifiee' && <Badge>Planifiée</Badge>}
                        {inc && p.rule.certainty !== 'certaine' && <Badge tone="amber">{p.rule.certainty}</Badge>}{p.rule.essential && <Badge tone="violet">essentielle</Badge>}
                      </div>
                    </div>
                    <Money v={(inc ? 1 : -1) * p.remaining} cur={L.accCur(p.rule.accountId)} colored className="font-semibold" />
                    <div className="flex gap-1">
                      <Button size="sm" variant="soft" icon={<Check size={14} />} onClick={() => setExec(p)}>{inc ? 'Reçu' : 'Payé'}</Button>
                      <Button size="sm" variant="ghost" icon={<X size={14} />} title="Annuler cette échéance" onClick={async () => { if (await ui.confirm({ title: 'Annuler cette échéance ?', text: `${p.rule.label} du ${fmtDate(p.date, 'long')} ne sera plus attendue. Les échéances suivantes restent planifiées.` })) { await cancelOccurrence(p.rule, p.date); ui.toast('Échéance annulée'); } }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <Empty title="Aucune échéance sur la période" text="Crée tes revenus et charges récurrents pour alimenter les prévisions." />}
        </Card>
      )}

      {tab === 'regles' && (
        <div className="space-y-4">
          {suggestions.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><Sparkles size={16} className="text-amber-500" />Dépenses récurrentes détectées</span>} subtitle="Opérations qui reviennent chaque mois sans règle : en créer une les intègre aux prévisions.">
              <ul className="space-y-2">{suggestions.map((x) => (
                <li key={x.key} className="flex items-center justify-between gap-3 text-sm"><span>{x.label} · {x.months} mois · ≈ {fmt(x.amount, main)}</span>
                  <Button size="sm" variant="soft" onClick={() => setForm({ label: x.label, kind: 'expense', amount: x.amount, categoryId: x.categoryId, accountId: x.accountId, payee: x.label })}>Créer la règle</Button></li>
              ))}</ul>
            </Card>
          )}
          {kinds.map((k) => {
            const rules = s.rules.filter((r) => r.kind === k);
            if (!rules.length) return null;
            return (
              <Card key={k} title={RULE_KIND_LABEL[k] + (k === 'income' ? 's' : '')} subtitle={`Équivalent mensuel : ${fmt(sum(rules.filter((r) => r.active).map((r) => L.ruleMonthly(r))), main)}`} pad={false}>
                <div className="px-4 pb-3 sm:px-5">
                  <Table head={['Nom', 'Montant', 'Fréquence', 'Prochaine', 'Compte', '']}>
                    {rules.map((r) => (
                      <tr key={r.id} className={r.active ? '' : 'opacity-50'}>
                        <td className={td}><div className="font-medium">{r.label}</div><div className="flex gap-1 text-xs text-slate-500">{o.cat(r.categoryId)?.name}{r.essential && <Badge tone="violet">essentielle</Badge>}{r.kind === 'income' && <Badge tone={r.certainty === 'certaine' ? 'green' : 'amber'}>{r.certainty}</Badge>}{!r.active && <Badge>suspendue</Badge>}</div></td>
                        <td className={td}><Money v={r.amount} cur={L.accCur(r.accountId)} /></td>
                        <td className={td + ' whitespace-nowrap text-xs'}>{FREQ_LABEL[r.freq]}{r.interval > 1 ? ` (×${r.interval})` : ''}{r.endDate ? ` → ${fmtDate(r.endDate)}` : ''}</td>
                        <td className={td + ' whitespace-nowrap text-xs'}>{r.active ? fmtDate(nextOf(r)) || 'terminée' : '—'}</td>
                        <td className={td + ' text-xs'}>{o.accName(r.accountId)}</td>
                        <td className={td + ' whitespace-nowrap text-right'}>
                          <button className="rounded p-1.5 text-slate-400 hover:text-slate-700" title="Modifier" onClick={() => setForm(r)}><Pencil size={15} /></button>
                          <button className="rounded p-1.5 text-slate-400 hover:text-slate-700" title={r.active ? 'Suspendre' : 'Réactiver'} onClick={() => save('rules', { ...r, active: !r.active }, r.active ? 'Règle suspendue' : 'Règle réactivée')}>{r.active ? <Pause size={15} /> : <Play size={15} />}</button>
                          <button className="rounded p-1.5 text-slate-400 hover:text-rose-600" title="Supprimer" onClick={async () => { if (await ui.confirm({ title: 'Supprimer cette règle ?', text: 'Les transactions déjà exécutées sont conservées. Les échéances futures disparaissent des prévisions.', danger: true })) { await remove('rules', r.id, `Règle supprimée : ${r.label}`); ui.toast('Règle supprimée'); } }}><Trash2 size={15} /></button>
                        </td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </Card>
            );
          })}
          {!s.rules.length && <Card><Empty icon={<Repeat size={36} />} title="Aucune opération planifiée" text="Ajoute ton salaire, ton loyer, tes factures et abonnements." action={<Button variant="primary" onClick={() => setForm({})}>Ajouter</Button>} /></Card>}
        </div>
      )}

      {tab === 'abonnements' && (
        <Card title="Abonnements actifs" subtitle={`Coût mensuel ${fmt(sum(subs.map((r) => L.ruleMonthly(r))), main)} · coût annuel ${fmt(sum(subs.map((r) => L.ruleMonthly(r))) * 12, main)}`}>
          {subs.length ? <Table head={['Abonnement', 'Montant', 'Fréquence', 'Coût annuel', '']}>
            {subs.map((r) => <tr key={r.id}><td className={td + ' font-medium'}>{r.label}</td><td className={td}><Money v={r.amount} cur={L.accCur(r.accountId)} /></td><td className={td + ' text-xs'}>{FREQ_LABEL[r.freq]}</td><td className={td}><Money v={L.ruleMonthly(r) * 12} cur={main} className="font-semibold" /></td><td className={td + ' text-right'}><Button size="sm" variant="ghost" onClick={() => setForm(r)}>Modifier</Button></td></tr>)}
          </Table> : <Empty title="Aucun abonnement identifié" text="Classe tes abonnements dans la catégorie « Abonnements » pour les suivre ici." />}
        </Card>
      )}

      {tab === 'historique' && (
        <Card title="Historique des échéances traitées" pad={false}>
          <div className="px-4 pb-3 sm:px-5">
            <Table head={['Échéance', 'Opération', 'Statut', 'Réglé', '']}>
              {history.map((h) => {
                const r = s.rules.find((x) => x.id === h.ruleId);
                return (
                  <tr key={h.id}><td className={td + ' text-xs'}>{fmtDate(h.date)}{h.actualDate && h.actualDate !== h.date ? <div className="text-slate-500">le {fmtDate(h.actualDate)}</div> : null}</td>
                    <td className={td}>{r?.label ?? 'Règle supprimée'}</td>
                    <td className={td}>{h.status === 'paid' ? <Badge tone="green">Exécutée</Badge> : h.status === 'partial' ? <Badge tone="amber">Partielle</Badge> : <Badge>Annulée</Badge>}</td>
                    <td className={td}>{r ? <Money v={h.paidAmount} cur={L.accCur(r.accountId)} /> : '—'}</td>
                    <td className={td + ' text-right'}>{r && h.status === 'cancelled' && <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => resetOccurrence(r, h.date)}>Rétablir</Button>}</td></tr>
                );
              })}
            </Table>
            {!history.length && <p className="py-6 text-center text-sm text-slate-500">Aucune échéance traitée.</p>}
          </div>
        </Card>
      )}
      <RuleForm open={!!form} onClose={() => setForm(null)} initial={form ?? undefined} />
      <ExecuteForm open={!!exec} onClose={() => setExec(null)} rule={exec?.rule} date={exec?.date} remaining={exec?.remaining} />
    </div>
  );
}
