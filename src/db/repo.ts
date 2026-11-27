import { db, nowIso, uid, DATA_TABLES, type DataTable, DEFAULT_SETTINGS, DEFAULT_CATEGORIES, DEFAULT_RATES } from './db';
import { occId } from '../engine/recurrence';
import { today } from '../engine/date';
import type { Account, Cotisation, Debt, DocFile, Goal, Occurrence, Rule, Settings, Tx } from '../engine/types';
import type { Table } from 'dexie';
import { docBlob, readDocBytes, storeBlob } from './vault';
import { setKey, setVaultMode } from './secure';

type AnyRow = { id: string } & Record<string, unknown>;
const T = (name: DataTable | 'docs') => (db as unknown as Record<string, Table<AnyRow, string>>)[name];

function strip(o: unknown) {
  if (!o || typeof o !== 'object') return o;
  const { blob, ...rest } = o as Record<string, unknown>;
  return blob ? { ...rest, blob: '[fichier]' } : rest;
}

/** Écriture tracée : chaque modification financière est historisée (quoi, quand, pourquoi). */
export async function save<R extends { id: string }>(table: DataTable | 'docs', row: R, summary?: string): Promise<R> {
  const t = T(table);
  await db.transaction('rw', t, db.audit, async () => {
    const before = await t.get(row.id);
    const at = nowIso();
    const next = { ...row } as unknown as AnyRow;
    if ('updatedAt' in next || table === 'accounts' || table === 'txs' || table === 'rules') next.updatedAt = at;
    if (!before && !next.createdAt && table !== 'settings' && table !== 'rates') next.createdAt = at;
    await t.put(next);
    await db.audit.add({ at, entity: table, entityId: row.id, action: before ? 'update' : 'create', summary: summary ?? '', before: strip(before), after: strip(next) });
  });
  return row;
}
export async function remove(table: DataTable | 'docs', id: string, summary?: string) {
  const t = T(table);
  await db.transaction('rw', t, db.audit, async () => {
    const before = await t.get(id);
    if (!before) return;
    await t.delete(id);
    await db.audit.add({ at: nowIso(), entity: table, entityId: id, action: 'delete', summary: summary ?? '', before: strip(before) });
  });
}

export async function updateSettings(patch: Partial<Settings>, summary = 'Paramètres modifiés') {
  const cur = (await db.settings.get('main')) ?? DEFAULT_SETTINGS;
  await save('settings', { ...cur, ...patch, id: 'main' }, summary);
}

/** Change la devise principale en recalculant les taux. */
export async function changeMainCurrency(next: string) {
  const s = (await db.settings.get('main'))!;
  if (s.mainCurrency === next) return;
  const rates = await db.rates.toArray();
  const pivot = rates.find((r) => r.currency === next)?.rate;
  if (!pivot) throw new Error(`Renseigne d'abord le taux de ${next} dans les paramètres.`);
  const at = nowIso();
  const out = rates.filter((r) => r.currency !== next).map((r) => ({ ...r, rate: r.rate / pivot, updatedAt: at }));
  out.push({ currency: s.mainCurrency, rate: 1 / pivot, updatedAt: at });
  await db.transaction('rw', db.rates, db.settings, db.audit, async () => {
    await db.rates.clear();
    await db.rates.bulkPut(out);
    const factor = 1 / pivot; // valeur d'une unité de l'ancienne devise dans la nouvelle
    const { toMinor, toMajor } = await import('../engine/money');
    const thr = toMinor(toMajor(s.safetyThreshold, s.mainCurrency) * factor, next);
    await db.settings.put({ ...s, mainCurrency: next, safetyThreshold: thr });
    await db.audit.add({ at, entity: 'settings', entityId: 'main', action: 'update', summary: `Devise principale : ${s.mainCurrency} → ${next}` });
  });
}

// ------------------------------------------------------------------ Opérations métier

export function newTx(p: Partial<Tx> & Pick<Tx, 'kind' | 'amount' | 'accountId'>): Tx {
  const at = nowIso();
  return { id: uid(), date: today(), label: '', createdAt: at, updatedAt: at, ...p };
}

