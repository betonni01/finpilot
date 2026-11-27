import { useEffect, useState, type ReactNode } from 'react';
import { KeyRound } from 'lucide-react';
import { checkPassphrase, enableVault, initKeys, lockVault, onVaultLock, unlockVault, vaultDelay, type VaultBoot } from '../db/vault';
import { refreshRates } from '../db/rates';
import { db } from '../db/db';
import { PinScreen } from './Lock';

/** Avant toute lecture : le coffre est obligatoire. Sans phrase secrète, la clé n'existe pas sur le disque. */
export function VaultGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VaultBoot | 'loading' | 'pin' | 'error'>('loading');
  const [err, setErr] = useState('');
  useEffect(() => { initKeys().then(setState).catch((e) => { setErr(String(e?.message ?? e)); setState('error'); }); }, []);
  useEffect(() => onVaultLock(() => setState('locked')), []);
  useEffect(() => { if (state === 'ready') refreshRates().catch(() => {}); }, [state]);
  const opened = async () => {
    const s = await db.settings.get('main');
    setState(s?.pinHash ? 'pin' : 'ready');
  };
  if (state === 'loading') return <div className="flex h-full items-center justify-center text-sm text-slate-500">Ouverture de FINPILOT…</div>;
  if (state === 'error') return <div className="p-8 text-sm text-rose-600">Impossible d'ouvrir la base locale : {err}</div>;
  if (state === 'setup' || state === 'migrate') return <Setup migrate={state === 'migrate'} onDone={opened} />;
  if (state === 'locked') return <Unlock onDone={opened} />;
  if (state === 'pin') return <PinScreen onUnlock={() => setState('ready')} onGiveUp={() => { lockVault(); }} />;
  return <>{children}</>;
}

function PhraseForm({ title, text, submitLabel, onSubmit }: { title: string; text: string; submitLabel: string; onSubmit: (pass: string) => Promise<void> }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (a !== b) { setErr('Les deux saisies diffèrent.'); return; }
    const why = checkPassphrase(a);
    if (why) { setErr(why); return; }
    setBusy(true); setErr('');
    try { await onSubmit(a); }
    catch (x) { setErr((x as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-slate-950 px-6 text-white">
      <form onSubmit={go} className="w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-2 text-center"><div className="rounded-2xl bg-slate-800 p-3"><KeyRound className="text-emerald-400" /></div><h1 className="text-lg font-semibold">{title}</h1><p className="text-sm text-slate-400">{text}</p></div>
        <input type="password" autoFocus autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} placeholder="Phrase secrète" className="h-12 w-full rounded-xl bg-slate-800 px-4 text-base outline-none ring-emerald-400 focus:ring-2" />
        <input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} placeholder="Confirmation" className="h-12 w-full rounded-xl bg-slate-800 px-4 text-base outline-none ring-emerald-400 focus:ring-2" />
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <button disabled={busy || !a || !b} className="h-12 w-full rounded-xl bg-emerald-500 font-semibold text-slate-950 disabled:opacity-40">{busy ? 'Chiffrement…' : submitLabel}</button>
        <p className="text-center text-xs text-slate-500">Au moins 10 caractères, avec un espace, un chiffre ou un symbole. Phrase oubliée : les données de cet appareil sont irrécupérables.</p>
      </form>
    </div>
  );
}

function Setup({ migrate, onDone }: { migrate: boolean; onDone: () => Promise<void> }) {
  return (
    <PhraseForm
      title={migrate ? 'Protège tes données' : 'Crée ton coffre'}
      text={migrate
        ? 'Des données sont déjà sur cet appareil, avec la clé en clair. Choisis une phrase secrète : elles seront chiffrées, et la clé en clair sera effacée.'
        : 'Tout ce que tu enregistres est chiffré sur cet appareil avant d\'être écrit. La phrase secrète n\'est pas un code PIN : elle est la seule clé.'}
      submitLabel={migrate ? 'Chiffrer maintenant' : 'Créer le coffre'}
      onSubmit={async (pass) => { await enableVault(pass); await onDone(); }}
    />
  );
}

function Unlock({ onDone }: { onDone: () => Promise<void> }) {
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  useEffect(() => { vaultDelay().then(setWait); }, []);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (!pass || busy || wait > 0) return;
    setBusy(true); setErr('');
    try { await unlockVault(pass); await onDone(); }
    catch (x) { setErr((x as Error).message); setPass(''); const d = await vaultDelay(); setWait(d); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-slate-950 px-6 text-white">
      <form onSubmit={go} className="w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-2 text-center"><div className="rounded-2xl bg-slate-800 p-3"><KeyRound className="text-emerald-400" /></div><h1 className="text-lg font-semibold">Coffre FINPILOT</h1><p className="text-sm text-slate-400">{wait > 0 ? `Trop d'essais. Réessaie dans ${wait} s.` : 'Tes données sont chiffrées sur cet appareil. Saisis ta phrase secrète pour les ouvrir.'}</p></div>
        <input type="password" autoFocus autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Phrase secrète" className="h-12 w-full rounded-xl bg-slate-800 px-4 text-base outline-none ring-emerald-400 focus:ring-2" />
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <button disabled={busy || !pass || wait > 0} className="h-12 w-full rounded-xl bg-emerald-500 font-semibold text-slate-950 disabled:opacity-40">{busy ? 'Vérification…' : 'Déverrouiller'}</button>
        <p className="text-center text-xs text-slate-500">Phrase oubliée : les données de cet appareil sont irrécupérables. Restaure une sauvegarde chiffrée, ou resynchronise depuis ton compte avec la même phrase de synchronisation.</p>
      </form>
    </div>
  );
}
