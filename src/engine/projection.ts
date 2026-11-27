import { addDays, addMonths, diffDays, endOfMonth, fmtDate, type DStr } from './date';
import { fmt, sum } from './money';
import { pendingOccurrences } from './recurrence';
import type { Ledger } from './ledger';
import type { Change, Rule, VirtualOp } from './types';

export type ScenarioKind = 'optimiste' | 'realiste' | 'pessimiste';

export interface ProjEvent {
  date: DStr; free: number; balance: number; label: string;
  source: 'regle' | 'retard' | 'dette' | 'creance' | 'virtuel' | 'changement';
  ruleId?: string; opId?: string; kind?: string;
}
export interface ProjDay { date: DStr; balance: number; free: number; variable: number; events: ProjEvent[] }
export interface Projection {
  from: DStr; to: DStr; days: ProjDay[]; startBalance: number; startFree: number;
  min: { date: DStr; value: number; idx: number }; end: { balance: number; free: number };
  firstBelow?: DStr; firstNegative?: DStr; variableDaily: number; variableSource: string;
  threshold: number; events: ProjEvent[]; scenario: ScenarioKind;
}
export interface ProjOptions {
  days: number; scenario?: ScenarioKind; ops?: VirtualOp[]; changes?: Change[];
  includeVariable?: boolean; from?: DStr;
}

const VAR_MULT: Record<ScenarioKind, number> = { optimiste: 0.85, realiste: 1, pessimiste: 1.15 };

function certaintyOk(r: Rule, sc: ScenarioKind) {
  if (r.kind !== 'income' && r.kind !== 'loan_back') return true;
  if (sc === 'optimiste') return true;
  if (sc === 'realiste') return r.certainty !== 'incertaine';
  return r.certainty === 'certaine';
}

/** Mensualité d'un crédit amortissable (taux annuel en %). */
export function annuity(principal: number, ratePct: number, months: number): number {
  if (months <= 0) return principal;
  const r = ratePct / 100 / 12;
  if (!r) return Math.ceil(principal / months);
  return Math.ceil((principal * r) / (1 - Math.pow(1 + r, -months)));
}

/** Échéancier d'une opération virtuelle (achat simulé, remboursement, épargne...). */
export function expandOp(op: VirtualOp, L: Ledger): { date: DStr; free: number; balance: number; label: string }[] {
  const sign = op.direction === 'in' ? 1 : -1;
  const out: { date: DStr; free: number; balance: number; label: string }[] = [];
  const push = (date: DStr, v: number, label: string, freeV = v) => out.push({ date, free: sign * freeV, balance: sign * v, label });
  switch (op.mode) {
    case 'plusieurs': {
      const n = Math.max(1, op.installments ?? 3);
      const total = op.amount + (op.fees ?? 0);
      const each = Math.floor(total / n);
      for (let i = 0; i < n; i++) {
        const v = i === 0 ? total - each * (n - 1) : each;
        push(op.intervalDays ? addDays(op.date, i * op.intervalDays) : addMonths(op.date, i), v, `${op.label} (${i + 1}/${n})`);
      }
      break;
    }
    case 'credit': {
      const down = Math.min(op.downPayment ?? 0, op.amount);
      if (down > 0) push(op.date, down, `${op.label} (apport)`);
      const months = Math.max(1, op.months ?? 12);
      const m = annuity(op.amount - down + (op.fees ?? 0), op.rate ?? 0, months);
      for (let i = 1; i <= months; i++) push(addMonths(op.date, i), m, `${op.label} (mensualité ${i}/${months})`);
      break;
    }
    case 'epargne': {
      const g = L.s.goals.find((x) => x.id === op.goalId);
      const saved = g ? Math.max(0, L.conv(L.goalSaved(g), g.currency)) : 0;
      const used = Math.min(saved, op.amount);
      const onIlliquid = !!(g?.accountId && L.acc.get(g.accountId) && !L.acc.get(g.accountId)!.liquid);
      push(op.date, onIlliquid ? op.amount - used : op.amount, `${op.label} (dont ${fmt(used, L.main)} d'épargne)`, op.amount - used);
      break;
    }
    default:
      push(op.date, op.amount, op.label);
  }
  return out;
}

