import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Badge, Card, Input, Modal, PageHeader, Select, Button } from '../ui/ui';

const ENT: Record<string, string> = { accounts: 'Compte', txs: 'Opération', rules: 'Engagement', occurrences: 'Échéance', debts: 'Dette', goals: 'Objectif', goalMoves: 'Épargne', cotisations: 'Cotisation', cotisPayments: 'Versement', cotisExpenses: 'Caisse', projects: 'Projet', categories: 'Catégorie', budgets: 'Budget', wishes: 'Envie', docs: 'Document', scenarios: 'Scénario', settings: 'Paramètres', rates: 'Taux', system: 'Système' };

export default function Journal() {
  const [ent, setEnt] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(200);
  const [detail, setDetail] = useState<{ before?: unknown; after?: unknown; summary: string } | null>(null);
  const rows = useLiveQuery(async () => {
    const all = (await db.audit.toArray()).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5000);
    return all.filter((r) => (!ent || r.entity === ent) && (!q || r.summary.toLowerCase().includes(q.toLowerCase())));
  }, [ent, q]) ?? [];
  return (
    <div className="space-y-5">
      <PageHeader title="Journal des modifications" subtitle="Chaque création, modification ou suppression est horodatée avec son motif et l'état avant/après." />
      <Card>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Rechercher dans les motifs…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={ent} onChange={(e) => setEnt(e.target.value)} options={[{ value: '', label: 'Tous les éléments' }, ...Object.entries(ENT).map(([k, v]) => ({ value: k, label: v }))]} />
        </div>
      </Card>
      <Card pad={false}>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.slice(0, limit).map((r) => (
            <li key={r.id}>
              <button className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 sm:px-5" onClick={() => setDetail(r)}>
                <div className="min-w-0"><div className="truncate text-sm">{r.summary || `${ENT[r.entity] ?? r.entity} ${r.action}`}</div><div className="text-xs text-slate-500">{new Date(r.at).toLocaleString('fr-FR')}</div></div>
                <div className="flex shrink-0 gap-1"><Badge>{ENT[r.entity] ?? r.entity}</Badge><Badge tone={r.action === 'create' ? 'green' : r.action === 'delete' ? 'red' : 'blue'}>{r.action === 'create' ? 'création' : r.action === 'delete' ? 'suppression' : 'modification'}</Badge></div>
              </button>
            </li>
          ))}
          {!rows.length && <li className="p-6 text-center text-sm text-slate-500">Aucune entrée.</li>}
        </ul>
        {rows.length > limit && <div className="p-4 text-center"><Button onClick={() => setLimit(limit + 300)}>Afficher plus</Button></div>}
      </Card>
      <Modal open={!!detail} onClose={() => setDetail(null)} wide title={detail?.summary || 'Détail'}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><div className="mb-1 text-xs font-medium text-slate-500">Avant</div><pre className="scroll-thin max-h-[50vh] overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] dark:bg-slate-800">{detail?.before ? JSON.stringify(detail.before, null, 2) : '—'}</pre></div>
          <div><div className="mb-1 text-xs font-medium text-slate-500">Après</div><pre className="scroll-thin max-h-[50vh] overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] dark:bg-slate-800">{detail?.after ? JSON.stringify(detail.after, null, 2) : '—'}</pre></div>
        </div>
      </Modal>
    </div>
  );
}
