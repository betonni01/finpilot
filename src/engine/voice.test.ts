import { describe, expect, it } from 'vitest';
import { digitize, extractAmount, extractPastDate, parseConfirm, parseVoice, type VoiceContext } from './voice';

const ctx: VoiceContext = {
  main: 'EUR', ref: '2026-11-27',
  accounts: [
    { id: 'cc', name: 'Compte courant', type: 'banque', currency: 'EUR', archived: false, liquid: true, projectId: null },
    { id: 'esp', name: 'Espèces', type: 'especes', currency: 'EUR', archived: false, liquid: true, projectId: null },
    { id: 'mtn', name: 'MTN Mobile Money', type: 'mobile', currency: 'XOF', archived: false, liquid: true, projectId: null },
    { id: 'liv', name: 'Livret A', type: 'epargne', currency: 'EUR', archived: false, liquid: false, projectId: null },
  ],
  categories: [
    { id: 'courses', name: 'Courses', kind: 'expense' }, { id: 'restaurants', name: 'Restaurants', kind: 'expense' }, { id: 'carburant', name: 'Carburant', kind: 'expense' },
    { id: 'salaire', name: 'Salaire', kind: 'income' }, { id: 'aide-familiale', name: 'Aides familiales', kind: 'expense' }, { id: 'divers', name: 'Divers', kind: 'both' },
  ],
  debts: [{ id: 'd1', person: 'Koffi', direction: 'dette', archived: false }, { id: 'c1', person: 'Aïcha', direction: 'creance', archived: false }],
};

describe('nombres dits', () => {
  it.each([
    ['douze euros cinquante', '12 euros 50'], ['soixante-dix euros', '70 euros'], ['quatre-vingt-dix-neuf', '99'],
    ['mille deux cents francs', '1200 francs'], ['deux mille cinq cents', '2500'], ['soixante et onze', '71'], ['cent vingt', '120'],
  ])('%s', (a, b) => expect(digitize(a)).toBe(b));
  it("« une » reste un article", () => expect(digitize('ajoute une dépense')).toBe('ajoute une depense'));
  it('montants', () => {
    expect(extractAmount('12 euros 50', 'EUR')).toEqual({ value: 12.5, currency: 'EUR' });
    expect(extractAmount('12,50 €', 'EUR')).toEqual({ value: 12.5, currency: 'EUR' });
    expect(extractAmount('15000 francs cfa', 'EUR')).toEqual({ value: 15000, currency: 'XOF' });
    expect(extractAmount('le 3 decembre j ai paye 40', 'EUR')).toEqual({ value: 40, currency: 'EUR' });
  });
  it('dates passées', () => {
    expect(extractPastDate('hier', '2026-11-27')).toBe('2026-11-26');
    expect(extractPastDate('le 30', '2026-11-27')).toBe('2026-10-30');
    expect(extractPastDate('le 3 decembre', '2026-11-27')).toBe('2025-12-03');
    expect(extractPastDate('il y a 3 jours', '2026-11-27')).toBe('2026-11-24');
  });
});

describe('intentions', () => {
  it('dépense complète', () => {
    const r = parseVoice("J'ai payé 12 euros 50 de courses chez Lidl en espèces hier", ctx);
    expect(r).toMatchObject({ type: 'tx', kind: 'expense', amount: 1250, currency: 'EUR', categoryId: 'courses', accountId: 'esp', date: '2026-11-26', payee: 'Lidl', method: 'Espèces' });
  });
  it('dépense en lettres', () => {
    expect(parseVoice('ajoute une dépense de vingt-trois euros au restaurant', ctx)).toMatchObject({ type: 'tx', amount: 2300, categoryId: 'restaurants', accountId: 'cc' });
  });
  it('mobile money en francs CFA', () => {
    expect(parseVoice("J'ai envoyé... j'ai payé 15000 francs CFA pour maman avec MoMo", ctx)).toMatchObject({ type: 'tx', amount: 15000, currency: 'XOF', accountId: 'mtn', categoryId: 'aide-familiale' });
  });
  it('revenu', () => {
    expect(parseVoice("J'ai reçu mon salaire de 1200 euros", ctx)).toMatchObject({ type: 'tx', kind: 'income', amount: 120000, categoryId: 'salaire' });
  });
  it('remboursements et prêts', () => {
    expect(parseVoice("J'ai remboursé 50 euros à Koffi", ctx)).toMatchObject({ type: 'debt', action: 'repay', debtId: 'd1', amount: 5000 });
    expect(parseVoice("Aïcha m'a remboursé 20 euros", ctx)).toMatchObject({ type: 'debt', action: 'received', debtId: 'c1', amount: 2000 });
    expect(parseVoice("J'ai prêté 30 euros à Serge", ctx)).toMatchObject({ type: 'debt', action: 'lend', person: 'Serge', amount: 3000 });
    expect(parseVoice("Rodrigue m'a prêté 100 euros", ctx)).toMatchObject({ type: 'debt', action: 'borrow', person: 'Rodrigue' });
  });
  it('transferts', () => {
    expect(parseVoice("J'ai retiré 60 euros", ctx)).toMatchObject({ type: 'transfer', fromId: 'cc', toId: 'esp', amount: 6000 });
    expect(parseVoice('Transfère 200 euros du compte courant vers le livret A', ctx)).toMatchObject({ type: 'transfer', fromId: 'cc', toId: 'liv' });
  });
  it('navigation et simulation', () => {
    expect(parseVoice('Ouvre mes dettes', ctx)).toMatchObject({ type: 'nav', to: '/dettes' });
    expect(parseVoice('montre le calendrier', ctx)).toMatchObject({ type: 'nav', to: '/calendrier' });
    expect(parseVoice('Simule un téléphone à 900 euros en 3 fois', ctx)).toMatchObject({ type: 'simulate', label: 'Téléphone', amount: 90000, installments: 3 });
  });
  it('questions et incomplets', () => {
    expect(parseVoice('Combien me restera-t-il à la fin du mois ?', ctx).type).toBe('question');
    expect(parseVoice('Est-ce que je peux acheter un ordinateur à 1200 euros en janvier ?', ctx).type).toBe('question');
    expect(parseVoice('ajoute une dépense de courses', ctx)).toMatchObject({ type: 'incomplete', missing: 'le montant' });
  });
  it('confirmations', () => {
    expect(parseConfirm('Oui, vas-y')).toBe(true);
    expect(parseConfirm("D'accord.")).toBe(true);
    expect(parseConfirm('Non annule')).toBe(false);
    expect(parseConfirm('peut-être')).toBe(null);
  });
});