export function opTotalCost(op: VirtualOp): { total: number; monthly: number; count: number } {
  if (op.mode === 'plusieurs') { const n = Math.max(1, op.installments ?? 3); const t = op.amount + (op.fees ?? 0); return { total: t, monthly: Math.ceil(t / n), count: n }; }
  if (op.mode === 'credit') {
    const down = Math.min(op.downPayment ?? 0, op.amount); const months = Math.max(1, op.months ?? 12);
    const m = annuity(op.amount - down + (op.fees ?? 0), op.rate ?? 0, months);
    return { total: down + m * months, monthly: m, count: months };
  }
  return { total: op.amount, monthly: 0, count: 1 };
}

export function project(L: Ledger, o: ProjOptions): Projection {
  const sc = o.scenario ?? 'realiste';
  const from = o.from ?? L.ref;
  const n = Math.max(1, o.days);
  const to = addDays(from, n - 1);
  const ch = o.changes ?? [];
  const startBalance = L.liquidTotal();
  const startFree = startBalance - L.liquidAllocations();
  const events: ProjEvent[] = [];
  const payoff = ch.find((c) => c.type === 'payoff_debts') as Extract<Change, { type: 'payoff_debts' }> | undefined;
  const offs = ch.filter((c) => c.type === 'rule_off') as Extract<Change, { type: 'rule_off' }>[];
  const amounts = ch.filter((c) => c.type === 'rule_amount') as Extract<Change, { type: 'rule_amount' }>[];
  const debtIds = new Set(L.s.debts.filter((d) => d.direction === 'dette').map((d) => d.id));

  // 1. Occurrences planifiées des règles
  // Une dette soldée ne génère plus de remboursements, même si l'échéancier continue.
  const debtLeft = new Map(L.s.debts.map((d) => [d.id, L.conv(L.debtRemaining(d), d.currency)]));
  for (const p of pendingOccurrences(L.activeRules(), L.s.occurrences, from, to, 120, L.ref)) {
    const r = p.rule;
    if (!certaintyOk(r, sc)) continue;
    const date = p.date < from ? from : p.date;
    if (offs.some((c) => c.ruleId === r.id && p.date >= c.from)) continue;
    if (payoff && r.debtId && debtIds.has(r.debtId) && p.date >= payoff.from) continue;
    let remaining = p.remaining;
    const am = amounts.find((c) => c.ruleId === r.id && p.date >= c.from);
    if (am) remaining = Math.max(0, am.amount - (r.amount - p.remaining));
    let v = L.conv(remaining, L.accCur(r.accountId));
    if ((r.kind === 'debt_repay' || r.kind === 'loan_back') && r.debtId && debtLeft.has(r.debtId)) {
      const left = debtLeft.get(r.debtId)!;
      v = Math.min(v, left);
      debtLeft.set(r.debtId, left - v);
    }
    if (!v) continue;
    const liqFrom = L.isLiquidPersonal(r.accountId);
    let free = 0, bal = 0;
    if (r.kind === 'income' || r.kind === 'loan_back') { if (liqFrom) { free = v; bal = v; } }
    else if (r.kind === 'expense' || r.kind === 'debt_repay') { if (liqFrom) { free = -v; bal = -v; } }
    else if (r.kind === 'saving') {
      const g = L.s.goals.find((x) => x.id === r.goalId);
      const illiquid = !!(g?.accountId && L.acc.get(g.accountId) && !L.acc.get(g.accountId)!.liquid);
      if (liqFrom) { free = -v; bal = illiquid ? -v : 0; }
    } else if (r.kind === 'transfer') {
      const liqTo = L.isLiquidPersonal(r.toAccountId);
      if (liqFrom && !liqTo) { free = -v; bal = -v; } else if (!liqFrom && liqTo) { free = v; bal = v; }
    }
    if (!free && !bal) continue;
    events.push({ date, free, balance: bal, label: p.overdue ? `${r.label} (en retard du ${fmtDate(p.date)})` : r.label, source: p.overdue ? 'retard' : 'regle', ruleId: r.id, kind: r.kind });
  }

  // 2. Dettes / créances à échéance sans échéancier
  const ruled = new Set(L.activeRules().map((r) => r.debtId).filter(Boolean));
  for (const d of L.s.debts) {
    if (d.archived || ruled.has(d.id) || !d.dueDate) continue;
    const rem = L.debtRemaining(d);
    if (rem <= 0 || d.dueDate > to) continue;
    const date = d.dueDate < from ? from : d.dueDate;
    const v = L.conv(rem, d.currency);
    if (d.direction === 'dette') {
      if (payoff && date >= payoff.from) continue;
      events.push({ date, free: -v, balance: -v, label: `Échéance dette : ${d.person}`, source: 'dette' });
      if (debtLeft.has(d.id)) debtLeft.set(d.id, Math.max(0, debtLeft.get(d.id)! - v));
    } else if (sc === 'optimiste') {
      events.push({ date, free: v, balance: v, label: `Remboursement attendu : ${d.person}`, source: 'creance' });
    }
  }

  // 3. Changements de situation
  for (const c of ch) {
    if (c.type === 'income_delta' || c.type === 'expense_add' || c.type === 'saving_add') {
      for (let k = 0; k < 120; k++) {
        const d = addMonths(c.from, k);
        if (d > to) break;
        if (d < from) continue;
        const v = c.type === 'income_delta' ? c.amount : -Math.abs(c.amount);
        events.push({ date: d, free: v, balance: c.type === 'saving_add' ? 0 : v, label: c.label, source: 'changement' });
      }
    }
    if (c.type === 'payoff_debts' && c.from <= to) {
      // Reste après les mensualités déjà placées avant cette date : sinon elles seraient comptées deux fois.
      const tot = sum(L.s.debts.filter((d) => d.direction === 'dette' && !d.archived).map((d) => Math.max(0, debtLeft.get(d.id) ?? 0)));
      if (tot > 0) events.push({ date: c.from < from ? from : c.from, free: -tot, balance: -tot, label: 'Remboursement de toutes les dettes', source: 'changement' });
    }
  }

  // 4. Opérations virtuelles (simulations) : jamais écrites dans les comptes réels
  for (const op of o.ops ?? []) {
    for (const e of expandOp(op, L)) {
      if (e.date > to) continue;
      events.push({ date: e.date < from ? from : e.date, free: e.free, balance: e.balance, label: e.label, source: 'virtuel', opId: op.id });
    }
  }

  // 5. Dépenses variables estimées
  const vd = o.includeVariable === false ? { value: 0, source: 'exclues' } : L.variableDaily();
  const pct = (ch.find((c) => c.type === 'variable_pct') as Extract<Change, { type: 'variable_pct' }> | undefined)?.pct ?? 0;
  const varDaily = Math.round(vd.value * VAR_MULT[sc] * (1 + pct / 100));

  // Construction jour par jour
  const byDay = new Map<string, ProjEvent[]>();
  for (const e of events) { const a = byDay.get(e.date); if (a) a.push(e); else byDay.set(e.date, [e]); }
  const days: ProjDay[] = [];
  let bal = startBalance, free = startFree;
  let min = { date: from, value: Infinity, idx: 0 };
  let firstBelow: DStr | undefined, firstNegative: DStr | undefined;
  const S = L.s.settings.safetyThreshold;
  for (let i = 0; i < n; i++) {
    const d = addDays(from, i);
    const ev = byDay.get(d) ?? [];
    const variable = i === 0 ? 0 : varDaily;
    for (const e of ev) { bal += e.balance; free += e.free; }
    bal -= variable; free -= variable;
    days.push({ date: d, balance: bal, free, variable, events: ev });
    if (free < min.value) min = { date: d, value: free, idx: i };
    if (!firstBelow && free < S) firstBelow = d;
    if (!firstNegative && bal < 0) firstNegative = d;
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    from, to, days, startBalance, startFree, min, end: { balance: bal, free }, firstBelow, firstNegative,
    variableDaily: varDaily, variableSource: vd.source, threshold: S, events, scenario: sc,
  };
}

