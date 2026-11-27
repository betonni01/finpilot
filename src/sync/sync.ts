/**
 * Synchronisation multiappareil chiffrée de bout en bout.
 * Chaque enregistrement est chiffré avec la clé de données (connue des seuls appareils de l'utilisateur)
 * avant d'être envoyé. Résolution des conflits : la modification la plus récente l'emporte, enregistrement par enregistrement.
 */
import Dexie from 'dexie';
import { db, DATA_TABLES, nowIso, uid, type MetaRow } from '../db/db';
import { b64, getKey, markRemote, openText, sealText, unb64 } from '../db/secure';
import { adoptKey, readDocBytes, storeBlob, unwrapKey, wrapKey } from '../db/vault';
import { activeProfile, updateProfile } from '../db/profiles';

export const SYNC_TABLES = [...DATA_TABLES, 'docs'] as const;
export interface SyncConfig extends MetaRow {
  id: 'sync'; server: string; email: string; access?: string; refresh?: string; lastSeq: number; device: string;
  enabled: boolean; lastSyncAt?: string | null; lastError?: string | null; autoMin: number; push?: boolean; detailedReminders?: boolean; tokensEnc?: boolean;
  stats?: { sent: number; received: number; conflicts: number }; isStaff?: boolean;
}

/** Adresse de l'API. En production (Firebase) elle est figée à la construction ; en local, c'est l'origine (le proxy Vite relaie /api). */
export const defaultServer = () => {
  const configured = (import.meta.env.VITE_FINPILOT_API as string | undefined)?.replace(/\/$/, '');
  if (configured) return configured;
  return typeof location !== 'undefined' && location.protocol.startsWith('http') ? location.origin : '';
};
async function readRaw(): Promise<SyncConfig | undefined> { return (await db.meta.get('sync')) as SyncConfig | undefined; }
/** Config lisible. Les jetons de session restent chiffrés sur le disque et ne sont déchiffrés qu'en mémoire, coffre ouvert. */
export async function getConfig(): Promise<SyncConfig | undefined> {
  const raw = await readRaw();
  if (!raw) return;
  if (!raw.tokensEnc) return raw;
  const key = getKey();
  if (!key) return { ...raw, access: undefined, refresh: undefined };
  try {
    return { ...raw, tokensEnc: false, access: raw.access ? openText(key, raw.access) : undefined, refresh: raw.refresh ? openText(key, raw.refresh) : undefined };
  } catch { return { ...raw, access: undefined, refresh: undefined }; }
}
export async function updateSyncConfig(p: Partial<SyncConfig>) {
  const cur = (await getConfig()) ?? ({ id: 'sync', server: defaultServer(), email: '', lastSeq: 0, device: uid(), enabled: false, autoMin: 5 } as SyncConfig);
  const next = { ...cur, ...p, tokensEnc: false } as SyncConfig;
  const key = getKey();
  const stored: SyncConfig = { ...next };
  if (key && (next.access || next.refresh)) {
    stored.tokensEnc = true;
    if (next.access) stored.access = sealText(key, next.access);
    if (next.refresh) stored.refresh = sealText(key, next.refresh);
  }
  await db.meta.put(stored);
  listeners.forEach((l) => l(next));
  return next;
}
const setConfig = updateSyncConfig;
type Listener = (c: SyncConfig) => void;
const listeners = new Set<Listener>();
export function onConfig(l: Listener) { listeners.add(l); return () => listeners.delete(l); }

