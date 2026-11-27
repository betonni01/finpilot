import { describe, expect, it } from 'vitest';
import { Ledger } from './ledger';
import { occurrenceDates, pendingOccurrences } from './recurrence';
import { capacity, endOfMonthScenarios, minWith, optimizeDecisions, project, simulatePurchase, annuity } from './projection';
import { computeAlerts } from './insights';
import { payoffPlan } from './debts';
import { ask, parseDate, parseMoney } from './assistant';
import { convert, parseAmount, toMinor } from './money';
import { addMonths } from './date';
import type { Snapshot, Rule, Tx } from './types';

const REF = '2026-12-01';
const now = '2026-11-01T10:00:00.000Z';
const settings: Snapshot['settings'] = { id: 'main', mainCurrency: 'EUR', safetyThreshold: 20000, theme: 'system', autoLockMin: 5, budgetAlerts: [50, 75, 90, 100], variableMode: 'off', onboarded: true, horizonDays: 365, notifications: false, reminderDays: 3 };

function rule(p: Partial<Rule>): Rule {
  return { id: Math.random().toString(36).slice(2), label: 'r', kind: 'expense', amount: 0, accountId: 'a1', freq: 'monthly', interval: 1, startDate: '2026-11-01', certainty: 'certaine', essential: false, active: true, createdAt: now, updatedAt: now, ...p };
}
function tx(p: Partial<Tx>): Tx {
  return { id: Math.random().toString(36).slice(2), kind: 'expense', date: '2026-11-15', amount: 0, accountId: 'a1', label: 't', createdAt: now, updatedAt: now, ...p };
}
function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    accounts: [
      { id: 'a1', name: 'Courant', type: 'banque', currency: 'EUR', initialBalance: 120000, openedAt: '2026-01-01', archived: false, liquid: true, createdAt: now, updatedAt: now },
      { id: 'a2', name: 'Livret', type: 'epargne', currency: 'EUR', initialBalance: 50000, openedAt: '2026-01-01', archived: false, liquid: false, createdAt: now, updatedAt: now },
      { id: 'mm', name: 'MTN MoMo', type: 'mobile', currency: 'XOF', initialBalance: 65595, openedAt: '2026-01-01', archived: false, liquid: true, createdAt: now, updatedAt: now },
      { id: 'p1a', name: 'Compte projet', type: 'pro', currency: 'EUR', initialBalance: 0, openedAt: '2026-01-01', archived: false, liquid: true, projectId: 'p1', createdAt: now, updatedAt: now },
    ],
    txs: [], rules: [], occurrences: [], debts: [], goals: [], goalMoves: [], cotisations: [], cotisPayments: [], cotisExpenses: [],
    projects: [{ id: 'p1', name: 'MMIP', startDate: '2026-01-01', budget: 100000, currency: 'EUR', status: 'en_cours', phases: [], archived: false, createdAt: now }],
    categories: [{ id: 'loyer', name: 'Loyer', group: 'Logement', kind: 'expense', essential: true, color: '#000' }],
    budgets: [], wishes: [], scenarios: [], settings, rates: [{ currency: 'XOF', rate: 1 / 655.957, updatedAt: now }],
    ...over,
  };
}

describe('montants et devises', () => {
  it('parse les montants français', () => {
    expect(parseAmount('1 234,56')).toBe(1234.56);
    expect(parseAmount('2k')).toBe(2000);
    expect(parseAmount('900 €')).toBe(900);
  });
  it('convertit XOF ↔ EUR avec la parité fixe', () => {
    expect(convert(65595, 'XOF', 'EUR', 'EUR', snap().rates)).toBe(10000); // 65 595 F ≈ 100,00 €
    expect(convert(10000, 'EUR', 'XOF', 'EUR', snap().rates)).toBe(65596);
    expect(toMinor(19.99, 'EUR')).toBe(1999);
    expect(toMinor(1500, 'XOF')).toBe(1500);
  });
});

