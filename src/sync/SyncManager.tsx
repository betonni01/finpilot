import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { NavLink } from 'react-router-dom';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { db } from '../db/db';
import { refreshMe, syncNow, type SyncConfig } from './sync';

/** Synchronise au démarrage, périodiquement, au retour du réseau, au retour sur l'app et peu après chaque modification. */
export function SyncManager() {
  const c = useLiveQuery(() => db.meta.get('sync'), []) as SyncConfig | undefined;
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0;
  const active = !!c?.enabled && !!c.access;
  const debounce = useRef<number>();
  useEffect(() => {
    if (!active) return;
    syncNow();
    refreshMe().catch(() => {});
    const t = window.setInterval(() => syncNow(), Math.max(1, c!.autoMin || 5) * 60_000);
    const on = () => syncNow();
    const vis = () => { if (document.visibilityState === 'visible') syncNow(); };
    window.addEventListener('online', on);
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); window.removeEventListener('online', on); document.removeEventListener('visibilitychange', vis); };
  }, [active, c?.autoMin]); // eslint-disable-line
  useEffect(() => {
    if (!active || !pending) return;
    clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => syncNow(), 4000);
    return () => clearTimeout(debounce.current);
  }, [pending, active]);
  return null;
}

export function SyncBadge() {
  const c = useLiveQuery(() => db.meta.get('sync'), []) as SyncConfig | undefined;
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0;
  if (!c?.enabled || !c.access) return null;
  const err = c.lastError;
  return (
    <NavLink to="/parametres" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title={err ?? ''}>
      {err ? <CloudOff size={16} className="text-amber-500" /> : pending ? <RefreshCw size={16} className="text-sky-500" /> : <Cloud size={16} className="text-emerald-500" />}
      {err ? 'Synchro en attente' : pending ? `${pending} modification(s) à envoyer` : 'Synchronisé'}
    </NavLink>
  );
}
