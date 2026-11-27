import type { DStr } from './date';
import type { RateRow } from './money';

export type ID = string;

export type AccountType = 'banque' | 'epargne' | 'especes' | 'mobile' | 'portefeuille' | 'pro' | 'autre';
export interface Account {
  id: ID; name: string; institution?: string; type: AccountType; currency: string;
  initialBalance: number; openedAt: DStr; archived: boolean;
  /** compte appartenant à un projet (null = personnel) */
  projectId?: ID | null;
  /** compte mobilisable au quotidien (faux pour l'épargne bloquée) */
  liquid: boolean; color?: string; notes?: string; createdAt: string; updatedAt: string;
}

export type TxKind = 'income' | 'expense' | 'transfer' | 'debt_borrow' | 'debt_repay' | 'loan_out' | 'loan_back';
export type Priority = 'essentielle' | 'utile' | 'confort';
export interface Tx {
  id: ID; kind: TxKind; date: DStr;
  /** montant positif, unités mineures de la devise du compte */
  amount: number; accountId: ID;
  toAccountId?: ID; toAmount?: number;
  categoryId?: ID; label: string; payee?: string; method?: string; notes?: string;
  priority?: Priority; taxable?: boolean;
  projectId?: ID; phaseId?: ID; debtId?: ID; cotisationId?: ID; goalId?: ID;
  ruleId?: ID; occurrenceDate?: DStr; docIds?: ID[];
  createdAt: string; updatedAt: string;
}

export type Freq = 'once' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type RuleKind = 'income' | 'expense' | 'saving' | 'debt_repay' | 'loan_back' | 'transfer';
export type Certainty = 'certaine' | 'probable' | 'incertaine';
export interface Rule {
  id: ID; label: string; kind: RuleKind; amount: number; accountId: ID; toAccountId?: ID;
  categoryId?: ID; freq: Freq; interval: number; startDate: DStr; endDate?: DStr | null;
  certainty: Certainty; essential: boolean; active: boolean; payee?: string;
  projectId?: ID; debtId?: ID; goalId?: ID; cotisationId?: ID; notes?: string;
  reminderDays?: number; createdAt: string; updatedAt: string;
}
export interface Occurrence {
  id: string; // `${ruleId}|${date}`
  ruleId: ID; date: DStr; status: 'paid' | 'partial' | 'cancelled';
  paidAmount: number; txIds: ID[]; actualDate?: DStr; note?: string;
}

export interface Debt {
  id: ID; direction: 'dette' | 'creance'; person: string; label?: string;
  initialAmount: number; currency: string; createdAt: DStr; dueDate?: DStr | null;
  rate?: number; priority: 1 | 2 | 3; notes?: string; archived: boolean; docIds?: ID[];
}

export interface Goal {
  id: ID; name: string; target: number; currency: string; deadline?: DStr | null;
  priority: 1 | 2 | 3; accountId?: ID | null; isEmergency: boolean; color?: string;
  archived: boolean; createdAt: string;
}
export interface GoalMove { id: ID; goalId: ID; date: DStr; amount: number; note?: string; txId?: ID; createdAt: string }

export interface Participant { id: ID; name: string; order?: number }
export interface Cotisation {
  id: ID; name: string; type: 'tontine' | 'association' | 'famille' | 'evenement' | 'projet' | 'amis' | 'autre';
  organizer?: string; amount: number; currency: string; freq: Freq; startDate: DStr; endDate?: DStr | null;
  participants: Participant[]; myParticipantId?: ID | null; accountId?: ID | null;
  collective: boolean; target?: number; notes?: string; archived: boolean; createdAt: string;
}
export interface CotisPayment { id: ID; cotisationId: ID; participantId: ID; period: DStr; amount: number; date: DStr; txId?: ID; note?: string }
export interface CotisExpense { id: ID; cotisationId: ID; label: string; amount: number; date: DStr; note?: string }

