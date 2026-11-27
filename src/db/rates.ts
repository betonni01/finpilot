import { db, nowIso } from './db';
import { save } from './repo';
import type { RateRow } from '../engine/money';

/** Parités fixes avec l'euro (francs CFA). */
export const PEGS: Record<string, number> = { XOF: 655.957, XAF: 655.957 };
export const RATES_API = 'https://api.frankfurter.dev/v2/rates';

/** Devises utilisées quelque part dans les données. */
export async function usedCurrencies(): Promise<string[]> {
  const set = new Set<string>();
  for (const a of await db.accounts.toArray()) set.add(a.currency);
  for (const d of await db.debts.toArray()) set.add(d.currency);
  for (const g of await db.goals.toArray()) set.add(g.currency);
  for (const p of await db.projects.toArray()) set.add(p.currency);
  for (const c of await db.cotisations.toArray()) set.add(c.currency);
  for (const r of await db.rates.toArray()) set.add(r.currency);
  return [...set];
}

/**
 * Valeur d'une unité de chaque devise dans la devise principale.
 * Les taux viennent de Frankfurter (banques centrales, dont la BCE) ; les francs CFA utilisent la parité fixe.
 */
export async function fetchRates(main: string, currencies: string[], fetcher: typeof fetch = fetch): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const targets = currencies.filter((c) => c !== main);
  // tout passe par l'euro pour rester cohérent avec les parités fixes
  const needEur = [...new Set([...targets, main].filter((c) => c !== 'EUR' && !PEGS[c]))];
  const eurTo: Record<string, number> = { EUR: 1, ...PEGS }; // 1 EUR = x devise
  if (needEur.length) {
    const res = await fetcher(`${RATES_API}?base=EUR&quotes=${needEur.join(',')}`);
    if (!res.ok) throw new Error(`Service de taux indisponible (${res.status})`);
    const rows = (await res.json()) as { quote: string; rate: number }[];
    for (const r of rows) if (r && typeof r.rate === 'number' && r.rate > 0) eurTo[r.quote.toUpperCase()] = r.rate;
  }
  if (!eurTo[main]) throw new Error(`Taux introuvable pour ${main}`);
  for (const c of targets) {
    if (!eurTo[c]) continue;
    out[c] = eurTo[main] / eurTo[c]; // 1 c = (EUR→main)/(EUR→c) main
  }
  return out;
}

export async function refreshRates(force = false): Promise<{ updated: string[]; skipped?: string }> {
  const s = await db.settings.get('main');
  if (!s) return { updated: [] };
  const rows = await db.rates.toArray();
  const last = rows.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), '');
  if (!force && last && Date.now() - Date.parse(last) < 12 * 3600_000) return { updated: [], skipped: 'récent' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { updated: [], skipped: 'hors ligne' };
  const rates = await fetchRates(s.mainCurrency, await usedCurrencies());
  const at = nowIso();
  const updated: string[] = [];
  for (const [currency, rate] of Object.entries(rates)) {
    const prev = rows.find((r) => r.currency === currency);
    if (prev && Math.abs(prev.rate - rate) / prev.rate < 1e-9) {
      await save('rates', { ...prev, id: currency, updatedAt: at } as RateRow & { id: string }, `Taux ${currency} confirmé`);
      continue;
    }
    const history = [...(prev?.history ?? []), ...(prev ? [{ date: prev.updatedAt.slice(0, 10), rate: prev.rate }] : [])].slice(-120);
    await save('rates', { id: currency, currency, rate, updatedAt: at, history } as RateRow & { id: string }, `Taux ${currency} mis à jour automatiquement`);
    updated.push(currency);
  }
  return { updated };
}