// ---------------------------------------------------------------- Simulations

export interface Effect { idx: number; v: number }

/** Minimum de base[i] + Σ effets cumulés (un effet à idx s'applique de idx jusqu'à la fin). */
export function minWith(base: number[], effects: Effect[], shift = 0): { value: number; idx: number } {
  const eff = effects.map((e) => ({ idx: e.idx + shift, v: e.v })).filter((e) => e.idx < base.length).sort((a, b) => a.idx - b.idx);
  let cum = 0, j = 0, best = Infinity, bi = 0;
  for (let i = 0; i < base.length; i++) {
    while (j < eff.length && eff[j].idx <= i) { cum += eff[j].v; j++; }
    const v = base[i] + cum;
    if (v < best) { best = v; bi = i; }
  }
  return { value: best, idx: bi };
}
export function applyEffects(base: number[], effects: Effect[], shift = 0): number[] {
  const out = base.slice();
  for (const e of effects) for (let i = Math.max(0, e.idx + shift); i < out.length; i++) out[i] += e.v;
  return out;
}
export function opToEffects(op: VirtualOp, L: Ledger, from: DStr): Effect[] {
  return expandOp(op, L).map((e) => ({ idx: Math.max(0, diffDays(e.date, from)), v: e.free }));
}

export type Level = 'ok' | 'tendu' | 'risque';
export function thresholds(L: Ledger) {
  const S = L.s.settings.safetyThreshold;
  const E = L.essentialMonthly().total;
  return { S, tight: S + Math.max(Math.round(E * 0.5), Math.round(S * 0.5)), E };
}
export function levelOf(min: number, L: Ledger): Level {
  const { S, tight } = thresholds(L);
  if (min < S) return 'risque';
  if (min < tight) return 'tendu';
  return 'ok';
}

