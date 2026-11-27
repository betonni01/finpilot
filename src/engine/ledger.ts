import { addDays, endOfMonth, monthKey, startOfMonth, today, type DStr, diffDays } from './date';
import { convert, sum } from './money';
import { monthlyFactor, pendingOccurrences, type PendingOcc } from './recurrence';
import type { Account, Debt, Goal, Project, Rule, Snapshot, Tx } from './types';

export const IN_KINDS = new Set(['income', 'debt_borrow', 'loan_back']);
export const OUT_KINDS = new Set(['expense', 'debt_repay', 'loan_out']);

/** Effet signé d'une transaction sur un compte donné (unités mineures du compte). */
export function txEffectOn(tx: Tx, accountId: string): number {
  let e = 0;
  if (tx.accountId === accountId) {
    if (IN_KINDS.has(tx.kind)) e += tx.amount;
    else e -= tx.amount; // dépenses, remboursements, prêts, transferts sortants
  }
  if (tx.kind === 'transfer' && tx.toAccountId === accountId) e += tx.toAmount ?? tx.amount;
  return e;
}

export function accountBalances(accounts: Account[], txs: Tx[], upTo?: DStr): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of accounts) m.set(a.id, a.initialBalance);
  for (const t of txs) {
    if (upTo && t.date > upTo) continue;
    if (m.has(t.accountId)) m.set(t.accountId, m.get(t.accountId)! + txEffectOn(t, t.accountId));
    if (t.kind === 'transfer' && t.toAccountId && t.toAccountId !== t.accountId && m.has(t.toAccountId)) {
      m.set(t.toAccountId, m.get(t.toAccountId)! + (t.toAmount ?? t.amount));
    }
  }
  return m;
}

export class Ledger {
  s: Snapshot;
  main: string;
  ref: DStr;
  acc: Map<string, Account>;
  balances: Map<string, number>;
  constructor(s: Snapshot, ref = today()) {
    this.s = s;
    this.ref = ref;
    this.main = s.settings.mainCurrency;
    this.acc = new Map(s.accounts.map((a) => [a.id, a]));
    this.balances = accountBalances(s.accounts, s.txs);
  }
  conv(minor: number, from: string, to = this.main, date?: string) {
    return convert(minor, from, to, this.main, this.s.rates, date);
  }
  isPersonal(accountId?: string | null) {
    const a = accountId ? this.acc.get(accountId) : undefined;
    return !!a && !a.projectId;
  }
  isLiquidPersonal(accountId?: string | null) {
    const a = accountId ? this.acc.get(accountId) : undefined;
    return !!a && !a.projectId && a.liquid && !a.archived;
  }
  accCur(accountId?: string | null) {
    return (accountId && this.acc.get(accountId)?.currency) || this.main;
  }
  /** Montant d'une transaction converti en devise principale. */
  txMain(t: Tx) {
    return this.conv(t.amount, this.accCur(t.accountId), this.main, t.date);
  }
  balanceMain(accountId: string) {
    return this.conv(this.balances.get(accountId) ?? 0, this.accCur(accountId));
  }

  // ---------- Agrégats de trésorerie ----------
  get personalAccounts() { return this.s.accounts.filter((a) => !a.projectId && !a.archived); }
  liquidTotal() { return sum(this.personalAccounts.filter((a) => a.liquid).map((a) => this.balanceMain(a.id))); }
  personalTotal() { return sum(this.personalAccounts.map((a) => this.balanceMain(a.id))); }
  cashTotal() { return sum(this.personalAccounts.filter((a) => a.type === 'especes').map((a) => this.balanceMain(a.id))); }
  savingsAccountsTotal() { return sum(this.personalAccounts.filter((a) => a.type === 'epargne' || !a.liquid).map((a) => this.balanceMain(a.id))); }

  // ---------- Objectifs d'épargne ----------
  goalSaved(g: Goal) { return sum(this.s.goalMoves.filter((m) => m.goalId === g.id).map((m) => m.amount)); }
  /** Épargne affectée qui dort sur des comptes liquides (à retirer du disponible). */
  liquidAllocations() {
    return sum(this.s.goals.filter((g) => !g.archived).map((g) => {
      const onIlliquid = g.accountId && this.acc.get(g.accountId) && !this.acc.get(g.accountId)!.liquid;
      return onIlliquid ? 0 : this.conv(Math.max(0, this.goalSaved(g)), g.currency);
    }));
  }
  totalSavings() {
    // épargne = comptes d'épargne + allocations sur comptes liquides
    return this.savingsAccountsTotal() + this.liquidAllocations();
  }

