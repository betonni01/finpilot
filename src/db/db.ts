import Dexie, { type Table } from 'dexie';
import { secureMiddleware } from './secure';
import { activeProfile } from './profiles';
import type {
  Account, AuditEntry, Budget, Category, Cotisation, CotisExpense, CotisPayment, Debt, DocFile, Goal, GoalMove,
  Occurrence, Project, Rule, Scenario, Settings, Tx, Wish,
} from '../engine/types';
import type { RateRow } from '../engine/money';

export class FinDB extends Dexie {
  accounts!: Table<Account, string>;
  txs!: Table<Tx, string>;
  rules!: Table<Rule, string>;
  occurrences!: Table<Occurrence, string>;
  debts!: Table<Debt, string>;
  goals!: Table<Goal, string>;
  goalMoves!: Table<GoalMove, string>;
  cotisations!: Table<Cotisation, string>;
  cotisPayments!: Table<CotisPayment, string>;
  cotisExpenses!: Table<CotisExpense, string>;
  projects!: Table<Project, string>;
  categories!: Table<Category, string>;
  budgets!: Table<Budget, string>;
  wishes!: Table<Wish, string>;
  docs!: Table<DocFile, string>;
  scenarios!: Table<Scenario, string>;
  settings!: Table<Settings, string>;
  rates!: Table<RateRow, string>;
  audit!: Table<AuditEntry, number>;
  meta!: Table<MetaRow, string>;
  outbox!: Table<OutboxRow, string>;
  constructor(name = 'finpilot') {
    super(name);
    this.version(1).stores({
      accounts: 'id', txs: 'id, date, accountId, kind, categoryId, projectId, debtId, ruleId, cotisationId',
      rules: 'id', occurrences: 'id, ruleId, date', debts: 'id', goals: 'id', goalMoves: 'id, goalId, date',
      cotisations: 'id', cotisPayments: 'id, cotisationId', cotisExpenses: 'id, cotisationId', projects: 'id',
      categories: 'id', budgets: 'id', wishes: 'id', docs: 'id, linkId', scenarios: 'id', settings: 'id',
      rates: 'currency', audit: '++id, at, entity, entityId',
    });
    // v2 : métadonnées locales (clés, synchro) et file d'envoi vers le serveur
    this.version(2).stores({ meta: 'id', outbox: 'k, table, ts' });
    this.use(secureMiddleware);
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MetaRow = { id: string } & Record<string, any>;
export interface OutboxRow { k: string; table: string; key: string; deleted: boolean; ts: number }
/** base du profil actif (chaque profil a la sienne) */
export const db = new FinDB(typeof indexedDB !== 'undefined' && typeof localStorage !== 'undefined' ? activeProfile().dbName : 'finpilot');
export const DATA_TABLES = ['accounts', 'txs', 'rules', 'occurrences', 'debts', 'goals', 'goalMoves', 'cotisations', 'cotisPayments', 'cotisExpenses', 'projects', 'categories', 'budgets', 'wishes', 'scenarios', 'settings', 'rates'] as const;
export type DataTable = (typeof DATA_TABLES)[number];
/** tables chiffrées par le coffre (tout sauf meta et outbox) */
export const VAULT_TABLES = [...DATA_TABLES, 'docs', 'audit'] as const;

export function uid(): string {
  try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
}
export const nowIso = () => new Date().toISOString();

export const DEFAULT_SETTINGS: Settings = {
  id: 'main', mainCurrency: 'EUR', safetyThreshold: 15000, theme: 'system', autoLockMin: 5,
  budgetAlerts: [50, 75, 90, 100], variableMode: 'auto', onboarded: false, horizonDays: 365,
  notifications: false, reminderDays: 3, lastBackupAt: null,
};

const C = (id: string, name: string, group: string, kind: Category['kind'], color: string, icon: string, essential = false, financing = false): Category =>
  ({ id, name, group, kind, color, icon, essential, financing, system: true });

export const DEFAULT_CATEGORIES: Category[] = [
  C('loyer', 'Loyer', 'Logement', 'expense', '#6366f1', '🏠', true), C('charges', 'Charges', 'Logement', 'expense', '#818cf8', '🧾', true),
  C('electricite', 'Électricité', 'Logement', 'expense', '#a5b4fc', '💡', true), C('eau', 'Eau', 'Logement', 'expense', '#60a5fa', '🚿', true),
  C('internet', 'Internet', 'Logement', 'expense', '#38bdf8', '📶', true),
  C('courses', 'Courses', 'Alimentation', 'expense', '#22c55e', '🛒', true), C('restaurants', 'Restaurants', 'Alimentation', 'expense', '#4ade80', '🍽️'),
  C('livraison', 'Livraison repas', 'Alimentation', 'expense', '#86efac', '🛵'),
  C('abonnement-transport', 'Abonnement transport', 'Transport', 'expense', '#f59e0b', '🚇', true), C('carburant', 'Carburant', 'Transport', 'expense', '#fbbf24', '⛽', true),
  C('entretien', 'Entretien véhicule', 'Transport', 'expense', '#fcd34d', '🔧'), C('deplacements', 'Déplacements', 'Transport', 'expense', '#fde68a', '🚆'),
  C('telephone', 'Téléphone', 'Vie personnelle', 'expense', '#ec4899', '📱', true), C('habillement', 'Habillement', 'Vie personnelle', 'expense', '#f472b6', '👕'),
  C('sante', 'Santé', 'Vie personnelle', 'expense', '#ef4444', '🩺', true), C('loisirs', 'Loisirs', 'Vie personnelle', 'expense', '#f97316', '🎮'),
  C('abonnements', 'Abonnements', 'Vie personnelle', 'expense', '#fb923c', '🔁'), C('hygiene', 'Hygiène & maison', 'Vie personnelle', 'expense', '#fdba74', '🧴', true),
  C('scolarite', 'Frais de scolarité', 'Études et formation', 'expense', '#14b8a6', '🎓', true), C('materiel-info', 'Matériel informatique', 'Études et formation', 'expense', '#2dd4bf', '💻'),
  C('livres', 'Livres', 'Études et formation', 'expense', '#5eead4', '📚'), C('certifications', 'Certifications', 'Études et formation', 'expense', '#99f6e4', '📜'),
  C('cotisations', 'Cotisations', 'Engagements', 'expense', '#8b5cf6', '🤝'), C('aide-familiale', 'Aides familiales', 'Engagements', 'expense', '#a78bfa', '👨‍👩‍👧', true),
  C('participation', 'Participation collective', 'Engagements', 'expense', '#c4b5fd', '🎉'), C('remboursements', 'Remboursements de dettes', 'Engagements', 'expense', '#7c3aed', '↩️', true),
  C('mensualites', 'Mensualités / paiements fractionnés', 'Engagements', 'expense', '#6d28d9', '🧮', true),
  C('assurance', 'Assurance', 'Engagements', 'expense', '#64748b', '🛡️', true), C('banque', 'Frais bancaires', 'Engagements', 'expense', '#94a3b8', '🏦'),
  C('impots', 'Impôts et taxes', 'Engagements', 'expense', '#475569', '🏛️', true), C('cadeaux', 'Cadeaux & dons', 'Vie personnelle', 'expense', '#e879f9', '🎁'),
  C('divers', 'Divers', 'Divers', 'both', '#9ca3af', '📦'),
  // Revenus
  C('salaire', 'Salaire', 'Revenus', 'income', '#10b981', '💼'), C('alternance', "Rémunération d'alternance", 'Revenus', 'income', '#059669', '🛠️'),
  C('bourse', 'Bourse', 'Revenus', 'income', '#34d399', '🎓'), C('caf', 'Aides CAF', 'Revenus', 'income', '#6ee7b7', '🏛️'),
  C('prestations', 'Prestations ponctuelles', 'Revenus', 'income', '#0ea5e9', '🧰'), C('freelance', 'Freelance', 'Revenus', 'income', '#0284c7', '🧑‍💻'),
  C('commerce', 'Activités commerciales', 'Revenus', 'income', '#0369a1', '🛍️'), C('locatif', 'Revenus locatifs', 'Revenus', 'income', '#075985', '🏘️'),
  C('remb-recu', 'Remboursements reçus', 'Revenus', 'income', '#a3e635', '↪️'), C('dons-recus', 'Dons reçus', 'Revenus', 'income', '#84cc16', '💝'),
  C('revenus-projet', 'Revenus de projets', 'Revenus', 'income', '#65a30d', '🚀'),
  // Projets
  C('proj-materiel', 'Achat de matériel', 'Projet', 'expense', '#0891b2', '🔩'), C('proj-dev', 'Développement informatique', 'Projet', 'expense', '#06b6d4', '⌨️'),
  C('proj-presta', 'Prestations', 'Projet', 'expense', '#22d3ee', '🤝'), C('proj-comm', 'Communication', 'Projet', 'expense', '#67e8f9', '📣'),
  C('proj-hebergement', 'Hébergement / cloud', 'Projet', 'expense', '#a5f3fc', '☁️'), C('proj-salaires', 'Salaires', 'Projet', 'expense', '#0e7490', '👥'),
  C('proj-admin', 'Frais administratifs', 'Projet', 'expense', '#155e75', '🗂️'), C('proj-deplacements', 'Déplacements projet', 'Projet', 'expense', '#164e63', '✈️'),
  C('proj-ventes', 'Ventes', 'Projet', 'income', '#16a34a', '💰'), C('proj-prestations', 'Prestations vendues', 'Projet', 'income', '#15803d', '🧾'),
  C('proj-subvention', 'Subventions', 'Projet', 'income', '#166534', '🏅', false, true), C('proj-invest', 'Investissements', 'Projet', 'income', '#14532d', '📈', false, true),
  C('proj-apport', 'Apport des associés', 'Projet', 'income', '#4d7c0f', '🤲', false, true), C('proj-financement', 'Financement externe', 'Projet', 'income', '#3f6212', '🏦', false, true),
];

export const DEFAULT_RATES: RateRow[] = [
  { currency: 'XOF', rate: 1 / 655.957, updatedAt: '2026-01-01T00:00:00.000Z' },
  { currency: 'XAF', rate: 1 / 655.957, updatedAt: '2026-01-01T00:00:00.000Z' },
];

export async function ensureSeed() {
  await db.transaction('rw', db.settings, db.categories, db.rates, async () => {
    if (!(await db.settings.get('main'))) await db.settings.put(DEFAULT_SETTINGS);
    if ((await db.categories.count()) === 0) await db.categories.bulkPut(DEFAULT_CATEGORIES);
    if ((await db.rates.count()) === 0) await db.rates.bulkPut(DEFAULT_RATES);
  });
  try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
}
