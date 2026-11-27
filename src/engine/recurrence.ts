import { addDays, addMonths, diffDays, parts, today, type DStr } from './date';
import type { Freq, Occurrence, Rule } from './types';

/** Dates planifiées d'une règle dans [from, to] (bornes incluses). */
export function occurrenceDates(rule: Pick<Rule, 'freq' | 'interval' | 'startDate' | 'endDate'>, from: DStr, to: DStr): DStr[] {
  const out: DStr[] = [];
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
  if (rule.startDate > end) return out;
  const iv = Math.max(1, rule.interval || 1);
  if (rule.freq === 'once') {
    if (rule.startDate >= from && rule.startDate <= end) out.push(rule.startDate);
    return out;
  }
  if (rule.freq === 'daily' || rule.freq === 'weekly') {
    const step = (rule.freq === 'daily' ? 1 : 7) * iv;
    let k = 0;
    if (from > rule.startDate) k = Math.floor(diffDays(from, rule.startDate) / step);
    for (let guard = 0; guard < 5000; guard++, k++) {
      const d = addDays(rule.startDate, k * step);
      if (d > end) break;
      if (d >= from) out.push(d);
    }
    return out;
  }
  const mStep = (rule.freq === 'monthly' ? 1 : rule.freq === 'quarterly' ? 3 : 12) * iv;
  const day = parts(rule.startDate).d;
  let k = 0;
  if (from > rule.startDate) {
    const pf = parts(from), ps = parts(rule.startDate);
    const months = (pf.y - ps.y) * 12 + (pf.m - ps.m);
    k = Math.max(0, Math.floor(months / mStep) - 1);
  }
  for (let guard = 0; guard < 2000; guard++, k++) {
    const d = addMonths(rule.startDate, k * mStep, day);
    if (d > end) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** Facteur de normalisation mensuelle d'une fréquence. */
export function monthlyFactor(freq: Freq, interval = 1): number {
  const iv = Math.max(1, interval || 1);
  switch (freq) {
    case 'daily': return 30.4375 / iv;
    case 'weekly': return 4.348 / iv;
    case 'monthly': return 1 / iv;
    case 'quarterly': return 1 / (3 * iv);
    case 'yearly': return 1 / (12 * iv);
    default: return 0;
  }
}

export const occId = (ruleId: string, date: DStr) => `${ruleId}|${date}`;

export interface PendingOcc {
  rule: Rule; date: DStr; remaining: number; overdue: boolean; occ?: Occurrence;
  status: 'planifiee' | 'due' | 'en_retard' | 'partielle';
}

/** Occurrences non soldées (planifiées, dues, en retard ou partielles) entre from et to. Les retards sont cherchés jusqu'à `lookback` jours en arrière. */
export function pendingOccurrences(rules: Rule[], occs: Occurrence[], from: DStr, to: DStr, lookback = 120, ref = today()): PendingOcc[] {
  const map = new Map(occs.map((o) => [o.id, o]));
  const out: PendingOcc[] = [];
  const start = addDays(from, -lookback);
  for (const r of rules) {
    if (!r.active) continue;
    const rStart = r.createdAt ? r.createdAt.slice(0, 10) : r.startDate;
    for (const d of occurrenceDates(r, start, to)) {
      const o = map.get(occId(r.id, d));
      if (o && (o.status === 'paid' || o.status === 'cancelled')) continue;
      const remaining = r.amount - (o?.paidAmount ?? 0);
      if (remaining <= 0) continue;
      const overdue = d < ref;
      // On ne remonte pas les retards antérieurs à la création de la règle (historique déjà réglé).
      if (overdue && d < rStart) continue;
      if (d < from && !overdue) continue;
      const status: PendingOcc['status'] = o?.status === 'partial' ? 'partielle' : overdue ? 'en_retard' : d === ref ? 'due' : 'planifiee';
      out.push({ rule: r, date: d, remaining, overdue, occ: o, status });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