  // ---------- Dettes et créances ----------
  debtPaid(d: Debt) {
    const kind = d.direction === 'dette' ? 'debt_repay' : 'loan_back';
    return sum(this.s.txs.filter((t) => t.debtId === d.id && t.kind === kind).map((t) => this.conv(t.amount, this.accCur(t.accountId), d.currency, t.date)));
  }
  debtRemaining(d: Debt) { return Math.max(0, d.initialAmount - this.debtPaid(d)); }
  totalDebts() { return sum(this.s.debts.filter((d) => d.direction === 'dette' && !d.archived).map((d) => this.conv(this.debtRemaining(d), d.currency))); }
  totalClaims() { return sum(this.s.debts.filter((d) => d.direction === 'creance' && !d.archived).map((d) => this.conv(this.debtRemaining(d), d.currency))); }
  netWorth() { return this.personalTotal() + this.totalClaims() - this.totalDebts(); }

  // ---------- Classification des flux personnels ----------
  /**
   * Classe une transaction du point de vue des finances personnelles.
   * Un transfert entre deux comptes personnels est neutre. Une dépense liée à un projet
   * ou un transfert vers un compte projet est un apport, pas une consommation.
   */
  classify(t: Tx): 'revenu' | 'depense' | 'neutre' | 'apport_projet' | 'retour_projet' | 'dette' | 'remboursement' | 'pret' | 'recouvrement' | 'hors_perimetre' {
    const fromP = this.isPersonal(t.accountId);
    if (t.kind === 'transfer') {
      const toP = this.isPersonal(t.toAccountId);
      if (fromP && toP) return 'neutre';
      if (fromP && !toP) return 'apport_projet';
      if (!fromP && toP) return 'retour_projet';
      return 'hors_perimetre';
    }
    if (!fromP) return 'hors_perimetre';
    switch (t.kind) {
      case 'income': return 'revenu';
      case 'expense': return t.projectId ? 'apport_projet' : 'depense';
      case 'debt_borrow': return 'dette';
      case 'debt_repay': return 'remboursement';
      case 'loan_out': return 'pret';
      case 'loan_back': return 'recouvrement';
    }
    return 'neutre';
  }
  personalTxs(from: DStr, to: DStr) { return this.s.txs.filter((t) => t.date >= from && t.date <= to); }
  incomeBetween(from: DStr, to: DStr) { return sum(this.personalTxs(from, to).filter((t) => this.classify(t) === 'revenu').map((t) => this.txMain(t))); }
  expenseBetween(from: DStr, to: DStr) { return sum(this.personalTxs(from, to).filter((t) => this.classify(t) === 'depense').map((t) => this.txMain(t))); }
  /** Dépenses par catégorie (consommation personnelle uniquement). */
  expenseByCategory(from: DStr, to: DStr): Map<string, number> {
    const m = new Map<string, number>();
    for (const t of this.personalTxs(from, to)) {
      if (this.classify(t) !== 'depense') continue;
      const k = t.categoryId || 'sans';
      m.set(k, (m.get(k) ?? 0) + this.txMain(t));
    }
    return m;
  }

  /** Solde liquide personnel jour par jour sur le passé (pour les graphiques). */
  liquidHistory(days: number): { date: DStr; value: number }[] {
    const liquid = new Set(this.personalAccounts.filter((a) => a.liquid).map((a) => a.id));
    const deltaByDay = new Map<string, number>();
    for (const t of this.s.txs) {
      let e = 0;
      if (liquid.has(t.accountId)) e += this.conv(txEffectOn(t, t.accountId), this.accCur(t.accountId), this.main, t.date);
      if (t.kind === 'transfer' && t.toAccountId && liquid.has(t.toAccountId) && t.toAccountId !== t.accountId) e += this.conv(t.toAmount ?? t.amount, this.accCur(t.toAccountId), this.main, t.date);
      if (e) deltaByDay.set(t.date, (deltaByDay.get(t.date) ?? 0) + e);
    }
    let v = this.liquidTotal();
    // corrige les opérations futures déjà saisies
    for (const [d, e] of deltaByDay) if (d > this.ref) v -= e;
    const out: { date: DStr; value: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(this.ref, -i);
      out.push({ date: d, value: v });
      v -= deltaByDay.get(d) ?? 0;
    }
    return out.reverse();
  }

