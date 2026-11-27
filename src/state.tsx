import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensureSeed, DEFAULT_SETTINGS } from './db/db';
import { Ledger } from './engine/ledger';
import { today } from './engine/date';
import type { Snapshot } from './engine/types';

interface Ctx { s: Snapshot; L: Ledger; main: string }
const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [day, setDay] = useState(today());
  useEffect(() => { ensureSeed().then(() => setReady(true)).catch((e) => setErr(String(e?.message ?? e))); }, []);
  useEffect(() => { const t = setInterval(() => setDay(today()), 60_000); return () => clearInterval(t); }, []);
  const s = useLiveQuery(async () => {
    if (!ready) return undefined;
    const [accounts, txs, rules, occurrences, debts, goals, goalMoves, cotisations, cotisPayments, cotisExpenses, projects, categories, budgets, wishes, scenarios, settings, rates] = await Promise.all([
      db.accounts.toArray(), db.txs.toArray(), db.rules.toArray(), db.occurrences.toArray(), db.debts.toArray(), db.goals.toArray(), db.goalMoves.toArray(),
      db.cotisations.toArray(), db.cotisPayments.toArray(), db.cotisExpenses.toArray(), db.projects.toArray(), db.categories.toArray(), db.budgets.toArray(),
      db.wishes.toArray(), db.scenarios.toArray(), db.settings.get('main'), db.rates.toArray(),
    ]);
    const ORDER = ['banque', 'mobile', 'especes', 'portefeuille', 'epargne', 'pro', 'autre'];
    accounts.sort((a, b) => Number(!!a.projectId) - Number(!!b.projectId) || ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.name.localeCompare(b.name));
    projects.sort((a, b) => (a.status === 'idee' ? 1 : 0) - (b.status === 'idee' ? 1 : 0) || a.name.localeCompare(b.name));
    return { accounts, txs, rules, occurrences, debts, goals, goalMoves, cotisations, cotisPayments, cotisExpenses, projects, categories, budgets, wishes, scenarios, settings: settings ?? DEFAULT_SETTINGS, rates } as Snapshot;
  }, [ready]);
  const L = useMemo(() => (s ? new Ledger(s, day) : null), [s, day]);
  useEffect(() => {
    const th = s?.settings.theme ?? 'system';
    const apply = () => document.documentElement.classList.toggle('dark', th === 'dark' || (th === 'system' && matchMedia('(prefers-color-scheme: dark)').matches));
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [s?.settings.theme]);
  if (err) return <div className="p-8 text-sm text-rose-600">Impossible d'ouvrir la base locale : {err}. Vérifie que le navigateur autorise le stockage (IndexedDB) pour ce site.</div>;
  if (!s || !L) return <div className="flex h-full items-center justify-center text-sm text-slate-500">Chargement de FINPILOT…</div>;
  return <DataCtx.Provider value={{ s, L, main: s.settings.mainCurrency }}>{children}</DataCtx.Provider>;
}
export const useData = () => useContext(DataCtx)!;

export function useOptions() {
  const { s, L } = useData();
  return useMemo(() => {
    const accounts = s.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: `${a.name} (${a.currency})`, group: a.projectId ? `Projet : ${s.projects.find((p) => p.id === a.projectId)?.name ?? '?'}` : 'Comptes personnels' }));
    const catOpts = (kind: 'expense' | 'income' | 'all') => s.categories.filter((c) => !c.archived && (kind === 'all' || c.kind === kind || c.kind === 'both')).map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim(), group: c.group }));
    const projects = s.projects.filter((p) => !p.archived).map((p) => ({ value: p.id, label: p.name }));
    const debts = s.debts.filter((d) => !d.archived).map((d) => ({ value: d.id, label: `${d.direction === 'dette' ? 'Dette' : 'Créance'} · ${d.person}` }));
    const goals = s.goals.filter((g) => !g.archived).map((g) => ({ value: g.id, label: g.name }));
    const cat = (id?: string) => s.categories.find((c) => c.id === id);
    const accName = (id?: string) => s.accounts.find((a) => a.id === id)?.name ?? '?';
    return { accounts, catOpts, projects, debts, goals, cat, accName, L };
  }, [s, L]);
}