/** Plus petit décalage (en jours) rendant l'opération acceptable au niveau demandé. */
export function earliestSafeShift(base: number[], effects: Effect[], target: number, maxShift: number, startShift = 0): number | null {
  for (let s = startShift; s <= maxShift; s++) {
    if (minWith(base, effects, s).value >= target) return s;
  }
  return null;
}

export interface PurchaseResult {
  base: Projection; withOp: Projection; level: Level; reasons: string[]; advice: string[];
  suggestion?: { date: DStr; level: Level } | null; cost: { total: number; monthly: number; count: number };
  schedule: { date: DStr; free: number; balance: number; label: string }[];
  table: { label: string; value: number }[];
}

export function simulatePurchase(L: Ledger, op: VirtualOp, horizonDays = 0): PurchaseResult {
  const cost = opTotalCost(op);
  const span = Math.max(diffDays(op.date, L.ref), 0);
  const tail = op.mode === 'credit' ? (op.months ?? 12) * 31 : op.mode === 'plusieurs' ? (op.installments ?? 3) * 31 : 0;
  const days = Math.max(horizonDays, span + tail + 75, 120);
  const base = project(L, { days });
  const withOp = project(L, { days, ops: [op] });
  const { S, tight, E } = thresholds(L);
  const level = levelOf(withOp.min.value, L);
  const reasons: string[] = [];
  const advice: string[] = [];
  const mn = withOp.min;
  reasons.push(`Point le plus bas du solde disponible : ${fmt(mn.value, L.main)} le ${fmtDate(mn.date, 'long')} (seuil de sécurité ${fmt(S, L.main)}).`);
  if (withOp.firstNegative) reasons.push(`Découvert prévu à partir du ${fmtDate(withOp.firstNegative, 'long')}.`);
  if (level === 'risque') {
    reasons.push('Le solde prévisionnel passe sous le seuil de sécurité que tu as défini.');
    const after = withOp.events.filter((e) => e.date >= (withOp.firstBelow ?? mn.date) && e.source === 'regle' && e.free < 0).slice(0, 3);
    const ess = after.filter((e) => { const r = L.s.rules.find((x) => x.id === e.ruleId); const c = L.s.categories.find((x) => x.id === r?.categoryId); return r?.essential || c?.essential; });
    if (ess.length) reasons.push(`Dépenses obligatoires menacées : ${ess.map((e) => `${e.label} (${fmtDate(e.date)})`).join(', ')}.`);
  } else if (level === 'tendu') {
    reasons.push(`La marge restante est faible : il est conseillé de garder au moins ${fmt(tight, L.main)} (seuil + 50 % des dépenses essentielles mensuelles).`);
  } else {
    reasons.push('Les obligations prévues restent couvertes avec une marge confortable.');
  }
  if (base.min.value < S) advice.push(`Attention : même sans cet achat, ton solde passe déjà sous le seuil le ${fmtDate(base.min.date)}.`);
  // Endettement mensuel
  const income = L.resteAVivre().totalIncome;
  const debtMonthly = sum(L.activeRules().filter((r) => r.kind === 'debt_repay' && L.personalRule(r)).map((r) => L.ruleMonthly(r)));
  if ((op.mode === 'plusieurs' || op.mode === 'credit') && income > 0) {
    const ratio = (debtMonthly + cost.monthly) / income;
    if (ratio > 0.33) reasons.push(`Taux d'effort de remboursement : ${(ratio * 100).toFixed(0)} % des revenus certains (au-delà de 33 %, risque d'accumulation de mensualités).`);
    const count = L.activeRules().filter((r) => r.kind === 'debt_repay').length + 1;
    if (count >= 3) reasons.push(`Tu aurais ${count} remboursements récurrents simultanés.`);
  }
  if (op.mode === 'epargne') {
    const g = L.s.goals.find((x) => x.id === op.goalId);
    if (g?.isEmergency) advice.push("Tu puises dans le fonds d'urgence : il faudra le reconstituer.");
  }
  if (cost.total > op.amount) advice.push(`Coût total : ${fmt(cost.total, L.main)}, soit ${fmt(cost.total - op.amount, L.main)} de plus que le prix comptant.`);
  // Suggestion de date
  let suggestion: PurchaseResult['suggestion'] = null;
  if (level !== 'ok') {
    const ext = project(L, { days: days + 365 });
    const baseFree = ext.days.map((d) => d.free);
    const eff = opToEffects(op, L, L.ref);
    const startShift = 0;
    const maxShift = 365;
    const sOk = earliestSafeShift(baseFree, eff, tight, maxShift, startShift);
    const sMin = earliestSafeShift(baseFree, eff, S, maxShift, startShift);
    const shift = sOk ?? sMin;
    if (shift != null) {
      const date = addDays(op.date, shift);
      suggestion = { date, level: sOk != null ? 'ok' : 'tendu' };
      if (shift > 0) advice.unshift(`Date d'achat conseillée : à partir du ${fmtDate(date, 'long')}${sOk == null ? ' (marge encore faible)' : ''}.`);
    } else advice.unshift("Aucune date sûre trouvée dans les 12 prochains mois avec ce mode de paiement : réduis le montant, étale le paiement ou épargne d'abord.");
  }
  if (E === 0) advice.push("Astuce : marque tes charges essentielles (loyer, énergie...) pour affiner le verdict.");
  const atDate = withOp.days.find((d) => d.date === op.date) ?? withOp.days[0];
  const table = [
    { label: 'Solde disponible actuel', value: base.startFree },
    { label: 'Revenus attendus jusqu\'à l\'achat', value: sum(base.events.filter((e) => e.date <= op.date && e.free > 0).map((e) => e.free)) },
    { label: 'Charges et remboursements jusqu\'à l\'achat', value: sum(base.events.filter((e) => e.date <= op.date && e.free < 0).map((e) => e.free)) - sum(base.days.filter((d) => d.date <= op.date).map((d) => d.variable)) },
    { label: 'Prix de l\'achat', value: -op.amount },
    { label: 'Solde disponible après achat', value: atDate.free },
    { label: 'Point bas sur la période', value: withOp.min.value },
  ];
  return { base, withOp, level, reasons, advice, suggestion, cost, schedule: expandOp(op, L), table };
}

