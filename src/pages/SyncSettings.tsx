import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Cloud, CloudOff, RefreshCw, LogOut, Bell, BellOff, KeyRound, ShieldCheck, Lock, Trash2 } from 'lucide-react';
import { db } from '../db/db';
import { Badge, Button, Card, Field, Input, Tabs, useUI } from '../ui/ui';
import { refreshMe, api, confirmPasswordReset, connect, defaultServer, disconnect, requestPasswordReset, serverInfo, syncNow, updateSyncConfig, type ServerInfo, type SyncConfig } from '../sync/sync';
import { disablePush, enablePush, pushSupported, scheduleReminders } from '../sync/push';
import { changeVaultPass, checkPassphrase, lockVault } from '../db/vault';
import { isVaultOn } from '../db/secure';

export function useSyncConfig() {
  return useLiveQuery(() => db.meta.get('sync'), []) as SyncConfig | undefined;
}
const ago = (iso?: string | null) => {
  if (!iso) return 'jamais';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? "à l'instant" : s < 3600 ? `il y a ${Math.round(s / 60)} min` : s < 86400 ? `il y a ${Math.round(s / 3600)} h` : new Date(iso).toLocaleString('fr-FR');
};

export function SyncSettings() {
  const c = useSyncConfig();
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0;
  const ui = useUI();
  const connected = !!c?.enabled && !!c.access;
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ usage_bytes: number; quota_bytes: number } | null>(null);
  useEffect(() => { if (connected) refreshMe().then(setUsage).catch(() => {}); }, [connected, c?.lastSyncAt]);
  const run = async (fn: () => Promise<unknown>, ok?: string) => { setBusy(true); try { await fn(); if (ok) ui.toast(ok); } catch (e) { ui.toast((e as Error).message, 'err'); } finally { setBusy(false); } };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {connected ? (
        <Card title={<span className="flex items-center gap-2"><Cloud size={16} className="text-emerald-500" />Synchronisation active</span>} subtitle={`${c!.email} · ${c!.server}`}>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Dernière synchronisation</span><span>{ago(c!.lastSyncAt)}</span></div>
            <div className="flex justify-between"><span>Modifications en attente d'envoi</span><Badge tone={pending ? 'amber' : 'green'}>{pending}</Badge></div>
            {c!.stats && <div className="flex justify-between text-slate-500"><span>Dernier échange</span><span>{c!.stats.sent} envoyé(s), {c!.stats.received} reçu(s){c!.stats.conflicts ? `, ${c!.stats.conflicts} conflit(s)` : ''}</span></div>}
            {usage && <div className="flex justify-between"><span>Espace utilisé sur le serveur</span><span>{(usage.usage_bytes / 1048576).toFixed(1)} Mo sur {Math.round(usage.quota_bytes / 1048576)} Mo</span></div>}
            {c!.lastError && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{c!.lastError}</p>}
            <Field label="Synchronisation automatique"><select className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-700" value={c!.autoMin} onChange={(e) => updateSyncConfig({ autoMin: Number(e.target.value) })}>{[1, 5, 15, 60].map((m) => <option key={m} value={m}>Toutes les {m} min et à chaque modification</option>)}</select></Field>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="primary" icon={<RefreshCw size={15} className={busy ? 'animate-spin' : ''} />} disabled={busy} onClick={() => run(async () => { const r = await syncNow(); if (r?.lastError) throw new Error(r.lastError); }, 'Synchronisé')}>Synchroniser maintenant</Button>
              <Button icon={<LogOut size={15} />} onClick={() => run(() => disconnect(false), 'Appareil déconnecté')}>Déconnecter cet appareil</Button>
              <Button variant="ghost" onClick={async () => { if (await ui.confirm({ title: 'Déconnecter tous les appareils ?', text: 'Toutes les sessions ouvertes devront se reconnecter.' })) run(() => disconnect(true), 'Toutes les sessions sont fermées'); }}>Fermer toutes les sessions</Button>
            </div>
          </div>
        </Card>
      ) : <ConnectForm prev={c} />}
      <Card title={<span className="flex items-center gap-2"><ShieldCheck size={16} />Comment c'est protégé</span>}>
        <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <li>• Chiffrement de bout en bout : chaque enregistrement est chiffré sur ton appareil (AES-256-GCM) avant l'envoi. Le serveur ne voit ni montants, ni libellés, ni documents.</li>
          <li>• La clé de chiffrement est protégée par ta <b>phrase secrète de synchronisation</b>, qui ne quitte jamais tes appareils. Elle est demandée une seule fois par nouvel appareil.</li>
          <li>• Conflits : pour un même élément modifié sur deux appareils, la modification la plus récente l'emporte ; chaque résolution est notée dans le journal.</li>
          <li>• Hors connexion, les modifications s'accumulent et partent dès le retour du réseau.</li>
        </ul>
      </Card>
      {connected && <PushCard c={c!} />}
      {connected && <AccountCard />}
    </div>
  );
}