/** Exécute une occurrence planifiée : crée la transaction réelle et met à jour son statut. */
export async function executeOccurrence(rule: Rule, date: string, opts: { amount: number; actualDate?: string; accountId?: string; note?: string; full?: boolean }) {
  const id = occId(rule.id, date);
  const prev = await db.occurrences.get(id);
  const paid = (prev?.paidAmount ?? 0) + opts.amount;
  const status: Occurrence['status'] = opts.full || paid >= rule.amount ? 'paid' : 'partial';
  const d = opts.actualDate ?? today();
  const accountId = opts.accountId ?? rule.accountId;
  const txIds = [...(prev?.txIds ?? [])];
  const base = { date: d, label: rule.label, categoryId: rule.categoryId, payee: rule.payee, ruleId: rule.id, occurrenceDate: date, projectId: rule.projectId, debtId: rule.debtId, cotisationId: rule.cotisationId, notes: opts.note };
  if (rule.kind === 'saving') {
    const goal = rule.goalId ? await db.goals.get(rule.goalId) : undefined;
    if (goal) {
      let txId: string | undefined;
      if (goal.accountId && goal.accountId !== accountId) {
        const toAcc = await db.accounts.get(goal.accountId); const fromAcc = await db.accounts.get(accountId);
        const t = newTx({ ...base, kind: 'transfer', amount: opts.amount, accountId, toAccountId: goal.accountId, toAmount: await convertBetween(opts.amount, fromAcc?.currency, toAcc?.currency), label: `Épargne : ${goal.name}` });
        await save('txs', t, `Versement épargne ${goal.name}`); txId = t.id; txIds.push(t.id);
      }
      const fromAcc = await db.accounts.get(accountId);
      await save('goalMoves', { id: uid(), goalId: goal.id, date: d, amount: await convertBetween(opts.amount, fromAcc?.currency, goal.currency), note: rule.label, txId, createdAt: nowIso() }, `Versement objectif ${goal.name}`);
    }
  } else {
    const kind: Tx['kind'] = rule.kind === 'income' ? 'income' : rule.kind === 'expense' ? 'expense' : rule.kind === 'debt_repay' ? 'debt_repay' : rule.kind === 'loan_back' ? 'loan_back' : 'transfer';
    const t = newTx({ ...base, kind, amount: opts.amount, accountId, toAccountId: rule.toAccountId });
    if (kind === 'transfer' && rule.toAccountId) {
      const fa = await db.accounts.get(accountId), ta = await db.accounts.get(rule.toAccountId);
      t.toAmount = await convertBetween(opts.amount, fa?.currency, ta?.currency);
    }
    await save('txs', t, `Exécution : ${rule.label}`);
    txIds.push(t.id);
    if (rule.cotisationId) {
      const c = await db.cotisations.get(rule.cotisationId);
      if (c?.myParticipantId) await save('cotisPayments', { id: uid(), cotisationId: c.id, participantId: c.myParticipantId, period: date, amount: opts.amount, date: d, txId: t.id }, 'Ma part de cotisation');
    }
  }
  await save('occurrences', { id, ruleId: rule.id, date, status, paidAmount: paid, txIds, actualDate: d, note: opts.note }, `${status === 'paid' ? 'Payé' : 'Paiement partiel'} : ${rule.label}`);
}
export async function cancelOccurrence(rule: Rule, date: string, note?: string) {
  const id = occId(rule.id, date);
  const prev = await db.occurrences.get(id);
  await save('occurrences', { id, ruleId: rule.id, date, status: 'cancelled', paidAmount: prev?.paidAmount ?? 0, txIds: prev?.txIds ?? [], note }, `Annulé : ${rule.label}`);
}
export async function resetOccurrence(rule: Rule, date: string) {
  await remove('occurrences', occId(rule.id, date), `Statut réinitialisé : ${rule.label}`);
}

export async function convertBetween(minor: number, from?: string, to?: string) {
  if (!from || !to || from === to) return minor;
  const { convert } = await import('../engine/money');
  const s = (await db.settings.get('main'))!;
  return convert(minor, from, to, s.mainCurrency, await db.rates.toArray());
}