/** Capacité d'achat : montant maximal dépensable à chaque date sans franchir le seuil. */
export function capacity(L: Ledger, days = 365) {
  const p = project(L, { days: days + 90 });
  const { S, tight } = thresholds(L);
  const free = p.days.map((d) => d.free);
  const suffix = new Array(free.length);
  let m = Infinity;
  for (let i = free.length - 1; i >= 0; i--) { m = Math.min(m, free[i]); suffix[i] = m; }
  let prefOk = true;
  const series: { date: DStr; max: number; reasonable: number; blocked: boolean }[] = [];
  for (let i = 0; i < days; i++) {
    const blocked = !prefOk;
    series.push({ date: p.days[i].date, max: Math.max(0, suffix[i] - S), reasonable: Math.max(0, suffix[i] - tight), blocked });
    if (free[i] < S) prefOk = false;
  }
  return { projection: p, series, S, tight, reserve: tight };
}
export function dateForAmount(cap: ReturnType<typeof capacity>, amount: number, reasonable = true): DStr | null {
  const f = cap.series.find((x) => (reasonable ? x.reasonable : x.max) >= amount);
  return f ? f.date : null;
}

/** Comparaison de modes de paiement pour un même achat. */
export function compareModes(L: Ledger, base: Omit<VirtualOp, 'mode' | 'installments' | 'fees'>, variants: { label: string; mode: VirtualOp['mode']; installments?: number; fees?: number; rate?: number; months?: number; downPayment?: number }[]) {
  const days = 400;
  const p = project(L, { days });
  const free = p.days.map((d) => d.free);
  return variants.map((v) => {
    const op: VirtualOp = { ...base, ...v } as VirtualOp;
    const eff = opToEffects(op, L, L.ref);
    const mn = minWith(free, eff);
    return { ...v, op, cost: opTotalCost(op), min: mn.value, minDate: p.days[mn.idx]?.date, level: levelOf(mn.value, L) };
  });
}

