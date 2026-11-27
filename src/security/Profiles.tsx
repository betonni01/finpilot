import { useState, type ReactNode } from 'react';
import { Plus, Trash2, UserRound, ChevronRight } from 'lucide-react';
import { activeProfile, createProfile, deleteProfile, listProfiles, markChosen, needsPicker, switchTo, type Profile } from '../db/profiles';

/** Choix du profil avant d'ouvrir la moindre donnée. */
export function ProfileGate({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(needsPicker());
  if (!show) return <>{children}</>;
  return <Picker onContinue={() => { markChosen(); setShow(false); }} />;
}

function Avatar({ p, size = 44 }: { p: Profile; size?: number }) {
  return <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: p.color, fontSize: size * 0.4 }}>{p.name.trim()[0]?.toUpperCase() ?? '?'}</span>;
}

function Picker({ onContinue }: { onContinue: () => void }) {
  const [list, setList] = useState(listProfiles());
  const [name, setName] = useState('');
  const [del, setDel] = useState<Profile | null>(null);
  const [typed, setTyped] = useState('');
  const cur = activeProfile();
  const open = (p: Profile) => (p.id === cur.id ? onContinue() : switchTo(p.id));
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <svg viewBox="0 0 512 512" className="mx-auto h-12 w-12"><rect width="512" height="512" rx="112" fill="#0f172a" /><path d="M96 368 L208 256 L272 312 L416 160" fill="none" stroke="#34d399" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" /><circle cx="416" cy="160" r="28" fill="#34d399" /></svg>
          <h1 className="mt-3 text-xl font-semibold">Qui utilise FINPILOT ?</h1>
          <p className="mt-1 text-sm text-slate-500">Chaque profil a ses propres données, son code PIN et son compte. Les autres profils n'y ont pas accès.</p>
        </div>
        <ul className="space-y-2">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <button onClick={() => open(p)} className="flex flex-1 items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 hover:ring-slate-400 dark:bg-slate-900 dark:ring-slate-800">
                <Avatar p={p} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.name}</span><span className="block truncate text-xs text-slate-500">{p.email ? `Compte ${p.email}` : 'Sans compte en ligne'}{p.lastUsedAt ? ` · ouvert le ${new Date(p.lastUsedAt).toLocaleDateString('fr-FR')}` : ''}</span></span>
                <ChevronRight size={18} className="text-slate-400" />
              </button>
              {list.length > 1 && <button onClick={() => { setDel(p); setTyped(''); }} className="rounded-lg p-2 text-slate-400 hover:text-rose-600" aria-label={`Supprimer ${p.name}`}><Trash2 size={16} /></button>}
            </li>
          ))}
        </ul>
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); const p = createProfile(name || 'Nouveau profil'); switchTo(p.id); }}>
          <div className="relative flex-1"><UserRound size={16} className="absolute left-3 top-3 text-slate-400" /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Prénom du nouveau profil" className="h-10 w-full rounded-lg bg-white pl-9 pr-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-slate-900 dark:ring-slate-700" /></div>
          <button className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-sm font-medium text-white dark:bg-emerald-500 dark:text-slate-950"><Plus size={16} />Ajouter</button>
        </form>
        {del && (
          <div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm dark:bg-rose-500/10">
            <p className="text-rose-700 dark:text-rose-300">Supprimer le profil <b>{del.name}</b> efface définitivement ses données sur cet appareil (son compte en ligne n'est pas touché). Tape son nom pour confirmer.</p>
            <div className="mt-2 flex gap-2"><input value={typed} onChange={(e) => setTyped(e.target.value)} className="h-9 flex-1 rounded-lg bg-white px-3 ring-1 ring-rose-200 dark:bg-slate-900" />
              <button disabled={typed !== del.name} onClick={async () => { await deleteProfile(del.id); setDel(null); setList(listProfiles()); if (del.id === cur.id) location.reload(); }} className="rounded-lg bg-rose-600 px-3 text-white disabled:opacity-40">Supprimer</button>
              <button onClick={() => setDel(null)} className="rounded-lg px-3 text-slate-600">Annuler</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