export async function createDebt(d: Debt, cash?: { accountId: string; date: string }) {
  await save('debts', d, `${d.direction === 'dette' ? 'Dette' : 'Créance'} créée : ${d.person}`);
  if (cash) {
    const acc = await db.accounts.get(cash.accountId);
    const amount = await convertBetween(d.initialAmount, d.currency, acc?.currency);
    await save('txs', newTx({ kind: d.direction === 'dette' ? 'debt_borrow' : 'loan_out', amount, accountId: cash.accountId, date: cash.date, debtId: d.id, label: d.direction === 'dette' ? `Emprunt : ${d.person}` : `Prêt à ${d.person}`, payee: d.person }), 'Mouvement initial');
  }
}
export async function recordDebtPayment(d: Debt, amountInAccount: number, accountId: string, date: string, note?: string) {
  await save('txs', newTx({ kind: d.direction === 'dette' ? 'debt_repay' : 'loan_back', amount: amountInAccount, accountId, date, debtId: d.id, label: d.direction === 'dette' ? `Remboursement à ${d.person}` : `Remboursement de ${d.person}`, payee: d.person, categoryId: d.direction === 'dette' ? 'remboursements' : 'remb-recu', notes: note }), 'Remboursement enregistré');
}

export async function goalMovement(g: Goal, amount: number, date: string, note?: string, fromAccountId?: string) {
  let txId: string | undefined;
  if (fromAccountId && g.accountId && fromAccountId !== g.accountId) {
    const fa = await db.accounts.get(fromAccountId), ta = await db.accounts.get(g.accountId);
    const abs = Math.abs(amount);
    const inFrom = await convertBetween(abs, g.currency, fa?.currency);
    const t = amount >= 0
      ? newTx({ kind: 'transfer', amount: inFrom, accountId: fromAccountId, toAccountId: g.accountId, toAmount: await convertBetween(abs, g.currency, ta?.currency), date, label: `Épargne : ${g.name}` })
      : newTx({ kind: 'transfer', amount: await convertBetween(abs, g.currency, ta?.currency), accountId: g.accountId, toAccountId: fromAccountId, toAmount: inFrom, date, label: `Retrait épargne : ${g.name}` });
    await save('txs', t, 'Mouvement d\'épargne'); txId = t.id;
  }
  await save('goalMoves', { id: uid(), goalId: g.id, date, amount, note, txId, createdAt: nowIso() }, `${amount >= 0 ? 'Versement' : 'Retrait'} : ${g.name}`);
}

export async function saveCotisation(c: Cotisation, autoRule: boolean) {
  await save('cotisations', c, `Cotisation : ${c.name}`);
  const existing = (await db.rules.toArray()).find((r) => r.cotisationId === c.id);
  if (autoRule && c.myParticipantId && c.accountId) {
    const acc = await db.accounts.get(c.accountId);
    const amount = await convertBetween(c.amount, c.currency, acc?.currency);
    const r: Rule = { ...(existing ?? { id: uid(), createdAt: nowIso(), essential: false, certainty: 'certaine', active: true }), label: `Cotisation : ${c.name}`, kind: 'expense', amount, accountId: c.accountId, categoryId: 'cotisations', freq: c.freq, interval: 1, startDate: c.startDate, endDate: c.endDate ?? null, cotisationId: c.id, updatedAt: nowIso() } as Rule;
    await save('rules', r, 'Engagement de cotisation');
  } else if (existing && !autoRule) {
    await save('rules', { ...existing, active: false }, 'Engagement de cotisation désactivé');
  }
}

export async function deleteAccount(a: Account) {
  const n = (await db.txs.toArray()).filter((t) => t.accountId === a.id).length;
  const m = (await db.txs.toArray()).filter((t) => t.toAccountId === a.id).length;
  if (n + m > 0) { await save('accounts', { ...a, archived: true }, 'Compte archivé (opérations existantes)'); return 'archived'; }
  await remove('accounts', a.id, `Compte supprimé : ${a.name}`); return 'deleted';
}

