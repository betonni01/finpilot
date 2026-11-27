// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db } from './db';
import { save, remove } from './repo';
import { initKeys, enableVault, disableVault, unlockVault, adoptKey, docBlob, storeBlob, vaultDelay } from './vault';
import { markRemote, setKey, setVaultMode, randomBytes, isVaultOn, b64 } from './secure';
import { getConfig, updateSyncConfig } from '../sync/sync';
import type { Account } from '../engine/types';

const acc = (id: string, name: string): Account => ({ id, name, type: 'banque', currency: 'EUR', initialBalance: 123456, openedAt: '2026-01-01', archived: false, liquid: true, createdAt: '', updatedAt: '' });
async function raw(table: string, key: string) {
  const r = new Dexie('finpilot');
  await r.open();
  const v = await r.table(table).get(key);
  r.close();
  return v;
}

beforeEach(async () => {
  db.close();
  await Dexie.delete('finpilot');
  setKey(null); setVaultMode(false);
  await db.open();
  await initKeys();
});

describe('suivi des modifications pour la synchro', () => {
  it('note créations, modifications et suppressions', async () => {
    await save('accounts', acc('a1', 'Courant'));
    await save('accounts', acc('a2', 'Livret'));
    await remove('accounts', 'a2');
    const out = await db.outbox.toArray();
    expect(out.map((o) => [o.k, o.deleted]).sort()).toEqual([['accounts|a1', false], ['accounts|a2', true]]);
  });
  it("n'enregistre pas les écritures venant du serveur ni le journal local", async () => {
    await db.transaction('rw', db.accounts, async () => { markRemote(Dexie.currentTransaction?.idbtrans); await db.accounts.put(acc('r1', 'Distant')); });
    expect(await db.outbox.count()).toBe(1 - 1);
    await db.audit.add({ at: 'x', entity: 'e', entityId: 'i', action: 'create', summary: '' });
    expect(await db.outbox.count()).toBe(0);
  });
  it('un vidage de table produit des suppressions', async () => {
    await db.transaction('rw', db.accounts, async () => { markRemote(Dexie.currentTransaction?.idbtrans); await db.accounts.bulkPut([acc('x', 'X'), acc('y', 'Y')]); });
    await db.accounts.clear();
    expect((await db.outbox.toArray()).filter((o) => o.deleted).length).toBe(2);
  });
});

