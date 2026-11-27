import { db, nowIso, uid, DEFAULT_SETTINGS } from './db';
import { activeProfile } from './profiles';
import { addDays, addMonths, parts, startOfMonth, today } from '../engine/date';
import { occurrenceDates, occId } from '../engine/recurrence';
import type { Account, Cotisation, CotisPayment, Debt, Goal, GoalMove, Occurrence, Project, Rule, Tx, Budget, Wish } from '../engine/types';

/** Données d'exemple réalistes (montants illustratifs), datées par rapport à aujourd'hui. */
export async function loadDemo() {
  const T = today();
  const start = startOfMonth(addMonths(T, -4));
  const at = nowIso();
  let seed = 42;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = <X,>(a: X[]) => a[Math.floor(rnd() * a.length)];
  const day = (d: number) => { const p = parts(T); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  void day;
  const acc = (p: Partial<Account>): Account => ({ id: uid(), name: '', type: 'banque', currency: 'EUR', initialBalance: 0, openedAt: start, archived: false, liquid: true, projectId: null, createdAt: at, updatedAt: at, ...p });
  const courant = acc({ name: 'Compte courant', institution: 'Banque principale', initialBalance: 185000, color: '#0ea5e9' });
  const livret = acc({ name: 'Livret A', institution: 'Banque principale', type: 'epargne', liquid: false, initialBalance: 90000, color: '#10b981' });
  const cash = acc({ name: 'Espèces', type: 'especes', initialBalance: 6000, color: '#f59e0b' });
  const momo = acc({ name: 'MTN Mobile Money', institution: 'MTN Bénin', type: 'mobile', currency: 'XOF', initialBalance: 45000, color: '#eab308' });
  const projects: Project[] = [
    { id: uid(), name: 'Boutique en ligne', description: 'Vente de produits artisanaux', domain: 'Commerce', startDate: start, endDate: addMonths(T, 10), owner: 'Moi', budget: 200000, currency: 'EUR', status: 'en_cours', phases: [{ id: uid(), name: 'Prototype', budget: 80000 }, { id: uid(), name: 'Pilote terrain', budget: 120000 }], color: '#8b5cf6', archived: false, createdAt: at },
    { id: uid(), name: 'Atelier de fabrication', description: 'Machine de transformation alimentaire', domain: 'Agroalimentaire', startDate: addMonths(start, 1), budget: 150000, currency: 'EUR', status: 'en_cours', phases: [], color: '#f97316', archived: false, createdAt: at },
    { id: uid(), name: 'Service de livraison', domain: 'Logistique', startDate: addMonths(T, 2), budget: 300000, currency: 'EUR', status: 'idee', phases: [], color: '#06b6d4', archived: false, createdAt: at },
  ];
  const projAcc = acc({ name: 'Caisse boutique', type: 'pro', projectId: projects[0].id, initialBalance: 0, color: '#8b5cf6' });
  const accounts = [courant, livret, cash, momo, projAcc];

  const debts: Debt[] = [
    { id: uid(), direction: 'dette', person: 'Ami A', initialAmount: 15000, currency: 'EUR', createdAt: addMonths(T, -2), dueDate: addDays(T, 40), priority: 2, archived: false },
    { id: uid(), direction: 'dette', person: 'Ami B', initialAmount: 20000, currency: 'EUR', createdAt: addMonths(T, -3), dueDate: addMonths(T, 4), priority: 1, archived: false },
    { id: uid(), direction: 'dette', person: 'Paiement fractionné ordinateur', initialAmount: 90000, currency: 'EUR', createdAt: start, priority: 1, rate: 8, archived: false },
    { id: uid(), direction: 'creance', person: 'Cousin', initialAmount: 12000, currency: 'EUR', createdAt: addMonths(T, -1), dueDate: addDays(T, 20), priority: 2, archived: false },
  ];
  const goals: Goal[] = [
    { id: uid(), name: "Fonds d'urgence", target: 300000, currency: 'EUR', priority: 1, isEmergency: true, accountId: livret.id, archived: false, createdAt: at, color: '#10b981' },
    { id: uid(), name: 'Ordinateur portable', target: 120000, currency: 'EUR', priority: 2, isEmergency: false, deadline: addMonths(T, 5), archived: false, createdAt: at, color: '#6366f1' },
    { id: uid(), name: 'Voyage au Bénin', target: 90000, currency: 'EUR', priority: 2, isEmergency: false, deadline: addMonths(T, 8), archived: false, createdAt: at, color: '#f59e0b' },
  ];
  const goalMoves: GoalMove[] = [
    { id: uid(), goalId: goals[0].id, date: start, amount: 90000, note: 'Solde initial du livret affecté', createdAt: at },
    { id: uid(), goalId: goals[1].id, date: addMonths(start, 1), amount: 20000, note: 'Versement', createdAt: at },
    { id: uid(), goalId: goals[2].id, date: addMonths(start, 2), amount: 10000, note: 'Versement', createdAt: at },
  ];
  const meId = uid();
  const names = ['Moi', 'Koffi', 'Aïcha', 'Rodrigue', 'Fifamè', 'Serge', 'Nadège', 'Ulrich', 'Mireille', 'Gildas'];
  const cotis: Cotisation = { id: uid(), name: 'Tontine des amis', type: 'tontine', organizer: 'Moi', amount: 2000, currency: 'EUR', freq: 'monthly', startDate: addMonths(start, 1).slice(0, 8) + '03', participants: names.map((n, i) => ({ id: i === 0 ? meId : uid(), name: n, order: i + 1 })), myParticipantId: meId, accountId: courant.id, collective: true, notes: 'Bénéficiaire tournant chaque mois', archived: false, createdAt: at };

  const R = (p: Partial<Rule>): Rule => ({ id: uid(), label: '', kind: 'expense', amount: 0, accountId: courant.id, freq: 'monthly', interval: 1, startDate: start, certainty: 'certaine', essential: false, active: true, createdAt: start + 'T00:00:00.000Z', updatedAt: at, ...p });
  const sd = (d: number) => start.slice(0, 8) + String(d).padStart(2, '0');
  const rules: Rule[] = [
    R({ label: "Rémunération d'alternance", kind: 'income', amount: 120000, startDate: sd(28), categoryId: 'alternance', payee: 'Employeur' }),
    R({ label: 'Aide au logement (CAF)', kind: 'income', amount: 18000, startDate: sd(5), categoryId: 'caf', payee: 'CAF' }),
    R({ label: 'Loyer', amount: 52000, startDate: sd(5), categoryId: 'loyer', essential: true, payee: 'Propriétaire' }),
    R({ label: 'Électricité', amount: 4500, startDate: sd(10), categoryId: 'electricite', essential: true, payee: 'Fournisseur énergie' }),
    R({ label: 'Téléphone et Internet', amount: 3000, startDate: sd(12), categoryId: 'telephone', essential: true }),
    R({ label: 'Abonnement transport', amount: 4300, startDate: sd(1), categoryId: 'abonnement-transport', essential: true }),
    R({ label: 'Assurance habitation', amount: 1200, startDate: sd(15), categoryId: 'assurance', essential: true }),
    R({ label: 'Musique en streaming', amount: 1199, startDate: sd(18), categoryId: 'abonnements' }),
    R({ label: 'Remboursement Ami B', kind: 'debt_repay', amount: 5000, startDate: addMonths(sd(30), 2), debtId: debts[1].id, essential: true, payee: 'Ami B' }),
    R({ label: 'Mensualité ordinateur', kind: 'debt_repay', amount: 10000, startDate: sd(8), debtId: debts[2].id, essential: true }),
    R({ label: "Épargne : fonds d'urgence", kind: 'saving', amount: 8000, startDate: sd(29), goalId: goals[0].id }),
    R({ label: 'Cotisation : Tontine des amis', amount: 2000, startDate: cotis.startDate, categoryId: 'cotisations', cotisationId: cotis.id }),
    R({ label: 'Apport mensuel boutique', kind: 'transfer', amount: 10000, startDate: sd(2), toAccountId: projAcc.id, projectId: projects[0].id }),
    R({ label: 'Hébergement du site', amount: 1500, accountId: projAcc.id, startDate: sd(20), categoryId: 'proj-hebergement', projectId: projects[0].id }),
    R({ label: 'Mission freelance IoT', kind: 'income', freq: 'once', amount: 30000, startDate: addDays(T, 18), certainty: 'probable', categoryId: 'freelance' }),
    R({ label: 'Remboursement du cousin', kind: 'loan_back', freq: 'once', amount: 12000, startDate: addDays(T, 20), certainty: 'incertaine', debtId: debts[3].id }),
  ];

  const txs: Tx[] = [];
  const occs: Occurrence[] = [];
  const pays: CotisPayment[] = [];
  const tx = (p: Partial<Tx>): Tx => { const t: Tx = { id: uid(), kind: 'expense', date: T, amount: 0, accountId: courant.id, label: '', createdAt: at, updatedAt: at, ...p }; txs.push(t); return t; };
  // Exécution de l'historique des règles
  for (const r of rules) {
    for (const d of occurrenceDates(r, start, addDays(T, -1))) {
      if (r.freq === 'once') continue;
      if (r.kind === 'saving') {
        const t = tx({ kind: 'transfer', date: d, amount: r.amount, accountId: courant.id, toAccountId: livret.id, toAmount: r.amount, label: r.label, ruleId: r.id, occurrenceDate: d });
        goalMoves.push({ id: uid(), goalId: r.goalId!, date: d, amount: r.amount, note: r.label, txId: t.id, createdAt: at });
        occs.push({ id: occId(r.id, d), ruleId: r.id, date: d, status: 'paid', paidAmount: r.amount, txIds: [t.id], actualDate: d });
        continue;
      }
      const t = tx({ kind: r.kind === 'income' ? 'income' : r.kind === 'debt_repay' ? 'debt_repay' : r.kind === 'transfer' ? 'transfer' : 'expense', date: d, amount: r.amount, accountId: r.accountId, toAccountId: r.toAccountId, toAmount: r.toAccountId ? r.amount : undefined, label: r.label, categoryId: r.categoryId, payee: r.payee, ruleId: r.id, occurrenceDate: d, debtId: r.debtId, projectId: r.projectId, cotisationId: r.cotisationId, method: r.kind === 'income' ? 'Virement' : 'Prélèvement' });
      occs.push({ id: occId(r.id, d), ruleId: r.id, date: d, status: 'paid', paidAmount: r.amount, txIds: [t.id], actualDate: d });
      if (r.cotisationId) pays.push({ id: uid(), cotisationId: cotis.id, participantId: meId, period: d, amount: r.amount, date: d, txId: t.id });
    }
  }
  // Prêt initial au cousin et emprunts
  tx({ kind: 'loan_out', date: debts[3].createdAt, amount: 12000, label: 'Prêt à Cousin', debtId: debts[3].id, payee: 'Cousin' });
  tx({ kind: 'debt_borrow', date: debts[0].createdAt, amount: 15000, label: 'Emprunt : Ami A', debtId: debts[0].id, payee: 'Ami A' });
  tx({ kind: 'debt_repay', date: addDays(debts[1].createdAt, 20), amount: 5000, label: 'Remboursement à Ami B', debtId: debts[1].id, categoryId: 'remboursements' });
  // Dépenses variables
  const shops = ['Intermarché', 'Lidl', 'Carrefour Market', 'Marché', 'Auchan'];
  for (let d = start; d < T; d = addDays(d, 1)) {
    const w = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;
    if (w === 5 || (w === 2 && rnd() < 0.3)) tx({ date: d, amount: Math.round(2200 + rnd() * 2600), label: 'Courses', payee: pick(shops), categoryId: 'courses', method: 'Carte bancaire', priority: 'essentielle' });
    if (rnd() < 0.06) tx({ date: d, amount: Math.round(800 + rnd() * 1600), label: 'Restaurant', payee: pick(['Kebab', 'Restaurant africain', 'Pizzeria', 'Café']), categoryId: 'restaurants', method: 'Carte bancaire', priority: 'confort' });
    if (rnd() < 0.035) tx({ date: d, amount: Math.round(900 + rnd() * 2000), label: pick(['Cinéma', 'Sortie', 'Jeu vidéo', 'Concert']), categoryId: 'loisirs', method: 'Carte bancaire', priority: 'confort' });
    if (rnd() < 0.02) tx({ date: d, amount: Math.round(1500 + rnd() * 2500), label: pick(['Vêtements', 'Chaussures']), categoryId: 'habillement', method: 'Carte bancaire', priority: 'utile' });
    if (rnd() < 0.04) tx({ date: d, amount: Math.round(300 + rnd() * 1000), label: pick(['Pharmacie', 'Produits ménagers']), categoryId: pick(['sante', 'hygiene']), method: 'Carte bancaire', priority: 'essentielle' });
    if (rnd() < 0.03) tx({ date: d, amount: Math.round(400 + rnd() * 1000), label: 'Dépense en espèces', accountId: cash.id, categoryId: pick(['divers', 'courses', 'restaurants']), method: 'Espèces' });
    if (rnd() < 0.018) tx({ date: d, amount: Math.round(1000 + rnd() * 2000) * 10, label: 'Transfert famille', accountId: momo.id, categoryId: 'aide-familiale', method: 'Mobile money' });
  }
  // Retrait espèces (transfert neutre) et rechargement mobile money
  tx({ kind: 'transfer', date: addDays(start, 10), amount: 6000, accountId: courant.id, toAccountId: cash.id, toAmount: 6000, label: 'Retrait DAB' });
  tx({ kind: 'transfer', date: addDays(start, 40), amount: 15000, accountId: courant.id, toAccountId: momo.id, toAmount: 98394, label: 'Rechargement MoMo' });
  // Dépenses projets
  tx({ date: addDays(start, 15), amount: 8900, label: 'Nom de domaine et maquettes', accountId: projAcc.id, projectId: projects[0].id, phaseId: projects[0].phases[0].id, categoryId: 'proj-dev' });
  tx({ date: addDays(start, 50), amount: 4500, label: 'Moteur et roulements', projectId: projects[1].id, categoryId: 'proj-materiel', payee: 'Fournisseur pièces' });
  tx({ kind: 'income', date: addDays(start, 70), amount: 25000, label: 'Subvention incubateur', accountId: projAcc.id, projectId: projects[0].id, categoryId: 'proj-subvention', payee: 'Incubateur' });
  // Paiements collectifs de la tontine
  for (const d of occurrenceDates({ freq: 'monthly', interval: 1, startDate: cotis.startDate }, cotis.startDate, addDays(T, -1))) {
    for (const p of cotis.participants.slice(1)) {
      const r = rnd();
      if (r < 0.85) pays.push({ id: uid(), cotisationId: cotis.id, participantId: p.id, period: d, amount: 2000, date: addDays(d, Math.floor(rnd() * 5)) });
      else if (r < 0.93) pays.push({ id: uid(), cotisationId: cotis.id, participantId: p.id, period: d, amount: 1000, date: addDays(d, 3) });
    }
  }
  const budgets: Budget[] = [
    ['courses', 22000], ['restaurants', 6000], ['loisirs', 5000], ['habillement', 4000], ['divers', 4000], ['aide-familiale', 10000],
  ].map(([c, a]) => ({ id: uid(), categoryId: c as string, amount: a as number, period: 'monthly' as const, rollover: false, active: true, createdAt: at }));
  const wishes: Wish[] = [
    { id: uid(), name: 'Téléphone', price: 90000, currency: 'EUR', priority: 2, status: 'envie', createdAt: at },
    { id: uid(), name: 'Casque à réduction de bruit', price: 15000, currency: 'EUR', priority: 3, status: 'envie', createdAt: at },
  ];
  await db.transaction('rw', [db.accounts, db.txs, db.rules, db.occurrences, db.debts, db.goals, db.goalMoves, db.cotisations, db.cotisPayments, db.projects, db.budgets, db.wishes, db.settings, db.audit], async () => {
    await db.accounts.bulkPut(accounts); await db.projects.bulkPut(projects); await db.debts.bulkPut(debts); await db.goals.bulkPut(goals);
    await db.goalMoves.bulkPut(goalMoves); await db.cotisations.put(cotis); await db.rules.bulkPut(rules); await db.txs.bulkPut(txs);
    await db.occurrences.bulkPut(occs); await db.cotisPayments.bulkPut(pays); await db.budgets.bulkPut(budgets); await db.wishes.bulkPut(wishes);
    const s = (await db.settings.get('main')) ?? DEFAULT_SETTINGS;
    await db.settings.put({ ...s, onboarded: true, userName: s.userName || (activeProfile().name !== 'Mon profil' ? activeProfile().name : 'Alex'), safetyThreshold: 15000, lastBackupAt: at });
    await db.audit.add({ at, entity: 'system', entityId: 'demo', action: 'create', summary: "Chargement des données d'exemple" });
  });
}