export async function deleteTx(t: Tx) {
  await remove('txs', t.id, `Opération supprimée : ${t.label}`);
  if (t.ruleId && t.occurrenceDate) {
    const id = occId(t.ruleId, t.occurrenceDate);
    const o = await db.occurrences.get(id);
    if (o) {
      const txIds = o.txIds.filter((x) => x !== t.id);
      const paidAmount = Math.max(0, o.paidAmount - t.amount);
      if (!txIds.length) await remove('occurrences', id, 'Occurrence réouverte');
      else await save('occurrences', { ...o, txIds, paidAmount, status: 'partial' }, 'Occurrence réouverte partiellement');
    }
  }
  const pays = (await db.cotisPayments.toArray()).filter((p) => p.txId === t.id);
  for (const p of pays) await remove('cotisPayments', p.id);
  const gm = (await db.goalMoves.toArray()).filter((g) => g.txId === t.id);
  for (const g of gm) await remove('goalMoves', g.id);
}

export async function addDoc(file: File, category: string, link?: { type: DocFile['linkType']; id: string }) {
  const mime = file.type || 'application/octet-stream';
  const stored = await storeBlob(new Uint8Array(await file.arrayBuffer()), mime);
  const d: DocFile = { id: uid(), name: file.name, mime, size: file.size, ...stored, category, linkType: link?.type ?? null, linkId: link?.id ?? null, archived: false, createdAt: nowIso() };
  await save('docs', d, `Document ajouté : ${file.name}`);
  return d;
}

// ------------------------------------------------------------------ Sauvegardes chiffrées

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => { const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function exportBackup(password?: string, includeDocs = true): Promise<Blob> {
  const data: Record<string, unknown[]> = {};
  for (const t of DATA_TABLES) data[t] = await T(t).toArray();
  if (includeDocs) {
    const docs = await db.docs.toArray();
    data.docs = await Promise.all(docs.map(async (d) => ({ ...d, blobEnc: false, blob: b64(await readDocBytes(d)) })));
  }
  const payload = JSON.stringify({ app: 'FINPILOT', version: 1, exportedAt: nowIso(), data });
  let out: string;
  if (password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(payload));
    out = JSON.stringify({ app: 'FINPILOT', encrypted: true, kdf: 'PBKDF2-SHA256-310000', cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), data: b64(ct) });
  } else out = payload;
  await updateSettings({ lastBackupAt: nowIso() }, 'Sauvegarde exportée');
  return new Blob([out], { type: 'application/json' });
}

export async function readBackup(text: string, password?: string): Promise<Record<string, unknown[]>> {
  const j = JSON.parse(text);
  if (j.app !== 'FINPILOT') throw new Error("Ce fichier n'est pas une sauvegarde FINPILOT.");
  if (j.encrypted) {
    if (!password) throw new Error('Mot de passe requis pour cette sauvegarde chiffrée.');
    try {
      const key = await deriveKey(password, unb64(j.salt));
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(j.iv) as BufferSource }, key, unb64(j.data) as BufferSource);
      return JSON.parse(new TextDecoder().decode(pt)).data;
    } catch { throw new Error('Mot de passe incorrect ou fichier altéré.'); }
  }
  return j.data;
}

export async function restoreBackup(data: Record<string, unknown[]>) {
  const tables = [...DATA_TABLES.map((t) => T(t)), db.docs, db.audit];
  const docs: DocFile[] = [];
  for (const d of (data.docs ?? []) as (Omit<DocFile, 'blob'> & { blob: string })[]) docs.push({ ...d, ...(await storeBlob(unb64(d.blob), d.mime)) });
  await db.transaction('rw', tables, async () => {
    for (const t of DATA_TABLES) { await T(t).clear(); if (data[t]) await T(t).bulkPut(data[t] as AnyRow[]); }
    await db.docs.clear();
    if (docs.length) await db.docs.bulkPut(docs);
    await db.audit.add({ at: nowIso(), entity: 'system', entityId: 'backup', action: 'update', summary: 'Restauration d\'une sauvegarde' });
  });
  if (!(await db.settings.get('main'))) await db.settings.put(DEFAULT_SETTINGS);
}

export async function wipeAll() {
  await db.delete();
  setKey(null);
  setVaultMode(false);
}

// ------------------------------------------------------------------ Code PIN

export async function hashPin(pin: string, saltB64?: string) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 200000, hash: 'SHA-256' }, base, 256);
  return { hash: b64(bits), salt: b64(salt) };
}
