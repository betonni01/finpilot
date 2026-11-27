/**
 * Couche de stockage sécurisée (middleware Dexie) :
 *  1. chiffre chaque enregistrement (AES-256-GCM) lorsque le coffre est activé.
 *     Seule la clé primaire reste en clair : dates, catégories, montants et libellés sont dans le champ `_e`.
 *     Les index Dexie ne reçoivent donc pas ces valeurs.
 *  2. note chaque modification dans la table `outbox` pour la synchronisation (sauf écritures venant du serveur).
 */
import { gcm } from '@noble/ciphers/aes.js';
import type { DBCore, DBCoreTable, DBCoreMutateRequest, DBCoreTransaction, Middleware } from 'dexie';

export const LOCAL_ONLY = new Set(['audit', 'meta', 'outbox']);
/** binaires laissés hors du JSON chiffré (le contenu est chiffré à part quand le coffre est actif) */
const RAW_FIELDS: Record<string, string[]> = { docs: ['blob', 'blobEnc'] };

let dek: Uint8Array | null = null;
let vaultOn = false;

export function setKey(key: Uint8Array | null) { dek = key; }
export function getKey() { return dek; }
export function setVaultMode(on: boolean) { vaultOn = on; }
export function isVaultOn() { return vaultOn; }

// ---------------------------------------------------------------- utilitaires
const te = new TextEncoder();
const td = new TextDecoder();
export function b64(u: Uint8Array): string { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }
export function unb64(s: string): Uint8Array { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
export function randomBytes(n: number) { return crypto.getRandomValues(new Uint8Array(n)); }

export function sealBytes(key: Uint8Array, data: Uint8Array): Uint8Array {
  const iv = randomBytes(12);
  const ct = gcm(key, iv).encrypt(data);
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}
export function openBytes(key: Uint8Array, data: Uint8Array): Uint8Array {
  return gcm(key, data.subarray(0, 12)).decrypt(data.subarray(12));
}
export const sealText = (key: Uint8Array, s: string) => b64(sealBytes(key, te.encode(s)));
export const openText = (key: Uint8Array, s: string) => td.decode(openBytes(key, unb64(s)));

/** Dérive une clé de 256 bits d'une phrase secrète (PBKDF2-SHA256). À appeler hors transaction. */
export async function deriveKey(pass: string, salt: Uint8Array, iterations = 600_000): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base, 256);
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------- chiffrement des enregistrements
type Row = Record<string, unknown>;
function clearFields(table: DBCoreTable): Set<string> {
  const s = new Set<string>();
  const kp = table.schema.primaryKey.keyPath;
  if (typeof kp === 'string') s.add(kp.split('.')[0]);
  (RAW_FIELDS[table.name] ?? []).forEach((f) => s.add(f));
  return s;
}
export function encryptRow(row: Row, clear: Set<string>, key: Uint8Array): Row {
  if (!row || typeof row !== 'object') return row;
  const out: Row = {}; const secret: Row = {};
  for (const [k, v] of Object.entries(row)) { if (clear.has(k)) out[k] = v; else secret[k] = v; }
  out._e = sealText(key, JSON.stringify(secret));
  return out;
}
export function decryptRow(row: Row | undefined): Row | undefined {
  if (!row || typeof row !== 'object' || typeof row._e !== 'string') return row;
  if (!dek) throw new Error('Coffre verrouillé : déverrouille FINPILOT pour lire les données.');
  const { _e, ...rest } = row;
  return { ...rest, ...JSON.parse(openText(dek, _e as string)) };
}

// ---------------------------------------------------------------- middleware
type Tx = DBCoreTransaction & { __remote?: boolean };
export function markRemote(trans: unknown) { if (trans) (trans as Tx).__remote = true; }

export const secureMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'finpilot-secure',
  create(down) {
    return {
      ...down,
      transaction(stores, mode, options) {
        const s = mode === 'readwrite' && stores.some((x) => !LOCAL_ONLY.has(x)) && !stores.includes('outbox') ? [...stores, 'outbox'] : stores;
        return down.transaction(s, mode, options);
      },
      table(name) {
        const t = down.table(name);
        if (name === 'meta' || name === 'outbox') return t;
        const clear = clearFields(t);
        const pk = t.schema.primaryKey.keyPath as string | null;
        const synced = !LOCAL_ONLY.has(name);
        const track = async (req: DBCoreMutateRequest, keys: unknown[], deleted: boolean) => {
          if (!synced || (req.trans as Tx).__remote || !keys.length) return;
          const ts = Date.now();
          await down.table('outbox').mutate({ trans: req.trans, type: 'put', values: keys.map((key) => ({ k: `${name}|${String(key)}`, table: name, key, deleted, ts })) });
        };
        return {
          ...t,
          async mutate(req) {
            if (req.type === 'add' || req.type === 'put') {
              const keys = pk ? req.values.map((v) => (v as Row)[pk]) : (req.keys ?? []);
              const values = vaultOn && dek ? req.values.map((v) => encryptRow(v as Row, clear, dek!)) : req.values;
              const res = await t.mutate({ ...req, values } as DBCoreMutateRequest);
              await track(req, keys.filter((k) => k != null), false);
              return res;
            }
            if (req.type === 'delete') {
              const res = await t.mutate(req);
              await track(req, req.keys as unknown[], true);
              return res;
            }
            if (req.type === 'deleteRange') {
              let keys: unknown[] = [];
              if (synced && !(req.trans as Tx).__remote) keys = (await t.query({ trans: req.trans, values: false, query: { index: t.schema.primaryKey, range: req.range } })).result as unknown[];
              const res = await t.mutate(req);
              await track(req, keys, true);
              return res;
            }
            return t.mutate(req);
          },
          async get(req) { return decryptRow(await t.get(req)); },
          async getMany(req) { return (await t.getMany(req)).map((r) => decryptRow(r)); },
          async query(req) {
            const res = await t.query(req);
            return req.values ? { ...res, result: res.result.map((r) => decryptRow(r as Row)) } : res;
          },
          async openCursor(req) {
            const c = await t.openCursor(req);
            if (!c || !req.values) return c;
            return new Proxy(c, { get(target, p) { if (p === 'value') return decryptRow(target.value as Row); const v = Reflect.get(target, p, target); return typeof v === 'function' ? v.bind(target) : v; } });
          },
        };
      },
    };
  },
};
