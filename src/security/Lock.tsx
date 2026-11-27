import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Lock, Delete } from 'lucide-react';
import { useData } from '../state';
import { hashPin } from '../db/repo';
import { db } from '../db/db';
import { lockVault } from '../db/vault';

const LockCtx = createContext<{ lock: () => void; hasPin: boolean }>({ lock: () => {}, hasPin: false });
export const useLock = () => useContext(LockCtx);

/** Verrouillage : efface la clé de la mémoire. Rouvrir exige la phrase secrète. */
export function LockGate({ children }: { children: ReactNode }) {
  const { s } = useData();
  const lock = useCallback(() => { lockVault(); }, []);
  useEffect(() => {
    const mins = Math.max(1, s.settings.autoLockMin || 5);
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = window.setInterval(() => { if (Date.now() - last > mins * 60000) lockVault(); }, 15000);
    let hideTimer = 0;
    const vis = () => {
      window.clearTimeout(hideTimer);
      if (document.visibilityState === 'hidden') hideTimer = window.setTimeout(() => { if (document.visibilityState === 'hidden') lockVault(); }, mins * 60000);
    };
    document.addEventListener('visibilitychange', vis);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); window.clearInterval(t); window.clearTimeout(hideTimer); document.removeEventListener('visibilitychange', vis); };
  }, [s.settings.autoLockMin]);
  return <LockCtx.Provider value={{ lock, hasPin: !!s.settings.pinHash }}>{children}</LockCtx.Provider>;
}

const PIN_GUARD = 'pin-guard';
/** Deuxième facteur, après la phrase secrète. Les essais restent comptés après un rechargement. */
export function PinScreen({ onUnlock, onGiveUp }: { onUnlock: () => void; onGiveUp: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [wait, setWait] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    db.meta.get(PIN_GUARD).then((g) => {
      const until = (g as { until?: number } | undefined)?.until ?? 0;
      setWait(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
      setReady(true);
    });
  }, []);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const check = async (p: string) => {
    if (wait > 0) return;
    const s = await db.settings.get('main');
    if (!s?.pinHash) { onUnlock(); return; }
    const { hash } = await hashPin(p, s.pinSalt ?? undefined);
    if (hash === s.pinHash) { await db.meta.delete(PIN_GUARD); onUnlock(); return; }
    const g = ((await db.meta.get(PIN_GUARD)) as { fails?: number } | undefined) ?? { fails: 0 };
    const n = (g.fails ?? 0) + 1;
    const delay = n >= 5 ? Math.min(900, 30 * 2 ** (Math.floor(n / 5) - 1)) : 0;
    await db.meta.put({ id: PIN_GUARD, fails: n, until: Date.now() + delay * 1000 });
    setPin('');
    setErr('Code incorrect');
    setWait(delay);
    if (n >= 8) onGiveUp();
  };
  const press = (d: string) => {
    if (wait > 0 || !ready) return;
    setErr('');
    setPin((pin + d).slice(0, 8));
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1)); else if (e.key === 'Enter' && pin.length >= 4) check(pin); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-slate-950 px-6 text-white">
      <div className="flex flex-col items-center gap-2"><div className="rounded-2xl bg-slate-800 p-3"><Lock className="text-emerald-400" /></div><h1 className="text-lg font-semibold">Code PIN</h1><p className="text-sm text-slate-400">{wait > 0 ? `Trop d'essais : patiente ${wait} s` : err || 'Saisis ton code PIN'}</p></div>
      <div className="flex gap-3">{Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <span key={i} className={`h-3 w-3 rounded-full ${i < pin.length ? 'bg-emerald-400' : 'bg-slate-700'}`} />)}</div>
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => press(d)} className="h-16 w-16 rounded-full bg-slate-800 text-xl font-medium hover:bg-slate-700">{d}</button>)}
        <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} className="flex h-16 w-16 items-center justify-center rounded-full text-slate-400 hover:bg-slate-800" aria-label="Effacer"><Delete /></button>
        <button type="button" onClick={() => press('0')} className="h-16 w-16 rounded-full bg-slate-800 text-xl font-medium hover:bg-slate-700">0</button>
        <button type="button" disabled={pin.length < 4} onClick={() => check(pin)} className="h-16 w-16 rounded-full bg-emerald-500 text-sm font-semibold text-slate-950 disabled:opacity-30">OK</button>
      </div>
    </div>
  );
}