  // ---------- Règles et charges ----------
  ruleMain(r: Rule) { return this.conv(r.amount, this.accCur(r.accountId)); }
  ruleMonthly(r: Rule) { return Math.round(this.ruleMain(r) * monthlyFactor(r.freq, r.interval)); }
  activeRules() { return this.s.rules.filter((r) => r.active && (!r.endDate || r.endDate >= this.ref)); }
  personalRule(r: Rule) { return this.isPersonal(r.accountId); }

  /** Rythme quotidien des dépenses variables (non planifiées), devise principale. */
  variableDaily(): { value: number; source: string } {
    const st = this.s.settings;
    if (st.variableMode === 'off') return { value: 0, source: 'désactivé' };
    if (st.variableMode === 'manual') return { value: st.manualDailyVariable ?? 0, source: 'saisie manuelle' };
    const from = addDays(this.ref, -90);
    const txs = this.s.txs.filter((t) => t.date >= from && t.date <= this.ref && !t.ruleId && this.classify(t) === 'depense');
    const first = this.s.txs.length ? this.s.txs.reduce((m, t) => (t.date < m ? t.date : m), this.ref) : this.ref;
    const span = Math.min(90, Math.max(0, diffDays(this.ref, first) + 1));
    if (span >= 21 && txs.length >= 5) {
      return { value: Math.round(sum(txs.map((t) => this.txMain(t))) / span), source: `historique des ${span} derniers jours` };
    }
    // repli : budgets des catégories non couvertes par une règle
    const ruled = new Set(this.activeRules().map((r) => r.categoryId).filter(Boolean));
    const b = this.s.budgets.filter((x) => x.active && !x.projectId && x.categoryId && !ruled.has(x.categoryId));
    const monthly = sum(b.map((x) => x.period === 'weekly' ? x.amount * 4.348 : x.period === 'yearly' ? x.amount / 12 : x.amount));
    if (monthly > 0) return { value: Math.round(monthly / 30.4375), source: 'budgets prévus (historique insuffisant)' };
    return { value: 0, source: 'aucune donnée' };
  }

  /** Dépenses essentielles mensuelles (base du fonds d'urgence). */
  essentialMonthly(): { total: number; lines: { label: string; amount: number }[] } {
    const lines: { label: string; amount: number }[] = [];
    for (const r of this.activeRules()) {
      if (!this.personalRule(r)) continue;
      const isCharge = r.kind === 'expense' || r.kind === 'debt_repay';
      if (!isCharge) continue;
      const cat = this.s.categories.find((c) => c.id === r.categoryId);
      if (r.essential || cat?.essential || r.kind === 'debt_repay') lines.push({ label: r.label, amount: this.ruleMonthly(r) });
    }
    // dépenses variables essentielles (moyenne des 3 derniers mois complets)
    const from = startOfMonth(addDays(startOfMonth(this.ref), -85));
    const to = addDays(startOfMonth(this.ref), -1);
    const ess = new Set(this.s.categories.filter((c) => c.essential).map((c) => c.id));
    const v = sum(this.s.txs.filter((t) => t.date >= from && t.date <= to && !t.ruleId && t.categoryId && ess.has(t.categoryId) && this.classify(t) === 'depense').map((t) => this.txMain(t)));
    const months = Math.max(1, Math.round(diffDays(to, from) / 30.4));
    if (v > 0) lines.push({ label: 'Dépenses courantes essentielles (moyenne)', amount: Math.round(v / months) });
    return { total: sum(lines.map((l) => l.amount)), lines };
  }

  /** Reste à vivre mensuel structurel : revenus certains moins obligations récurrentes. */
  resteAVivre() {
    const incomes: { label: string; amount: number }[] = [];
    const charges: { label: string; amount: number; kind: string }[] = [];
    for (const r of this.activeRules()) {
      if (!this.personalRule(r)) continue;
      const m = this.ruleMonthly(r);
      if (!m) continue;
      if (r.kind === 'income') { if (r.certainty === 'certaine') incomes.push({ label: r.label, amount: m }); }
      else if (r.kind === 'expense' || r.kind === 'debt_repay') charges.push({ label: r.label, amount: m, kind: r.cotisationId ? 'Cotisation' : r.kind === 'debt_repay' ? 'Remboursement' : 'Charge' });
      else if (r.kind === 'saving') charges.push({ label: r.label, amount: m, kind: 'Épargne' });
      else if (r.kind === 'transfer' && !this.isPersonal(r.toAccountId)) charges.push({ label: r.label, amount: m, kind: 'Apport projet' });
    }
    const inc = sum(incomes.map((x) => x.amount));
    const ch = sum(charges.map((x) => x.amount));
    return { incomes, charges, totalIncome: inc, totalCharges: ch, reste: inc - ch };
  }

