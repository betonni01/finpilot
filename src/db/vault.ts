/** Gestion des clés : clé de données (DEK), coffre local protégé par phrase secrète, documents chiffrés. */
import Dexie from 'dexie';
import { db, VAULT_TABLES, nowIso } from './db';
import { b64, deriveKey, getKey, isVaultOn, markRemote, openBytes, randomBytes, sealBytes, setKey, setVaultMode, unb64 } from './secure';
import type { DocFile } from '../engine/types';

export const KDF_ITER = 600_000;
export interface VaultMeta { id: 'vault'; salt: string; iter: number; wrapped: string; createdAt: string }
export interface KeysMeta { id: 'keys'; dek: string }

export type VaultBoot = 'locked' | 'ready' | 'setup' | 'migrate';
const lockListeners = new Set<() => void>();
export function onVaultLock(fn: () => void) { lockListeners.add(fn); return () => { lockListeners.delete(fn); }; }
/** Efface la clé de la mémoire. Les données sur disque restent illisibles tant que la phrase n'est pas ressaisie. */
export function lockVault() {
  setKey(null);
  lockListeners.forEach((fn) => fn());
}

/** Au démarrage. La clé n'est jamais écrite en clair : sans coffre, l'application demande une phrase avant d'ouvrir les données. */
export async function initKeys(): Promise<VaultBoot> {
  await db.open();
  const v = (await db.meta.get('vault')) as VaultMeta | undefined;
  if (v) { setVaultMode(true); return getKey() ? 'ready' : 'locked'; }
  setVaultMode(false);
  const k = (await db.meta.get('keys')) as KeysMeta | undefined;
  if (k?.dek) { setKey(unb64(k.dek)); return 'migrate'; }
  setKey(null);
  return 'setup';
}

export async function wrapKey(pass: string, key: Uint8Array, salt = randomBytes(16), iter = KDF_ITER) {
  const kek = await deriveKey(pass, salt, iter);
  return { salt: b64(salt), iter, wrapped: b64(sealBytes(kek, key)) };
}
export async function unwrapKey(pass: string, w: { salt: string; iter: number; wrapped: string }): Promise<Uint8Array> {
  const kek = await deriveKey(pass, unb64(w.salt), w.iter);
  try { return openBytes(kek, unb64(w.wrapped)); } catch { throw new Error('Phrase secrète incorrecte.'); }
}

const GUARD_ID = 'vault-guard';
interface Guard { id: string; fails: number; until: number }
async function readGuard(): Promise<Guard> {
  return ((await db.meta.get(GUARD_ID)) as Guard | undefined) ?? { id: GUARD_ID, fails: 0, until: 0 };
}
/** Secondes à attendre avant un nouvel essai (survit à un rechargement de la page). */
export async function vaultDelay(): Promise<number> {
  const g = await readGuard();
  return Math.max(0, Math.ceil((g.until - Date.now()) / 1000));
}
export async function noteVaultFailure(): Promise<number> {
  const g = await readGuard();
  const fails = g.fails + 1;
  const wait = fails >= 5 ? Math.min(900, 30 * 2 ** (Math.floor(fails / 5) - 1)) : 0;
  await db.meta.put({ id: GUARD_ID, fails, until: Date.now() + wait * 1000 } as Guard);
  return wait;
}
export async function noteVaultSuccess() { await db.meta.delete(GUARD_ID); }

export async function unlockVault(pass: string) {
  const wait = await vaultDelay();
  if (wait > 0) throw new Error(`Trop d'essais. Réessaie dans ${wait} s.`);
  const v = (await db.meta.get('vault')) as VaultMeta | undefined;
  if (!v) throw new Error('Aucun coffre sur cet appareil.');
  try {
    setKey(await unwrapKey(pass, v));
  } catch (e) {
    await noteVaultFailure();
    throw e;
  }
  setVaultMode(true);
  await noteVaultSuccess();
}

export function checkPassphrase(p: string): string | null {
  if (p.length < 10) return 'La phrase secrète doit contenir au moins 10 caractères.';
  if (!/\s|[^a-zA-Z]/.test(p)) return 'Ajoute des chiffres, des symboles ou plusieurs mots.';
  return null;
}

