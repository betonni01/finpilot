export interface DebtInput { id: string; name: string; balance: number; rate: number; min: number }
export interface PayoffResult {
  method: 'boule_de_neige' | 'avalanche'; months: number; totalInterest: number; totalPaid: number;
  order: { id: string; name: string; month: number }[]; feasible: boolean;
  timeline: { month: number; remaining: number }[];
}

/**
 * Simule un remboursement mensuel avec un budget constant.
 * Boule de neige : plus petit solde d'abord. Avalanche : taux le plus élevé d'abord.
 */
export function payoffPlan(debts: DebtInput[], monthlyBudget: number, method: PayoffResult['method']): PayoffResult {
  const ds = debts.filter((d) => d.balance > 0).map((d) => ({ ...d }));
  const order: PayoffResult['order'] = [];
  const timeline: PayoffResult['timeline'] = [{ month: 0, remaining: ds.reduce((a, d) => a + d.balance, 0) }];
  let totalInterest = 0, totalPaid = 0, month = 0;
  const pick = () => {
    const open = ds.filter((d) => d.balance > 0);
    if (method === 'boule_de_neige') open.sort((a, b) => a.balance - b.balance || b.rate - a.rate);
    else open.sort((a, b) => b.rate - a.rate || a.balance - b.balance);
    return open;
  };
  while (ds.some((d) => d.balance > 0) && month < 600) {
    month++;
    let budget = monthlyBudget;
    for (const d of ds) {
      if (d.balance <= 0) continue;
      const i = Math.round(d.balance * (d.rate / 100 / 12));
      d.balance += i; totalInterest += i;
    }
    // minimums
    for (const d of ds) {
      if (d.balance <= 0) continue;
      const p = Math.min(d.min, d.balance, budget);
      d.balance -= p; budget -= p; totalPaid += p;
    }
    // surplus vers la cible prioritaire
    for (const d of pick()) {
      if (budget <= 0) break;
      const p = Math.min(d.balance, budget);
      d.balance -= p; budget -= p; totalPaid += p;
    }
    for (const d of ds) if (d.balance <= 0 && !order.find((o) => o.id === d.id)) order.push({ id: d.id, name: d.name, month });
    timeline.push({ month, remaining: ds.reduce((a, d) => a + Math.max(0, d.balance), 0) });
    if (budget === monthlyBudget && monthlyBudget <= 0) break;
  }
  const feasible = ds.every((d) => d.balance <= 0);
  return { method, months: month, totalInterest, totalPaid, order, feasible, timeline };
}

export function monthsToGoal(remaining: number, monthly: number): number | null {
  if (remaining <= 0) return 0;
  if (monthly <= 0) return null;
  return Math.ceil(remaining / monthly);
}
export function requiredMonthly(remaining: number, months: number): number {
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / Math.max(1, months));
}