  /** Prochain revenu certain (date) après la date de référence. */
  nextCertainIncome(): { date: DStr; label: string; amount: number } | null {
    const p = pendingOccurrences(this.activeRules().filter((r) => r.kind === 'income' && r.certainty === 'certaine' && this.isLiquidPersonal(r.accountId)), this.s.occurrences, addDays(this.ref, 1), addDays(this.ref, 62), 0, this.ref);
    const f = p.find((x) => x.date > this.ref);
    return f ? { date: f.date, label: f.rule.label, amount: this.conv(f.remaining, this.accCur(f.rule.accountId)) } : null;
  }

  /**
   * Plafonne les échéances liées à une dette ou une créance au reste réellement dû.
   * Une dette déjà soldée ne génère plus d'engagement, même si la règle continue.
   */
  capByDebt(items: PendingOcc[]): { kept: PendingOcc[]; total: number } {
    const left = new Map(this.s.debts.map((d) => [d.id, this.conv(this.debtRemaining(d), d.currency)]));
    const kept: PendingOcc[] = [];
    let total = 0;
    for (const p of items) {
      let v = this.conv(p.remaining, this.accCur(p.rule.accountId));
      const id = p.rule.debtId;
      if ((p.rule.kind === 'debt_repay' || p.rule.kind === 'loan_back') && id && left.has(id)) {
        const rem = Math.max(0, left.get(id)!);
        v = Math.min(v, rem);
        left.set(id, rem - v);
      }
      if (v <= 0) continue;
      total += v;
      kept.push(p);
    }
    return { kept, total };
  }

  /**
   * Disponible réel = liquidités − épargne affectée − engagements dus avant le prochain revenu certain − réserve de sécurité.
   */
  available() {
    const liquid = this.liquidTotal();
    const alloc = this.liquidAllocations();
    const next = this.nextCertainIncome();
    const until = next ? addDays(next.date, -1) : endOfMonth(this.ref) > addDays(this.ref, 6) ? endOfMonth(this.ref) : endOfMonth(addDays(this.ref, 10));
    const pend = pendingOccurrences(this.activeRules(), this.s.occurrences, this.ref, until, 120, this.ref).filter((p) => {
      const r = p.rule;
      if (!this.isLiquidPersonal(r.accountId)) return false;
      if (r.kind === 'expense' || r.kind === 'debt_repay') return true;
      if (r.kind === 'saving') return true;
      if (r.kind === 'transfer') return !this.isLiquidPersonal(r.toAccountId);
      return false;
    });
    const capped = this.capByDebt(pend);
    const commitments = capped.total;
    const reserve = this.s.settings.safetyThreshold;
    return { liquid, alloc, commitments, reserve, until, next, items: capped.kept, value: liquid - alloc - commitments - reserve };
  }