/** Réécrit toutes les tables avec le mode/la clé voulus, sans rien marquer pour la synchro. */
async function rewriteAll(mode: { vault: boolean; key: Uint8Array }) {
  const tables = VAULT_TABLES.map((t) => db.table(t));
  // 1. lire en clair avec l'état actuel
  const data: Record<string, unknown[]> = {};
  for (const t of tables) data[t.name] = await t.toArray();
  // 2. documents : (dé)chiffrer les contenus hors transaction
  const docs = data.docs as DocFile[];
  for (const d of docs) {
    const plain = await readDocBytes(d);
    d.blob = new Blob([(mode.vault ? sealBytes(mode.key, plain) : plain) as BlobPart], { type: mode.vault ? 'application/octet-stream' : d.mime });
    d.blobEnc = mode.vault;
  }
  // 3. basculer et réécrire
  setKey(mode.key);
  setVaultMode(mode.vault);
  await db.transaction('rw', tables, async () => {
    markRemote(Dexie.currentTransaction?.idbtrans);
    for (const t of tables) { await t.clear(); await t.bulkPut(data[t.name]); }
  });
}

export async function enableVault(pass: string) {
  const err = checkPassphrase(pass);
  if (err) throw new Error(err);
  const key = getKey() ?? randomBytes(32);
  const w = await wrapKey(pass, key);
  await rewriteAll({ vault: true, key });
  await db.meta.put({ id: 'vault', ...w, createdAt: nowIso() } as VaultMeta);
  await db.meta.delete('keys');
  await db.audit.add({ at: nowIso(), entity: 'system', entityId: 'vault', action: 'create', summary: 'Coffre chiffré activé' });
}

export async function disableVault(_pass: string): Promise<never> {
  throw new Error('Le coffre ne peut pas être désactivé : les données restent chiffrées sur cet appareil.');
}

export async function changeVaultPass(oldPass: string, newPass: string) {
  const err = checkPassphrase(newPass);
  if (err) throw new Error(err);
  const v = (await db.meta.get('vault')) as VaultMeta;
  const key = await unwrapKey(oldPass, v);
  await db.meta.put({ ...v, ...(await wrapKey(newPass, key)) });
}

/** Remplace la clé de données (rejoindre un compte de synchro existant). Avec le coffre, sa phrase secrète est requise pour réenvelopper la clé. */
export async function adoptKey(key: Uint8Array, vaultPass?: string) {
  const cur = getKey();
  if (cur && b64(cur) === b64(key)) return;
  if (isVaultOn()) {
    const v = (await db.meta.get('vault')) as VaultMeta;
    if (!vaultPass) throw new Error('Phrase secrète du coffre requise.');
    await unwrapKey(vaultPass, v); // vérifie la phrase avant toute réécriture
    const w = await wrapKey(vaultPass, key);
    await rewriteAll({ vault: true, key });
    await db.meta.put({ ...v, ...w });
  } else {
    throw new Error('Active d\'abord le coffre : la clé ne peut pas être enregistrée en clair.');
  }
}

// ---------------------------------------------------------------- documents
export async function readDocBytes(d: Pick<DocFile, 'blob' | 'blobEnc'>): Promise<Uint8Array> {
  const raw = new Uint8Array(await d.blob.arrayBuffer());
  if (!d.blobEnc) return raw;
  const k = getKey();
  if (!k) throw new Error('Coffre verrouillé');
  return openBytes(k, raw);
}
/** Contenu lisible d'un document (déchiffré si nécessaire). */
export async function docBlob(d: Pick<DocFile, 'blob' | 'blobEnc' | 'mime'>): Promise<Blob> {
  if (!d.blobEnc) return d.blob;
  return new Blob([(await readDocBytes(d)) as BlobPart], { type: d.mime });
}
/** Prépare un contenu à stocker selon le mode courant. */
export async function storeBlob(bytes: Uint8Array, mime: string): Promise<{ blob: Blob; blobEnc: boolean }> {
  const k = getKey();
  if (isVaultOn() && k) return { blob: new Blob([sealBytes(k, bytes) as BlobPart], { type: 'application/octet-stream' }), blobEnc: true };
  return { blob: new Blob([bytes as BlobPart], { type: mime }), blobEnc: false };
}