// ------------------------------------------------------------------ HTTP
export class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }
async function raw(server: string, path: string, init: RequestInit = {}, token?: string) {
  let res: Response;
  try {
    res = await fetch(`${server.replace(/\/$/, '')}/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  } catch { throw new ApiError('Serveur injoignable. Vérifie la connexion ou l\'adresse du serveur.', 0); }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(data.detail || (res.status === 401 ? 'Session expirée, reconnecte-toi.' : `Erreur serveur (${res.status})`), res.status);
  return data;
}
export async function api(path: string, init: RequestInit = {}) {
  const c = await getConfig();
  if (!c?.access) throw new ApiError('Non connecté', 401);
  try { return await raw(c.server, path, init, c.access); }
  catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401 || !c.refresh) throw e;
    const t = await raw(c.server, '/auth/token/refresh/', { method: 'POST', body: JSON.stringify({ refresh: c.refresh }) }).catch(async (err) => { await setConfig({ access: undefined, refresh: undefined, lastError: 'Session expirée, reconnecte-toi.' }); throw err; });
    await setConfig({ access: t.access, refresh: t.refresh ?? c.refresh });
    return raw(c.server, path, init, t.access);
  }
}

// ------------------------------------------------------------------ connexion
export interface ConnectOpts { server: string; email: string; password: string; create: boolean; passphrase: string; mode: 'replace' | 'merge'; vaultPass?: string; invite?: string }
export async function connect(o: ConnectOpts): Promise<'new' | 'joined'> {
  const server = o.server.replace(/\/$/, '');
  const email = o.email.trim().toLowerCase();
  const tokens = o.create
    ? await raw(server, '/auth/register/', { method: 'POST', body: JSON.stringify({ email, password: o.password, invite: o.invite ?? '' }) })
    : await raw(server, '/auth/token/', { method: 'POST', body: JSON.stringify({ username: email, password: o.password }) });
  const prev = await getConfig();
  // la synchro automatique reste coupée tant que la clé n'est pas en place
  await setConfig({ server, email, access: tokens.access, refresh: tokens.refresh, lastSeq: 0, enabled: false, lastError: null, device: prev?.device ?? uid() });
  try { updateProfile(activeProfile().id, { email }); } catch { /* registre indisponible */ }
  const me = await api('/auth/me/').catch(() => null);
  if (me) await setConfig({ isStaff: !!me.is_staff });
  const info = await api('/sync/keyinfo/');
  if (!info.has_key) {
    if (o.passphrase.length < 10) throw new Error('La phrase secrète de synchronisation doit contenir au moins 10 caractères.');
    const key = getKey();
    if (!key) throw new Error('Clé locale indisponible.');
    await api('/sync/keyinfo/', { method: 'PUT', body: JSON.stringify(await wrapKey(o.passphrase, key)) });
    await markAllDirty();
    await setConfig({ enabled: true });
    await syncNow();
    return 'new';
  }
  const serverKey = await unwrapKey(o.passphrase, info);
  await adoptKey(serverKey, o.vaultPass);
  if (o.mode === 'replace') {
    const tables = SYNC_TABLES.map((t) => db.table(t));
    await db.transaction('rw', tables, async () => { markRemote(Dexie.currentTransaction?.idbtrans); for (const t of tables) await t.clear(); });
    await db.outbox.clear();
  } else await markAllDirty();
  await setConfig({ enabled: true });
  await syncNow();
  return 'joined';
}

export async function disconnect(everywhere = false) {
  if (everywhere) await api('/auth/logout-all/', { method: 'POST' }).catch(() => {});
  await setConfig({ access: undefined, refresh: undefined, enabled: false, push: false });
  try { updateProfile(activeProfile().id, { email: null }); } catch { /* */ }
}

/** Marque toutes les données locales à envoyer. Horodatage minimal : en cas de doublon, la version du serveur l'emporte. */
export async function markAllDirty() {
  for (const t of SYNC_TABLES) {
    const keys = await db.table(t).toCollection().primaryKeys();
    const rows = keys.map((key) => ({ k: `${t}|${String(key)}`, table: t, key: String(key), deleted: false, ts: 1 }));
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const existing = new Set((await db.outbox.bulkGet(chunk.map((r) => r.k))).filter(Boolean).map((r) => r!.k));
      await db.outbox.bulkPut(chunk.filter((r) => !existing.has(r.k)));
    }
  }
}

// ------------------------------------------------------------------ cycle de synchro
let running: Promise<SyncConfig | undefined> | null = null;
export function syncNow() { if (!running) running = doSync().finally(() => { running = null; }); return running; }

async function encodeRow(table: string, row: Record<string, unknown>) {
  const key = getKey()!;
  if (table === 'docs') {
    const bytes = await readDocBytes(row as never);
    const { blob: _b, blobEnc: _e, ...rest } = row;
    return sealText(key, JSON.stringify({ ...rest, __blob: b64(bytes) }));
  }
  return sealText(key, JSON.stringify(row));
}
async function decodeRow(table: string, payload: string) {
  const row = JSON.parse(openText(getKey()!, payload)) as Record<string, unknown>;
  if (table === 'docs' && typeof row.__blob === 'string') {
    const stored = await storeBlob(unb64(row.__blob as string), String(row.mime ?? 'application/octet-stream'));
    delete row.__blob;
    Object.assign(row, stored);
  }
  return row;
}
interface Remote { table: string; key: string; seq: number; updated_at: number; deleted: boolean; payload: string; device?: string }

async function applyRemote(records: Remote[], myDevice: string, skipOwn = true): Promise<number> {
  const todo = records.filter((r) => (SYNC_TABLES as readonly string[]).includes(r.table) && (!skipOwn || r.device !== myDevice));
  if (!todo.length) return 0;
  const pending = new Map((await db.outbox.bulkGet(todo.map((r) => `${r.table}|${r.key}`))).filter(Boolean).map((o) => [o!.k, o!]));
  const ready: { r: Remote; row?: Record<string, unknown> }[] = [];
  for (const r of todo) {
    const local = pending.get(`${r.table}|${r.key}`);
    if (local && local.ts > r.updated_at) continue; // modification locale plus récente : elle sera envoyée
    ready.push({ r, row: r.deleted ? undefined : await decodeRow(r.table, r.payload) });
  }
  const tables = [...new Set(ready.map((x) => x.r.table))].map((t) => db.table(t));
  if (!tables.length) return 0;
  await db.transaction('rw', [...tables, db.outbox], async () => {
    markRemote(Dexie.currentTransaction?.idbtrans);
    for (const { r, row } of ready) {
      const t = db.table(r.table);
      if (r.deleted) await t.delete(r.key);
      else await t.put(row);
      await db.outbox.delete(`${r.table}|${r.key}`);
    }
  });
  return ready.length;
}

async function doSync(): Promise<SyncConfig | undefined> {
  let c = await getConfig();
  if (!c?.enabled || !c.access || !getKey()) return c;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return setConfig({ lastError: 'Hors ligne : synchronisation en attente.' });
  let sent = 0, received = 0, conflicts = 0;
  try {
    // 1. envoi
    for (let guard = 0; guard < 200; guard++) {
      const batch = await db.outbox.orderBy('ts').limit(150).toArray();
      if (!batch.length) break;
      const records: Record<string, unknown>[] = [];
      let size = 0;
      for (const o of batch) {
        const row = o.deleted ? undefined : await db.table(o.table).get(o.key);
        const payload = row ? await encodeRow(o.table, row) : '';
        size += payload.length;
        records.push({ table: o.table, key: o.key, updated_at: o.ts, deleted: !row, payload });
        if (size > 8_000_000) break;
      }
      const res = await api('/sync/push/', { method: 'POST', body: JSON.stringify({ device: c.device, records }) });
      const sentKeys = records.map((r) => `${r.table}|${r.key}`);
      const sentTs = new Map(batch.map((o) => [o.k, o.ts]));
      await db.transaction('rw', db.outbox, async () => {
        for (const k of sentKeys) { const cur = await db.outbox.get(k); if (cur && cur.ts === sentTs.get(k)) await db.outbox.delete(k); }
      });
      sent += res.accepted.length;
      if (res.conflicts.length) { conflicts += res.conflicts.length; await applyRemote(res.conflicts, c.device, false); }
    }
    // 2. réception
    for (let guard = 0; guard < 500; guard++) {
      c = (await getConfig())!;
      const res = await api(`/sync/pull/?since=${c.lastSeq}`);
      received += await applyRemote(res.records, c.device);
      await setConfig({ lastSeq: res.last_seq });
      if (!res.has_more) break;
    }
    if (sent || received || conflicts) await db.audit.add({ at: nowIso(), entity: 'system', entityId: 'sync', action: 'update', summary: `Synchronisation : ${sent} envoyé(s), ${received} reçu(s)${conflicts ? `, ${conflicts} conflit(s) résolu(s) en faveur de la version la plus récente` : ''}` });
    const next = await setConfig({ lastSyncAt: nowIso(), lastError: null, stats: { sent, received, conflicts } });
    if (next.push) import('./push').then((m) => m.scheduleReminders()).catch(() => {});
    return next;
  } catch (e) {
    return setConfig({ lastError: (e as Error).message });
  }
}

export async function pendingCount() { return db.outbox.count(); }

// ------------------------------------------------------------------ informations serveur et mot de passe oublié
export interface ServerInfo { status: string; push: boolean; registration: 'open' | 'invite' | 'closed'; first_user: boolean; password_reset_email: boolean }
export async function serverInfo(server: string): Promise<ServerInfo> { return raw(server, '/health/'); }
export async function requestPasswordReset(server: string, email: string): Promise<{ email_enabled: boolean }> {
  return raw(server, '/auth/password-reset/', { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase() }) });
}
export async function confirmPasswordReset(server: string, email: string, code: string, newPassword: string) {
  return raw(server, '/auth/password-reset/confirm/', { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), code, new_password: newPassword }) });
}
export async function refreshMe() {
  const me = await api('/auth/me/');
  await setConfig({ isStaff: !!me.is_staff });
  return me as { email: string; is_staff: boolean; usage_bytes: number; quota_bytes: number; records: number; date_joined: string };
}