  // ---------- Projets ----------
  projectStats(p: Project) {
    const pAcc = this.s.accounts.filter((a) => a.projectId === p.id);
    const pAccIds = new Set(pAcc.map((a) => a.id));
    const cv = (t: Tx) => this.conv(t.amount, this.accCur(t.accountId), p.currency, t.date);
    const cats = new Map(this.s.categories.map((c) => [c.id, c]));
    let expenses = 0, revenues = 0, financing = 0, personalContrib = 0;
    const byCat = new Map<string, number>();
    const byPhase = new Map<string, number>();
    const contributors = new Map<string, number>();
    for (const t of this.s.txs) {
      const linked = t.projectId === p.id || pAccIds.has(t.accountId) || (t.kind === 'transfer' && t.toAccountId && pAccIds.has(t.toAccountId));
      if (!linked) continue;
      if (t.kind === 'transfer') {
        const toProj = t.toAccountId && pAccIds.has(t.toAccountId);
        const fromProj = pAccIds.has(t.accountId);
        if (toProj && !fromProj) { const v = this.conv(t.toAmount ?? t.amount, this.accCur(t.toAccountId), p.currency, t.date); financing += v; if (this.isPersonal(t.accountId)) personalContrib += v; contributors.set('Apport personnel', (contributors.get('Apport personnel') ?? 0) + v); }
        if (fromProj && !toProj) { financing -= cv(t); if (this.isPersonal(t.toAccountId)) personalContrib -= cv(t); }
        continue;
      }
      const v = cv(t);
      if (t.kind === 'expense' || t.kind === 'debt_repay') {
        expenses += v;
        const k = t.categoryId || 'sans'; byCat.set(k, (byCat.get(k) ?? 0) + v);
        if (t.phaseId) byPhase.set(t.phaseId, (byPhase.get(t.phaseId) ?? 0) + v);
        if (this.isPersonal(t.accountId)) { personalContrib += v; financing += v; contributors.set('Apport personnel', (contributors.get('Apport personnel') ?? 0) + v); }
      } else if (t.kind === 'income' || t.kind === 'debt_borrow') {
        const c = t.categoryId ? cats.get(t.categoryId) : undefined;
        if (c?.financing || t.kind === 'debt_borrow') { financing += v; const who = t.payee || c?.name || 'Financement'; contributors.set(who, (contributors.get(who) ?? 0) + v); }
        else revenues += v;
      }
    }
    // engagements planifiés liés au projet (12 mois ou jusqu'à la fin du projet)
    const horizon = p.endDate && p.endDate > this.ref ? p.endDate : addDays(this.ref, 365);
    const planned = pendingOccurrences(this.activeRules().filter((r) => r.projectId === p.id || pAccIds.has(r.accountId)), this.s.occurrences, this.ref, horizon, 60, this.ref);
    const committed = sum(planned.filter((x) => x.rule.kind === 'expense').map((x) => this.conv(x.remaining, this.accCur(x.rule.accountId), p.currency)));
    const plannedIncome = sum(planned.filter((x) => x.rule.kind === 'income').map((x) => this.conv(x.remaining, this.accCur(x.rule.accountId), p.currency)));
    const treasury = pAcc.length ? sum(pAcc.map((a) => this.conv(this.balances.get(a.id) ?? 0, a.currency, p.currency))) : financing + revenues - expenses;
    return {
      expenses, revenues, financing, personalContrib, committed, plannedIncome, treasury,
      result: revenues - expenses, budgetLeft: p.budget - expenses - committed,
      consumedPct: p.budget > 0 ? expenses / p.budget : 0, byCat, byPhase, contributors, accounts: pAcc, planned,
    };
  }

  // ---------- Budgets ----------
  budgetPeriod(period: 'weekly' | 'monthly' | 'yearly', ref = this.ref): { from: DStr; to: DStr } {
    if (period === 'monthly') return { from: startOfMonth(ref), to: endOfMonth(ref) };
    if (period === 'yearly') return { from: ref.slice(0, 4) + '-01-01', to: ref.slice(0, 4) + '-12-31' };
    const wd = (new Date(ref + 'T00:00:00Z').getUTCDay() + 6) % 7;
    const from = addDays(ref, -wd);
    return { from, to: addDays(from, 6) };
  }
  budgetUsage(b: { categoryId: string | null; period: 'weekly' | 'monthly' | 'yearly'; projectId?: string | null; accountId?: string | null; amount: number; rollover: boolean }, ref = this.ref) {
    const { from, to } = this.budgetPeriod(b.period, ref);
    const spentIn = (f: DStr, t2: DStr) => sum(this.s.txs.filter((t) => {
      if (t.date < f || t.date > t2) return false;
      if (b.projectId) return (t.projectId === b.projectId) && (t.kind === 'expense') && (!b.categoryId || t.categoryId === b.categoryId);
      if (this.classify(t) !== 'depense') return false;
      if (b.accountId && t.accountId !== b.accountId) return false;
      return !b.categoryId || t.categoryId === b.categoryId;
    }).map((t) => this.txMain(t)));
    const spent = spentIn(from, to);
    let carry = 0;
    if (b.rollover && b.period === 'monthly') {
      const prevRef = addDays(from, -1);
      const pp = this.budgetPeriod('monthly', prevRef);
      carry = Math.max(0, b.amount - spentIn(pp.from, pp.to));
    }
    const limit = b.amount + carry;
    return { from, to, spent, carry, limit, pct: limit > 0 ? spent / limit : 0, left: limit - spent };
  }

  monthSeries(months: number): { key: string; income: number; expense: number; net: number }[] {
    const out: { key: string; income: number; expense: number; net: number }[] = [];
    let ref = startOfMonth(this.ref);
    const keys: string[] = [];
    for (let i = 0; i < months; i++) { keys.unshift(monthKey(ref)); ref = startOfMonth(addDays(ref, -1)); }
    for (const k of keys) {
      const f = k + '-01', t = endOfMonth(f);
      const income = this.incomeBetween(f, t), expense = this.expenseBetween(f, t);
      out.push({ key: k, income, expense, net: income - expense });
    }
    return out;
  }
}