export function ConnectForm({ prev, join, onDone, title }: { prev?: SyncConfig; join?: boolean; onDone?: (r: 'new' | 'joined') => void; title?: string }) {
  const ui = useUI();
  const [create, setCreate] = useState(!join);
  const [server, setServer] = useState(prev?.server || defaultServer());
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [infoErr, setInfoErr] = useState('');
  const [email, setEmail] = useState(prev?.email ?? '');
  const [password, setPassword] = useState('');
  const [pass, setPass] = useState('');
  const [invite, setInvite] = useState('');
  const [mode, setMode] = useState<'replace' | 'merge'>(join ? 'replace' : 'merge');
  const [vaultPass, setVaultPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  useEffect(() => {
    if (!server) return;
    let off = false;
    const t = setTimeout(() => serverInfo(server).then((i) => { if (!off) { setInfo(i); setInfoErr(''); } }).catch((e) => { if (!off) { setInfo(null); setInfoErr(e.message); } }), 400);
    return () => { off = true; clearTimeout(t); };
  }, [server]);
  const needInvite = create && info?.registration === 'invite' && !info.first_user;
  const closed = create && info?.registration === 'closed' && !info.first_user;
  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (create) { const err = checkPassphrase(pass); if (err) return ui.toast(err, 'err'); }
    setBusy(true);
    try {
      const r = await connect({ server, email, password, create, passphrase: pass, mode, vaultPass: vaultPass || undefined, invite });
      ui.toast(r === 'new' ? (info?.first_user ? 'Compte administrateur créé' : 'Compte créé') : 'Connecté : données synchronisées');
      onDone?.(r);
    } catch (err) { ui.toast((err as Error).message, 'err'); } finally { setBusy(false); }
  }
  if (forgot) return <ForgotPassword server={server} email={email} onBack={() => setForgot(false)} />;
  return (
    <Card title={<span className="flex items-center gap-2"><CloudOff size={16} />{title ?? 'Compte FINPILOT en ligne'}</span>} subtitle="Pour retrouver tes données sur tous tes appareils. Elles sont chiffrées avant de quitter l'appareil.">
      <form onSubmit={go} className="space-y-3">
        <Tabs value={create ? 'new' : 'join'} onChange={(v) => setCreate(v === 'new')} items={[{ value: 'new', label: 'Créer mon compte' }, { value: 'join', label: "J'ai déjà un compte" }]} />
        <Field label="Adresse du serveur" hint={infoErr ? <span className="text-rose-600">{infoErr}</span> : info ? <span className="text-emerald-600">Serveur joignable{info.first_user ? ' · aucun compte encore : le premier sera administrateur' : info.registration === 'invite' ? ' · inscription sur invitation' : info.registration === 'closed' ? ' · inscriptions fermées' : ''}</span> : "Celle que t'a donnée la personne qui t'a partagé FINPILOT."}><Input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://finpilot.mondomaine.fr" required /></Field>
        {closed && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">Ce serveur n'accepte plus de nouveaux comptes. Contacte son administrateur.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="E-mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Mot de passe" hint={create ? '10 caractères minimum' : <button type="button" className="text-brand-600 hover:underline" onClick={() => setForgot(true)}>Mot de passe oublié ?</button>}><Input type="password" autoComplete={create ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        </div>
        {needInvite && <Field label="Code d'invitation" hint="Fourni par l'administrateur du serveur."><Input value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())} placeholder="ex. K7Q2M9XH4P" required className="font-mono tracking-wider" /></Field>}
        <Field label="Phrase secrète de chiffrement" hint={create ? "Différente du mot de passe, elle chiffre tes données : personne d'autre (pas même l'administrateur) ne peut les lire. Note-la : sans elle, impossible de les ouvrir sur un autre appareil." : 'Celle choisie à la création du compte.'}><Input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} required /></Field>
        {!create && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
            <div className="font-medium">Données déjà présentes sur ce profil</div>
            <label className="flex items-start gap-2"><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} className="mt-1" /><span><b>Remplacer</b> par celles du compte (recommandé sur un nouvel appareil)</span></label>
            <label className="flex items-start gap-2"><input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} className="mt-1" /><span><b>Fusionner</b> : envoyer aussi celles de ce profil (en cas de doublon, la version du compte est gardée)</span></label>
            {isVaultOn() && <Field label="Phrase secrète du coffre de ce profil"><Input type="password" value={vaultPass} onChange={(e) => setVaultPass(e.target.value)} /></Field>}
          </div>
        )}
        <Button variant="primary" disabled={busy || closed} type="submit" icon={<Cloud size={15} />}>{busy ? 'Connexion…' : create ? 'Créer mon compte' : 'Me connecter'}</Button>
      </form>
    </Card>
  );
}