/** Fin de mois selon 3 scénarios. */
export function endOfMonthScenarios(L: Ledger, target?: DStr) {
  const end = target ?? endOfMonth(L.ref);
  const days = Math.max(1, diffDays(end, L.ref) + 1);
  return (['optimiste', 'realiste', 'pessimiste'] as ScenarioKind[]).map((sc) => {
    const p = project(L, { days, scenario: sc });
    return { scenario: sc, end: p.end, min: p.min, projection: p, level: levelOf(p.min.value, L) };
  });
}

/** Centre de décision : place chaque opération au plus tôt sans franchir le seuil, par ordre de priorité. */
export function optimizeDecisions(L: Ledger, ops: VirtualOp[], prudent = true) {
  const horizon = 540;
  const p = project(L, { days: horizon + 60 });
  let free = p.days.map((d) => d.free);
  const { S, tight } = thresholds(L);
  const target = prudent ? tight : S;
  const order = ops.map((o, i) => ({ o, i })).sort((a, b) => (a.o.priority ?? 2) - (b.o.priority ?? 2) || a.i - b.i);
  const placed: { op: VirtualOp; date: DStr | null; shiftDays: number; level: Level | null }[] = [];
  for (const { o } of order) {
    const want = o.earliest ?? o.date;
    const earliest = want && want > L.ref ? want : L.ref;
    const probe = { ...o, date: earliest };
    const eff = opToEffects(probe, L, L.ref);
    const maxShift = o.latest ? Math.max(0, diffDays(o.latest, earliest)) : horizon;
    let s = earliestSafeShift(free, eff, target, maxShift);
    let lvl: Level | null = s != null ? (prudent ? 'ok' : 'tendu') : null;
    if (s == null && prudent) { s = earliestSafeShift(free, eff, S, maxShift); lvl = s != null ? 'tendu' : null; }
    if (s == null) { placed.push({ op: o, date: null, shiftDays: 0, level: null }); continue; }
    free = applyEffects(free, eff, s);
    placed.push({ op: { ...o, date: addDays(earliest, s) }, date: addDays(earliest, s), shiftDays: s, level: lvl });
  }
  return { placed: ops.map((o) => placed.find((x) => x.op.id === o.id)!), finalMin: Math.min(...free.slice(0, horizon)), target };
}
