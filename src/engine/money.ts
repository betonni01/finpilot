// Tous les montants sont stockés en ENTIERS d'unités mineures (centimes pour EUR, francs pour XOF).
export interface CurrencyInfo { dec: number; name: string }

export const CURRENCIES: Record<string, CurrencyInfo> = {
  EUR: { dec: 2, name: 'Euro' },
  XOF: { dec: 0, name: 'Franc CFA (BCEAO)' },
  XAF: { dec: 0, name: 'Franc CFA (BEAC)' },
  USD: { dec: 2, name: 'Dollar américain' },
  GBP: { dec: 2, name: 'Livre sterling' },
  CHF: { dec: 2, name: 'Franc suisse' },
  CAD: { dec: 2, name: 'Dollar canadien' },
  NGN: { dec: 2, name: 'Naira' },
  GHS: { dec: 2, name: 'Cedi' },
  MAD: { dec: 2, name: 'Dirham marocain' },
  CNY: { dec: 2, name: 'Yuan' },
};

export const dec = (cur: string) => CURRENCIES[cur]?.dec ?? 2;
export const factor = (cur: string) => 10 ** dec(cur);
export const toMinor = (major: number, cur: string) => Math.round(major * factor(cur));
export const toMajor = (minor: number, cur: string) => minor / factor(cur);

const fmtCache = new Map<string, Intl.NumberFormat>();
export function fmt(minor: number, cur: string, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const key = cur + (opts.compact ? 'c' : '');
  let f = fmtCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat('fr-FR', {
        style: 'currency', currency: cur,
        minimumFractionDigits: opts.compact ? 0 : dec(cur),
        maximumFractionDigits: opts.compact ? 0 : dec(cur),
      });
    } catch {
      f = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec(cur), maximumFractionDigits: dec(cur) });
    }
    fmtCache.set(key, f);
  }
  const s = f.format(toMajor(minor, cur));
  return opts.sign && minor > 0 ? '+' + s : s;
}

/** "1 234,56" | "1234.56" | "2k" -> nombre (unités majeures) ou NaN */
export function parseAmount(input: string): number {
  if (input == null) return NaN;
  let s = String(input).trim().toLowerCase().replace(/[€$\s  ]|eur(os?)?|fcfa|cfa|xof|f\b/g, '');
  let mult = 1;
  if (s.endsWith('k')) { mult = 1000; s = s.slice(0, -1); }
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n * mult : NaN;
}

export interface RateRow { currency: string; rate: number; updatedAt: string; history?: { date: string; rate: number }[] }

/** taux = valeur d'1 unité de `currency` exprimée dans la devise principale */
export function rateOf(cur: string, main: string, rates: RateRow[], date?: string): number {
  if (cur === main) return 1;
  const r = rates.find((x) => x.currency === cur);
  if (!r) return NaN;
  if (date && r.history?.length) {
    // chaque entrée est le taux en vigueur à partir de sa date ; le taux courant vaut depuis updatedAt
    const all = [...r.history, { date: (r.updatedAt || '').slice(0, 10), rate: r.rate }].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const h = all.filter((x) => x.date <= date).pop() ?? all[0];
    if (h) return h.rate;
  }
  return r.rate;
}

export function convert(minor: number, from: string, to: string, main: string, rates: RateRow[], date?: string): number {
  if (from === to || !minor) return minor;
  const rf = rateOf(from, main, rates, date);
  const rt = rateOf(to, main, rates, date);
  if (!Number.isFinite(rf) || !Number.isFinite(rt) || rt === 0) return 0;
  return Math.round(((minor / factor(from)) * rf / rt) * factor(to));
}

export const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