function ForgotPassword({ server, email: e0, onBack }: { server: string; email: string; onBack: () => void }) {
  const ui = useUI();
  const [email, setEmail] = useState(e0);
  const [step, setStep] = useState<'ask' | 'code'>('ask');
  const [mailOn, setMailOn] = useState(true);
  const [code, setCode] = useState('');
  const [pwd, setPwd] = useState('');
  return (
    <Card title="Mot de passe oublié">
      <div className="space-y-3 text-sm">
        <p className="text-slate-500">Changer le mot de passe ne touche pas à tes données : elles restent déchiffrables avec ta phrase secrète.</p>
        <Field label="E-mail du compte"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {step === 'ask' ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={async () => { try { const r = await requestPasswordReset(server, email); setMailOn(r.email_enabled); setStep('code'); } catch (e) { ui.toast((e as Error).message, 'err'); } }}>Recevoir un code</Button>
            <Button variant="ghost" onClick={() => setStep('code')}>J'ai déjà un code</Button>
          </div>
        ) : (
          <>
            <p className={mailOn ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'}>{mailOn ? 'Si un compte existe pour cette adresse, un code valable une heure vient d\'être envoyé.' : "Ce serveur n'envoie pas d'e-mails : demande un code de réinitialisation à son administrateur."}</p>
            <div className="grid gap-2 sm:grid-cols-2"><Input placeholder="Code reçu" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono" /><Input type="password" placeholder="Nouveau mot de passe" value={pwd} onChange={(e) => setPwd(e.target.value)} /></div>
            <Button variant="primary" onClick={async () => { try { await confirmPasswordReset(server, email, code, pwd); ui.toast('Mot de passe changé : connecte-toi'); onBack(); } catch (e) { ui.toast((e as Error).message, 'err'); } }}>Changer le mot de passe</Button>
          </>
        )}
        <Button variant="ghost" onClick={onBack}>Retour</Button>
      </div>
    </Card>
  );
}