describe('coffre chiffré', () => {
  it('chiffre au repos et relit en clair', async () => {
    await save('accounts', acc('a1', 'Compte secret'));
    await enableVault('ma phrase secrète 2026');
    expect(isVaultOn()).toBe(true);
    const r = await raw('accounts', 'a1');
    expect(r._e).toBeTypeOf('string');
    expect(r.name).toBeUndefined();
    expect(r.initialBalance).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('Compte secret');
    expect(JSON.stringify(r)).not.toContain('123456');
    expect(JSON.stringify(r)).not.toContain('2026-01-01');
    await save('txs', { id: 't1', kind: 'expense', date: '2026-11-02', amount: 1250, accountId: 'a1', categoryId: 'loyer', label: 'Loyer secret', createdAt: '', updatedAt: '' });
    const tx = await raw('txs', 't1');
    expect(JSON.stringify(tx)).not.toContain('loyer');
    expect(JSON.stringify(tx)).not.toContain('2026-11-02');
    expect(JSON.stringify(tx)).not.toContain('Loyer secret');
    expect(await db.meta.get('keys')).toBeUndefined();
    expect((await db.accounts.get('a1'))?.name).toBe('Compte secret');
    await save('accounts', acc('a2', 'Nouveau'));
    expect(JSON.stringify(await raw('accounts', 'a2'))).not.toContain('Nouveau');
    expect(await db.outbox.where('k').equals('accounts|a1').count()).toBe(1); // réécriture du coffre non marquée en double
  });
  it('refuse une mauvaise phrase et déverrouille avec la bonne', async () => {
    await save('accounts', acc('a1', 'A'));
    await enableVault('ma phrase secrète 2026');
    setKey(null);
    await expect(db.accounts.get('a1')).rejects.toThrow(/verrouillé/);
    await expect(unlockVault('mauvaise phrase 1')).rejects.toThrow(/incorrecte/);
    await unlockVault('ma phrase secrète 2026');
    expect((await db.accounts.get('a1'))?.name).toBe('A');
  });
  it('désactivation et documents', async () => {
    const s = await storeBlob(new TextEncoder().encode('facture'), 'text/plain');
    await save('docs', { id: 'd1', name: 'f.txt', mime: 'text/plain', size: 7, ...s, category: 'Factures', archived: false, createdAt: '' });
    await enableVault('ma phrase secrète 2026');
    const d = (await db.docs.get('d1'))!;
    expect(d.blobEnc).toBe(true);
    expect(await (await docBlob(d)).text()).toBe('facture');
    await expect(disableVault('ma phrase secrète 2026')).rejects.toThrow(/ne peut pas être désactivé/);
    expect((await db.docs.get('d1'))?.blobEnc).toBe(true);
    expect(JSON.stringify(await raw('docs', 'd1'))).not.toContain('Factures');
  });
  it("ne crée pas de clé en clair et chiffre une ancienne base", async () => {
    expect(await initKeys()).toBe('setup');
    expect(await db.meta.get('keys')).toBeUndefined();
    const key = randomBytes(32);
    setKey(key); setVaultMode(false);
    await save('accounts', acc('old', 'Ancien'));
    await db.meta.put({ id: 'keys', dek: b64(key) });
    setKey(null);
    expect(await initKeys()).toBe('migrate');
    await enableVault('ma phrase secrète 2026');
    expect(await db.meta.get('keys')).toBeUndefined();
    setKey(null);
    await unlockVault('ma phrase secrète 2026');
    expect((await db.accounts.get('old'))?.name).toBe('Ancien');
  });
  it('bloque les essais de phrase même après oubli de l\'état mémoire', async () => {
    await enableVault('ma phrase secrète 2026');
    setKey(null);
    for (let i = 0; i < 5; i++) await expect(unlockVault('mauvaise phrase 1')).rejects.toThrow(/incorrecte/);
    expect(await vaultDelay()).toBeGreaterThan(0);
    await expect(unlockVault('ma phrase secrète 2026')).rejects.toThrow(/Trop d'essais/);
  });
  it('chiffre les jetons de session sur le disque', async () => {
    setKey(randomBytes(32));
    await updateSyncConfig({ access: 'access-token', refresh: 'refresh-token', email: 'a@b.c', enabled: true });
    const stored = await db.meta.get('sync');
    expect(stored?.tokensEnc).toBe(true);
    expect(stored?.access).not.toBe('access-token');
    expect(JSON.stringify(stored)).not.toContain('refresh-token');
    expect((await getConfig())?.access).toBe('access-token');
    setKey(null);
    expect((await getConfig())?.access).toBeUndefined();
    expect((await getConfig())?.email).toBe('a@b.c');
  });
  it("adopter la clé d'un autre appareil conserve les données lisibles", async () => {
    await save('accounts', acc('a1', 'A'));
    await enableVault('ma phrase secrète 2026');
    await adoptKey(randomBytes(32), 'ma phrase secrète 2026');
    setKey(null);
    await unlockVault('ma phrase secrète 2026');
    expect((await db.accounts.get('a1'))?.name).toBe('A');
  });
});

describe('rappels push', () => {
  it('le mode discret ne transmet ni libellé ni montant', async () => {
    const { buildReminders } = await import('../sync/push');
    const now = '2026-11-01T00:00:00.000Z';
    const s = {
      accounts: [acc('a1', 'Courant')], txs: [], occurrences: [], debts: [], goals: [], goalMoves: [], cotisations: [], cotisPayments: [], cotisExpenses: [], projects: [], categories: [], budgets: [], wishes: [], scenarios: [], rates: [],
      rules: [{ id: 'r', label: 'Loyer secret', kind: 'expense', amount: 52000, accountId: 'a1', freq: 'monthly', interval: 1, startDate: '2099-01-10', certainty: 'certaine', essential: true, active: true, createdAt: now, updatedAt: now }],
      settings: { id: 'main', mainCurrency: 'EUR', safetyThreshold: 0, theme: 'system', autoLockMin: 5, budgetAlerts: [], variableMode: 'off', onboarded: true, horizonDays: 365, notifications: false, reminderDays: 3 },
    } as never;
    const discreet = buildReminders(s, false, '2099-01-01');
    expect(discreet.length).toBe(1);
    expect(JSON.stringify(discreet)).not.toMatch(/Loyer|520/);
    const detailed = buildReminders(s, true, '2099-01-01');
    expect(JSON.stringify(detailed)).not.toMatch(/Loyer|520/);
  });
});