export interface Phase { id: ID; name: string; budget: number }
export interface Project {
  id: ID; name: string; description?: string; domain?: string; startDate: DStr; endDate?: DStr | null;
  owner?: string; budget: number; currency: string;
  status: 'idee' | 'en_cours' | 'suspendu' | 'termine'; target?: number; phases: Phase[];
  color?: string; archived: boolean; createdAt: string;
}

export interface Category {
  id: ID; name: string; group: string; kind: 'expense' | 'income' | 'both'; essential: boolean;
  color: string; icon?: string; archived?: boolean; system?: boolean;
  /** catégorie de financement (apport, investissement) : non comptée comme recette d'exploitation */
  financing?: boolean;
}
export interface Budget {
  id: ID; categoryId: ID | null; amount: number; period: 'weekly' | 'monthly' | 'yearly';
  rollover: boolean; projectId?: ID | null; accountId?: ID | null; active: boolean; createdAt: string;
}
export interface Wish {
  id: ID; name: string; price: number; currency: string; priority: 1 | 2 | 3; url?: string;
  notes?: string; targetDate?: DStr | null; status: 'envie' | 'planifie' | 'achete' | 'abandonne'; createdAt: string;
}
export interface DocFile {
  id: ID; name: string; mime: string; size: number; blob: Blob; blobEnc?: boolean; category: string;
  linkType?: 'tx' | 'debt' | 'project' | 'cotisation' | 'goal' | 'rule' | null; linkId?: ID | null;
  notes?: string; archived: boolean; createdAt: string;
}

export type VirtualMode = 'comptant' | 'plusieurs' | 'credit' | 'epargne';
export interface VirtualOp {
  id: ID; label: string; date: DStr; amount: number; direction: 'out' | 'in';
  mode: VirtualMode; installments?: number; fees?: number; intervalDays?: number;
  downPayment?: number; rate?: number; months?: number; goalId?: ID; priority?: 1 | 2 | 3;
  /** pour le centre de décision : date au plus tôt */
  earliest?: DStr; latest?: DStr | null; kindHint?: 'achat' | 'remboursement' | 'epargne' | 'projet' | 'autre';
}
export type Change =
  | { id: ID; type: 'income_delta'; label: string; amount: number; from: DStr }
  | { id: ID; type: 'expense_add'; label: string; amount: number; from: DStr }
  | { id: ID; type: 'rule_off'; ruleId: ID; from: DStr }
  | { id: ID; type: 'rule_amount'; ruleId: ID; amount: number; from: DStr }
  | { id: ID; type: 'variable_pct'; pct: number }
  | { id: ID; type: 'payoff_debts'; from: DStr }
  | { id: ID; type: 'saving_add'; label: string; amount: number; from: DStr };
export interface Scenario { id: ID; name: string; createdAt: string; ops: VirtualOp[]; changes: Change[]; notes?: string; kind: 'decision' | 'situation' | 'achat' }

export interface Settings {
  id: 'main'; mainCurrency: string; safetyThreshold: number; theme: 'light' | 'dark' | 'system';
  pinHash?: string | null; pinSalt?: string | null; autoLockMin: number;
  budgetAlerts: number[]; variableMode: 'auto' | 'manual' | 'off'; manualDailyVariable?: number;
  lastBackupAt?: string | null; onboarded: boolean; userName?: string; horizonDays: number;
  notifications: boolean; reminderDays: number;
}

export interface AuditEntry { id?: number; at: string; entity: string; entityId: string; action: 'create' | 'update' | 'delete'; summary: string; before?: unknown; after?: unknown }

export interface Snapshot {
  accounts: Account[]; txs: Tx[]; rules: Rule[]; occurrences: Occurrence[]; debts: Debt[];
  goals: Goal[]; goalMoves: GoalMove[]; cotisations: Cotisation[]; cotisPayments: CotisPayment[];
  cotisExpenses: CotisExpense[]; projects: Project[]; categories: Category[]; budgets: Budget[];
  wishes: Wish[]; scenarios: Scenario[]; settings: Settings; rates: RateRow[];
}
