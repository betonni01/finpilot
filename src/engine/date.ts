// Dates manipulées au format 'YYYY-MM-DD' (jour local), calculs en UTC pour éviter les effets d'heure d'été.
export type DStr = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toD(d: Date): DStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function today(): DStr {
  return toD(new Date());
}
export function parts(s: DStr) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
export function toUTC(s: DStr): number {
  const { y, m, d } = parts(s);
  return Date.UTC(y, m - 1, d);
}
export function fromUTC(t: number): DStr {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const addDays = (s: DStr, n: number): DStr => fromUTC(toUTC(s) + n * 86400000);
/** a - b en jours */
export const diffDays = (a: DStr, b: DStr): number => Math.round((toUTC(a) - toUTC(b)) / 86400000);
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** Ajoute n mois en conservant le jour d'origine (borné à la fin du mois). */
export function addMonths(s: DStr, n: number, day?: number): DStr {
  const { y, m, d } = parts(s);
  const dd = day ?? d;
  let mm = m - 1 + n;
  const yy = y + Math.floor(mm / 12);
  mm = ((mm % 12) + 12) % 12;
  const dim = daysInMonth(yy, mm + 1);
  return `${yy}-${pad(mm + 1)}-${pad(Math.min(dd, dim))}`;
}
export const startOfMonth = (s: DStr): DStr => s.slice(0, 8) + '01';
export function endOfMonth(s: DStr): DStr {
  const { y, m } = parts(s);
  return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
}
export const monthKey = (s: DStr) => s.slice(0, 7);
export const minD = (a: DStr, b: DStr) => (a < b ? a : b);
export const maxD = (a: DStr, b: DStr) => (a > b ? a : b);
/** 0 = lundi ... 6 = dimanche */
export function weekday(s: DStr): number {
  return (new Date(toUTC(s)).getUTCDay() + 6) % 7;
}
export function startOfWeek(s: DStr): DStr {
  return addDays(s, -weekday(s));
}

export const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];
export const DAYS_FR = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

export function fmtDate(s: DStr | undefined | null, style: 'short' | 'long' | 'day' | 'month' = 'short'): string {
  if (!s) return '';
  const d = new Date(toUTC(s));
  const o: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : style === 'day'
        ? { weekday: 'short', day: 'numeric', month: 'short' }
        : style === 'month'
          ? { month: 'long', year: 'numeric' }
          : { day: '2-digit', month: '2-digit', year: 'numeric' };
  return d.toLocaleDateString('fr-FR', { timeZone: 'UTC', ...o });
}
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_FR[m - 1]} ${y}`;
}
export function monthsBetween(a: DStr, b: DStr): number {
  const pa = parts(a), pb = parts(b);
  return (pb.y - pa.y) * 12 + (pb.m - pa.m);
}