describe('récurrences', () => {
  it('borne le 31 aux fins de mois', () => {
    const d = occurrenceDates({ freq: 'monthly', interval: 1, startDate: '2026-01-31' }, '2026-01-01', '2026-04-30');
    expect(d).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('hebdomadaire à partir d\'une date lointaine', () => {
    const d = occurrenceDates({ freq: 'weekly', interval: 2, startDate: '2026-01-05' }, '2026-03-01', '2026-03-31');
    expect(d).toEqual(['2026-03-02', '2026-03-16', '2026-03-30']);
  });
  it('une occurrence payée n\'est plus en attente, une partielle garde son reste', () => {
    const r = rule({ id: 'loy', amount: 42000, startDate: '2026-12-05' });
    const p = pendingOccurrences([r], [{ id: 'loy|2026-12-05', ruleId: 'loy', date: '2026-12-05', status: 'partial', paidAmount: 12000, txIds: [] }], REF, '2027-01-31', 0, REF);
    expect(p.map((x) => [x.date, x.remaining])).toEqual([['2026-12-05', 30000], ['2027-01-05', 42000]]);
  });
});

describe('grand livre', () => {
  it('un transfert entre comptes personnels n\'est pas une dépense', () => {
    const s = snap({ txs: [tx({ kind: 'transfer', accountId: 'a1', toAccountId: 'a2', amount: 30000 })] });
    const L = new Ledger(s, REF);
    expect(L.balances.get('a1')).toBe(90000);
    expect(L.balances.get('a2')).toBe(80000);
    expect(L.expenseBetween('2026-11-01', '2026-11-30')).toBe(0);
    expect(L.personalTotal()).toBe(120000 + 50000 + 10000);
  });
  it('un apport au projet sort des finances personnelles sans être une consommation', () => {
    const s = snap({ txs: [tx({ kind: 'transfer', accountId: 'a1', toAccountId: 'p1a', amount: 15000 }), tx({ kind: 'expense', accountId: 'p1a', amount: 5000, projectId: 'p1' })] });
    const L = new Ledger(s, REF);
    expect(L.classify(s.txs[0])).toBe('apport_projet');
    expect(L.expenseBetween('2026-11-01', '2026-11-30')).toBe(0);
    const st = L.projectStats(s.projects[0]);
    expect(st.personalContrib).toBe(15000);
    expect(st.expenses).toBe(5000);
    expect(st.treasury).toBe(10000);
  });
  it('un remboursement met à jour la dette et le compte', () => {
    const s = snap({ debts: [{ id: 'd1', direction: 'dette', person: 'Ami A', initialAmount: 15000, currency: 'EUR', createdAt: '2026-10-01', priority: 1, archived: false }], txs: [tx({ kind: 'debt_repay', debtId: 'd1', amount: 5000 })] });
    const L = new Ledger(s, REF);
    expect(L.debtRemaining(s.debts[0])).toBe(10000);
    expect(L.balances.get('a1')).toBe(115000);
    expect(L.netWorth()).toBe(115000 + 50000 + 10000 - 10000);
  });
  it('disponible réel = liquidités − affectations − engagements − réserve', () => {
    const s = snap({
      rules: [rule({ label: 'Salaire', kind: 'income', amount: 100000, startDate: '2026-12-28' }), rule({ label: 'Loyer', amount: 42000, startDate: '2026-12-05', categoryId: 'loyer' })],
      goals: [{ id: 'g', name: 'Urgence', target: 100000, currency: 'EUR', priority: 1, isEmergency: true, archived: false, createdAt: now }],
      goalMoves: [{ id: 'm', goalId: 'g', date: '2026-11-02', amount: 10000, createdAt: now }],
    });
    const L = new Ledger(s, REF);
    const a = L.available();
    expect(a.liquid).toBe(130000);
    expect(a.alloc).toBe(10000);
    expect(a.commitments).toBe(42000);
    expect(a.value).toBe(130000 - 10000 - 42000 - 20000);
    expect(L.resteAVivre().reste).toBe(58000);
  });
  it('un revenu probable ne compte pas dans le reste à vivre', () => {
    const s = snap({ rules: [rule({ label: 'Salaire', kind: 'income', amount: 100000, startDate: '2026-12-28' }), rule({ label: 'Prime', kind: 'income', amount: 20000, startDate: '2026-12-15', certainty: 'probable' }), rule({ label: 'Loyer', amount: 42000, startDate: '2026-12-05', categoryId: 'loyer' })] });
    expect(new Ledger(s, REF).resteAVivre().totalIncome).toBe(100000);
    expect(new Ledger(s, REF).resteAVivre().reste).toBe(58000);
  });
  it('une dette soldée ne réduit plus le disponible, même si l\'échéancier continue', () => {
    const s = snap({
      debts: [{ id: 'd1', direction: 'dette', person: 'Ami', initialAmount: 15000, currency: 'EUR', createdAt: '2026-10-01', priority: 1, archived: false }],
      txs: [tx({ kind: 'debt_repay', debtId: 'd1', amount: 15000, date: '2026-11-20' })],
      rules: [rule({ kind: 'debt_repay', debtId: 'd1', amount: 5000, startDate: '2026-12-05', label: 'Mensualité' })],
    });
    const L = new Ledger(s, REF);
    expect(L.debtRemaining(s.debts[0])).toBe(0);
    expect(L.available().commitments).toBe(0);
  });
});

describe('projection et simulations', () => {
  const base = () => snap({
    rules: [
      rule({ label: 'Salaire', kind: 'income', amount: 100000, startDate: '2026-12-28' }),
      rule({ label: 'Loyer', amount: 42000, startDate: '2026-12-05', categoryId: 'loyer', essential: true }),
      rule({ label: 'Prime', kind: 'income', amount: 50000, freq: 'once', startDate: '2026-12-20', certainty: 'incertaine' }),
    ],
  });
  it('détecte le point bas au jour près (découvert avant le salaire)', () => {
    const L = new Ledger(base(), REF);
    const p = project(L, { days: 31 });
    expect(p.startFree).toBe(130000);
    expect(p.min.value).toBe(88000);
    expect(p.min.date).toBe('2026-12-05');
    expect(p.end.free).toBe(188000);
  });
  it('les revenus incertains ne comptent qu\'en scénario optimiste', () => {
    const L = new Ledger(base(), REF);
    const [o, r, pe] = endOfMonthScenarios(L);
    expect(o.end.free - r.end.free).toBe(50000);
    expect(pe.end.free).toBe(r.end.free);
  });
  it('un achat simulé ne modifie pas les comptes et produit un verdict', () => {
    const s = base();
    const L = new Ledger(s, REF);
    const r = simulatePurchase(L, { id: 'x', label: 'Téléphone', date: '2026-12-15', amount: 90000, direction: 'out', mode: 'comptant' });
    expect(r.level).toBe('risque');
    expect(L.balances.get('a1')).toBe(120000);
    expect(s.txs.length).toBe(0);
    expect(r.suggestion?.date && r.suggestion.date > '2026-12-15').toBe(true);
  });
  it('le paiement en plusieurs fois répartit le coût et les frais', () => {
    const L = new Ledger(base(), REF);
    const r = simulatePurchase(L, { id: 'x', label: 'PC', date: '2026-12-29', amount: 90000, direction: 'out', mode: 'plusieurs', installments: 3, fees: 1500 });
    expect(r.cost.total).toBe(91500);
    expect(r.schedule.length).toBe(3);
    expect(r.schedule.reduce((a, e) => a + e.balance, 0)).toBe(-91500);
  });
  it('calcule la mensualité d\'un crédit', () => {
    expect(annuity(100000, 0, 10)).toBe(10000);
    expect(annuity(100000, 12, 12)).toBe(8885);
  });
  it('capacité d\'achat cohérente avec le seuil', () => {
    const L = new Ledger(base(), REF);
    const c = capacity(L, 60);
    expect(c.series[0].max).toBe(88000 - 20000);
  });
  it('minWith applique les effets cumulés', () => {
    expect(minWith([10, 10, 10], [{ idx: 1, v: -5 }]).value).toBe(5);
    expect(minWith([10, 3, 10], [{ idx: 1, v: -5 }], 1).value).toBe(3);
  });
  it('le centre de décision étale les opérations', () => {
    const L = new Ledger(base(), REF);
    const res = optimizeDecisions(L, [
      { id: 'r', label: 'Rembourser ami', date: REF, amount: 20000, direction: 'out', mode: 'comptant', priority: 1 },
      { id: 'pc', label: 'Ordinateur', date: REF, amount: 100000, direction: 'out', mode: 'comptant', priority: 3 },
    ], false);
    expect(res.placed[0].date).toBe(REF);
    expect(res.placed[1].date! > '2026-12-27').toBe(true);
  });
  it('une dette avec seulement une date d\'échéance compte aussi dans le scénario optimiste', () => {
    const s = snap({ debts: [{ id: 'd1', direction: 'dette', person: 'Ami', initialAmount: 8000, currency: 'EUR', createdAt: '2026-10-01', dueDate: '2026-12-10', priority: 1, archived: false }] });
    const L = new Ledger(s, REF);
    const [o, r] = endOfMonthScenarios(L);
    expect(o.end.free).toBe(r.end.free);
    expect(r.end.free).toBe(L.liquidTotal() - 8000);
  });
  it('solder toutes les dettes ne compte pas deux fois les mensualités déjà prévues', () => {
    const s = snap({
      debts: [{ id: 'd1', direction: 'dette', person: 'Ami', initialAmount: 30000, currency: 'EUR', createdAt: '2026-10-01', priority: 1, archived: false }],
      rules: [rule({ id: 'rr', kind: 'debt_repay', debtId: 'd1', amount: 10000, startDate: '2026-12-05', label: 'Mensualité' })],
    });
    const L = new Ledger(s, REF);
    const plain = project(L, { days: 50 });
    const paid = project(L, { days: 50, changes: [{ id: 'c', type: 'payoff_debts', from: '2027-01-15' }] });
    expect(plain.end.free - paid.end.free).toBe(10000);
  });
  it('alerte budget dès le premier palier, y compris sous 75 %', () => {
    const s = snap({
      budgets: [{ id: 'b1', categoryId: 'loyer', amount: 10000, period: 'monthly', rollover: false, active: true, createdAt: now }],
      txs: [tx({ kind: 'expense', amount: 5000, categoryId: 'loyer', date: '2026-12-02' })],
      settings: { ...settings, budgetAlerts: [50] },
    });
    const hit = computeAlerts(new Ledger(s, REF)).find((a) => a.id === 'bb1');
    expect(hit?.level).toBe('warning');
    expect(hit?.title).toContain('50 %');
  });
  it('changement de situation : hausse de loyer', () => {
    const L = new Ledger(base(), REF);
    const p = project(L, { days: 70, changes: [{ id: 'c', type: 'expense_add', label: 'Hausse loyer', amount: 15000, from: '2027-01-05' }] });
    const p0 = project(L, { days: 70 });
    expect(p0.end.free - p.end.free).toBe(30000);
  });
});

describe('dettes', () => {
  it('avalanche coûte moins d\'intérêts que boule de neige', () => {
    const d = [{ id: 'a', name: 'A', balance: 50000, rate: 20, min: 2000 }, { id: 'b', name: 'B', balance: 20000, rate: 0, min: 2000 }];
    const sn = payoffPlan(d, 10000, 'boule_de_neige');
    const av = payoffPlan(d, 10000, 'avalanche');
    expect(sn.feasible && av.feasible).toBe(true);
    expect(av.totalInterest).toBeLessThanOrEqual(sn.totalInterest);
    expect(sn.order[0].id).toBe('b');
  });
});

describe('assistant', () => {
  it('comprend montants et dates', () => {
    expect(parseMoney('acheter un ordinateur à 1 200 € en janvier', 'EUR')).toEqual({ minor: 120000, cur: 'EUR' });
    expect(parseMoney('le 15 décembre pour 900', 'EUR')?.minor).toBe(90000);
    expect(parseDate('en janvier', REF)?.date).toBe('2027-01-01');
    expect(parseDate('le 15 décembre', REF)?.date).toBe('2026-12-15');
    expect(parseDate('dans 3 mois', REF)?.date).toBe(addMonths(REF, 3));
  });
  it('répond à une question d\'achat avec les vraies données', () => {
    const L = new Ledger(snap({ rules: [rule({ label: 'Salaire', kind: 'income', amount: 100000, startDate: '2026-12-28' })] }), REF);
    const a = ask(L, 'Est-ce que je peux acheter un ordinateur à 1 200 € en janvier ?');
    expect(a.text[0]).toContain('ordinateur');
    expect(a.level).toBeDefined();
    const b = ask(L, 'Combien dois-je économiser chaque mois pour avoir 2 000 € en juin ?');
    expect(b.text[0]).toContain('par mois');
  });
});

describe('cohérence dette / échéancier', () => {
  it("n'anticipe pas de remboursement au-delà du reste dû", () => {
    const s = snap({
      debts: [{ id: 'd', direction: 'dette', person: 'X', initialAmount: 15000, currency: 'EUR', createdAt: '2026-10-01', priority: 1, archived: false }],
      rules: [rule({ label: 'Remb', kind: 'debt_repay', amount: 10000, startDate: '2026-12-10', debtId: 'd' })],
    });
    const L = new Ledger(s, REF);
    const p = project(L, { days: 120 });
    expect(p.startFree - p.end.free).toBe(15000);
  });
});