function PushCard({ c }: { c: SyncConfig }) {
  const ui = useUI();
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<boolean | null>(null);
  useEffect(() => { api('/health/').then((h) => setHealth(!!h.push)).catch(() => setHealth(null)); }, []);
  return (
    <Card title={<span className="flex items-center gap-2"><Bell size={16} />Rappels en arrière-plan</span>} subtitle="Notifications reçues même application fermée, envoyées par ton serveur">
      <div className="space-y-3 text-sm">
        {health === false && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">Le serveur n'a pas de clés VAPID : génère-les (voir le guide) pour activer les notifications.</p>}
        {!pushSupported() && <p className="text-xs text-slate-500">Ce navigateur ne gère pas les notifications push. Sur iPhone : installe FINPILOT sur l'écran d'accueil (iOS 16.4 ou plus), puis rouvre cette page.</p>}
        <div className="flex items-center justify-between"><span>Sur cet appareil</span>{c.push ? <Badge tone="green">Actives</Badge> : <Badge>Inactives</Badge>}</div>
        <p className="text-xs text-slate-500">Le serveur ne reçoit ni le libellé ni le montant : seulement qu'un paiement approche, et combien.</p>
        <div className="flex gap-2">
          {c.push
            ? <Button icon={<BellOff size={15} />} disabled={busy} onClick={async () => { setBusy(true); try { await disablePush(); ui.toast('Notifications désactivées'); } finally { setBusy(false); } }}>Désactiver</Button>
            : <Button variant="primary" icon={<Bell size={15} />} disabled={busy || !pushSupported()} onClick={async () => { setBusy(true); try { await enablePush(); ui.toast('Notifications activées'); } catch (e) { ui.toast((e as Error).message, 'err'); } finally { setBusy(false); } }}>Activer sur cet appareil</Button>}
          {c.push && <Button variant="ghost" onClick={() => scheduleReminders().then(() => ui.toast('Rappels reprogrammés')).catch((e) => ui.toast(e.message, 'err'))}>Reprogrammer</Button>}
        </div>
      </div>
    </Card>
  );
}

function AccountCard() {
  const ui = useUI();
  const [oldP, setOldP] = useState('');
  const [newP, setNewP] = useState('');
  return (
    <Card title="Compte de synchronisation">
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2"><Input type="password" placeholder="Mot de passe actuel" value={oldP} onChange={(e) => setOldP(e.target.value)} /><Input type="password" placeholder="Nouveau mot de passe" value={newP} onChange={(e) => setNewP(e.target.value)} /></div>
        <Button size="sm" onClick={() => api('/auth/password/', { method: 'POST', body: JSON.stringify({ old_password: oldP, new_password: newP }) }).then(() => { ui.toast('Mot de passe modifié'); setOldP(''); setNewP(''); }).catch((e) => ui.toast(e.message, 'err'))}>Changer le mot de passe</Button>
        <div className="rounded-lg bg-rose-50 p-3 dark:bg-rose-500/10">
          <p className="text-xs text-rose-700 dark:text-rose-300">Supprimer le compte efface toutes les données stockées sur le serveur. Les données de cet appareil sont conservées.</p>
          <Button size="sm" className="mt-2" variant="danger" icon={<Trash2 size={14} />} onClick={async () => {
            const pwd = oldP;
            if (!pwd) return ui.toast('Saisis ton mot de passe actuel ci-dessus', 'err');
            if (!(await ui.confirm({ title: 'Supprimer le compte de synchronisation ?', danger: true, typed: 'SUPPRIMER', text: 'Irréversible côté serveur.' }))) return;
            try { await api('/auth/account/', { method: 'DELETE', body: JSON.stringify({ password: pwd }) }); await disconnect(false); ui.toast('Compte supprimé'); } catch (e) { ui.toast((e as Error).message, 'err'); }
          }}>Supprimer le compte</Button>
        </div>
      </div>
    </Card>
  );
}

export function VaultCard() {
  const ui = useUI();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); ui.toast(ok); setP1(''); setP2(''); } catch (e) { ui.toast((e as Error).message, 'err'); } finally { setBusy(false); } };
  return (
    <Card title={<span className="flex items-center gap-2"><KeyRound size={16} />Coffre chiffré sur cet appareil</span>} subtitle="Obligatoire. AES-256-GCM sur chaque enregistrement, documents compris. Il ne se désactive pas.">
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between"><span>État</span><Badge tone="green">Activé</Badge></div>
        <p className="text-xs text-slate-500">La phrase secrète est demandée à chaque ouverture et après verrouillage. Elle n'est pas stockée. Phrase oubliée : cet appareil ne peut plus lire ses données.</p>
        <div className="grid gap-2 sm:grid-cols-2"><Input type="password" placeholder="Phrase actuelle" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="current-password" /><Input type="password" placeholder="Nouvelle phrase" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !p1 || !p2} onClick={() => run(() => changeVaultPass(p1, p2), 'Phrase secrète modifiée')}>Changer la phrase</Button>
          <Button variant="ghost" icon={<Lock size={15} />} onClick={() => lockVault()}>Verrouiller maintenant</Button>
        </div>
      </div>
    </Card>
  );
}
