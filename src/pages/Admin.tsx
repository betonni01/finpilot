import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, ShieldCheck, Trash2, UserCheck, UserX, Ticket } from 'lucide-react';
import { api, getConfig } from '../sync/sync';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Stat, Table, td, useUI } from '../ui/ui';

interface U { id: number; email: string; date_joined: string; last_login: string | null; is_active: boolean; is_staff: boolean; records: number; usage_bytes: number }
interface Inv { id: number; code: string; note: string; max_uses: number; uses: number; expires_at: string | null; revoked: boolean; valid: boolean; created_at: string }
const mb = (b: number) => (b < 1048576 ? `${Math.max(b ? 1 : 0, Math.round(b / 1024))} Ko` : (b / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo');
const d = (s?: string | null) => (s ? new Date(s).toLocaleDateString('fr-FR') : '—');

export default function Admin() {
  const ui = useUI();
  const [users, setUsers] = useState<U[]>([]);
  const [meta, setMeta] = useState<{ registration: string; quota_bytes: number; email_enabled: boolean } | null>(null);
  const [invites, setInvites] = useState<Inv[]>([]);
  const [err, setErr] = useState('');
  const [server, setServer] = useState('');
  const [note, setNote] = useState('');
  const [uses, setUses] = useState('1');
  const [days, setDays] = useState('14');
  const [created, setCreated] = useState<Inv | null>(null);
  const [reset, setReset] = useState<{ email: string; code: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const [u, i, c] = await Promise.all([api('/admin/users/'), api('/admin/invites/'), getConfig()]);
      setUsers(u.users); setMeta(u); setInvites(i.invites); setServer(c?.server ?? ''); setErr('');
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); const f = () => document.visibilityState === 'visible' && load(); document.addEventListener('visibilitychange', f); window.addEventListener('focus', f); return () => { document.removeEventListener('visibilitychange', f); window.removeEventListener('focus', f); }; }, [load]);
  const message = (code: string) => `Je t'invite à utiliser FINPILOT, mon application de pilotage financier.\n1. Ouvre ${server}\n2. Choisis « Créer mon compte »\n3. Code d'invitation : ${code}\nTes données sont chiffrées sur ton appareil : personne d'autre, pas même moi, ne peut les lire.`;
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); ui.toast('Copié'); } catch { ui.toast('Copie impossible : sélectionne le texte', 'err'); } };

  if (err) return <div className="space-y-5"><PageHeader title="Administration" /><Card><Empty icon={<ShieldCheck size={36} />} title="Accès réservé à l'administrateur du serveur" text={err} /></Card></div>;
  const active = users.filter((u) => u.is_active).length;
  return (
    <div className="space-y-5">
      <PageHeader title="Administration du serveur" subtitle="Gère qui peut utiliser FINPILOT. Tu ne vois que des volumes : les données de chacun sont chiffrées sur ses appareils et illisibles ici." actions={<Button onClick={load}>Actualiser</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Comptes" value={String(users.length)} hint={`${active} actif(s)`} />
        <Stat label="Stockage total" value={mb(users.reduce((a, u) => a + u.usage_bytes, 0))} hint={meta ? `quota ${mb(meta.quota_bytes)} par compte` : ''} />
        <Stat label="Inscription" value={meta?.registration === 'invite' ? 'Sur invitation' : meta?.registration === 'open' ? 'Libre' : meta?.registration === 'closed' ? 'Fermée' : '—'} hint="réglage FINPILOT_REGISTRATION" />
        <Stat label="E-mails de réinitialisation" value={meta?.email_enabled ? 'Actifs' : 'Non configurés'} hint={meta?.email_enabled ? '' : 'tu fournis les codes toi-même'} />
      </div>

      <Card title={<span className="flex items-center gap-2"><Ticket size={16} />Inviter quelqu'un</span>}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Pour qui (note)" className="sm:col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. Koffi, cousin" /></Field>
          <Field label="Utilisations"><Input type="number" min={1} value={uses} onChange={(e) => setUses(e.target.value)} /></Field>
          <Field label="Valable (jours, 0 = illimité)"><Input type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        </div>
        <Button className="mt-3" variant="primary" icon={<Plus size={15} />} onClick={async () => { try { const inv = await api('/admin/invites/', { method: 'POST', body: JSON.stringify({ note, max_uses: Number(uses), days: Number(days) }) }); setCreated(inv); setNote(''); load(); } catch (e) { ui.toast((e as Error).message, 'err'); } }}>Créer un code d'invitation</Button>
        {invites.length > 0 && (
          <Table className="mt-4" head={['Code', 'Pour', 'Utilisé', 'Expire', 'État', '']}>
            {invites.map((i) => (
              <tr key={i.id}>
                <td className={td + ' font-mono font-medium tracking-wider'}>{i.code}</td><td className={td}>{i.note || '—'}</td><td className={td}>{i.uses}/{i.max_uses}</td><td className={td + ' text-xs'}>{i.expires_at ? d(i.expires_at) : 'jamais'}</td>
                <td className={td}>{i.valid ? <Badge tone="green">Valide</Badge> : i.revoked ? <Badge>Révoqué</Badge> : <Badge tone="amber">Épuisé ou expiré</Badge>}</td>
                <td className={td + ' whitespace-nowrap text-right'}>{i.valid && <><Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => copy(message(i.code))}>Message</Button><Button size="sm" variant="ghost" onClick={async () => { await api(`/admin/invites/${i.id}/`, { method: 'DELETE' }); load(); }}>Révoquer</Button></>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Comptes" pad={false}>
        <div className="px-4 pb-3 sm:px-5">
          <Table head={['E-mail', 'Inscrit', 'Dernière connexion', 'Données', 'Stockage', 'État', '']}>
            {users.map((u) => (
              <tr key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                <td className={td}><span className="font-medium">{u.email}</span>{u.is_staff && <Badge tone="violet" className="ml-1">admin</Badge>}</td>
                <td className={td + ' text-xs'}>{d(u.date_joined)}</td><td className={td + ' text-xs'}>{d(u.last_login)}</td>
                <td className={td + ' text-xs'}>{u.records} enr.</td><td className={td + ' text-xs'}>{mb(u.usage_bytes)}</td>
                <td className={td}>{u.is_active ? <Badge tone="green">Actif</Badge> : <Badge tone="red">Désactivé</Badge>}</td>
                <td className={td + ' whitespace-nowrap text-right'}>
                  <button title="Code de réinitialisation du mot de passe" className="rounded p-1.5 text-slate-400 hover:text-slate-700" onClick={async () => { try { const r = await api(`/admin/users/${u.id}/reset-code/`, { method: 'POST' }); setReset(r); } catch (e) { ui.toast((e as Error).message, 'err'); } }}><KeyRound size={15} /></button>
                  <button title={u.is_active ? 'Désactiver' : 'Réactiver'} className="rounded p-1.5 text-slate-400 hover:text-slate-700" onClick={async () => { try { await api(`/admin/users/${u.id}/`, { method: 'PATCH', body: JSON.stringify({ is_active: !u.is_active }) }); load(); } catch (e) { ui.toast((e as Error).message, 'err'); } }}>{u.is_active ? <UserX size={15} /> : <UserCheck size={15} />}</button>
                  <button title="Supprimer le compte et ses données" className="rounded p-1.5 text-slate-400 hover:text-rose-600" onClick={async () => { if (await ui.confirm({ title: `Supprimer ${u.email} ?`, text: 'Le compte et toutes ses données synchronisées seront effacés du serveur. Les données restent sur ses appareils.', danger: true, typed: 'SUPPRIMER' })) { try { await api(`/admin/users/${u.id}/`, { method: 'DELETE' }); load(); } catch (e) { ui.toast((e as Error).message, 'err'); } } }}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>

      <Modal open={!!created} onClose={() => setCreated(null)} title="Invitation créée" footer={<><Button onClick={() => copy(created!.code)} icon={<Copy size={15} />}>Copier le code</Button><Button variant="primary" onClick={() => copy(message(created!.code))} icon={<Copy size={15} />}>Copier le message</Button></>}>
        {created && <div className="space-y-3 text-sm"><div className="rounded-xl bg-slate-100 py-4 text-center font-mono text-2xl font-semibold tracking-[0.2em] dark:bg-slate-800">{created.code}</div><pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">{message(created.code)}</pre></div>}
      </Modal>
      <Modal open={!!reset} onClose={() => setReset(null)} title="Code de réinitialisation" footer={<Button variant="primary" icon={<Copy size={15} />} onClick={() => copy(`Code de réinitialisation FINPILOT pour ${reset!.email} : ${reset!.code} (valable 24 h). Dans l'application : « J'ai déjà un compte » › « Mot de passe oublié ? » › « J'ai déjà un code ».`)}>Copier le message</Button>}>
        {reset && <div className="space-y-3 text-sm"><p>Transmets ce code à <b>{reset.email}</b> par un canal sûr. Il est valable 24 heures et ne sert qu'une fois.</p><div className="rounded-xl bg-slate-100 py-4 text-center font-mono text-2xl font-semibold tracking-[0.2em] dark:bg-slate-800">{reset.code}</div><p className="text-xs text-slate-500">Le nouveau mot de passe ne donne pas accès aux données : la personne aura toujours besoin de sa phrase secrète.</p></div>}
      </Modal>
    </div>
  );
}
