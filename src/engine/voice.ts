/**
 * Compréhension des commandes vocales en français (moteur de règles, sans service externe).
 * Le texte vient de la reconnaissance vocale ; le résultat est une intention que l'interface fait confirmer.
 */
import { addDays, daysInMonth, MONTHS_FR, parts, type DStr } from './date';
import { toMinor } from './money';
import type { Account, Category, Debt } from './types';

export type VoiceIntent =
  | { type: 'tx'; kind: 'expense' | 'income'; amount: number; currency: string; categoryId?: string; accountId?: string; date: DStr; label: string; payee?: string; method?: string }
  | { type: 'debt'; action: 'repay' | 'received' | 'lend' | 'borrow'; amount: number; currency: string; debtId?: string; person: string; date: DStr; accountId?: string }
  | { type: 'transfer'; amount: number; currency: string; fromId?: string; toId?: string; date: DStr; label: string }
  | { type: 'nav'; to: string; label: string }
  | { type: 'simulate'; label: string; amount: number; currency: string; installments?: number }
  | { type: 'question'; text: string }
  | { type: 'incomplete'; text: string; missing: string };

export interface VoiceContext { accounts: Pick<Account, 'id' | 'name' | 'type' | 'currency' | 'archived' | 'projectId' | 'liquid'>[]; categories: Pick<Category, 'id' | 'name' | 'kind'>[]; debts: Pick<Debt, 'id' | 'person' | 'direction' | 'archived'>[]; main: string; ref: DStr }

export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ nombres dits en toutes lettres
const UNITS: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
  treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, septante: 70, octante: 80, huitante: 80, nonante: 90,
};
const SCALE: Record<string, number> = { cent: 100, cents: 100, mille: 1000, mil: 1000, million: 1e6, millions: 1e6 };
const CURRENCY_WORDS = /^(euros?|eur|€|balles|francs?|fcfa|cfa|dollars?|\$|k)$/;
const isNumWord = (w: string) => w in UNITS || w in SCALE;

function wordsValue(words: string[]): number {
  let total = 0, cur = 0, prev = '';
  for (const w of words) {
    if (w === 'et') continue;
    if (w in UNITS) {
      const v = UNITS[w];
      // « quatre-vingt(s) » = 80 ; « soixante-dix » = 60 + 10 se fait par simple addition
      if ((w === 'vingt' || w === 'vingts') && prev === 'quatre') cur = cur - 4 + 80;
      else cur += v;
    } else if (w === 'cent' || w === 'cents') cur = (cur || 1) * 100;
    else if (w in SCALE) { total += (cur || 1) * SCALE[w]; cur = 0; }
    prev = w;
  }
  return total + cur;
}

/** Remplace les nombres écrits en lettres par des chiffres ("douze euros cinquante" → "12 euros 50"). */
export function digitize(text: string): string {
  const toks = norm(text).replace(/-/g, ' ').split(' ');
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (isNumWord(t)) {
      // « un / une » est un article sauf s'il est suivi d'un nombre, d'une devise ou de « mille »
      if ((t === 'un' || t === 'une') && !(isNumWord(toks[i + 1] ?? '') || CURRENCY_WORDS.test(toks[i + 1] ?? ''))) { out.push(t); continue; }
      const seq: string[] = [];
      let j = i;
      while (j < toks.length && (isNumWord(toks[j]) || (toks[j] === 'et' && isNumWord(toks[j + 1] ?? '')))) { seq.push(toks[j]); j++; }
      out.push(String(wordsValue(seq)));
      i = j - 1;
    } else out.push(t);
  }
  return out.join(' ')
    .replace(/(\d+) virgule (\d+)/g, '$1.$2')
    .replace(/(\d+) mille/g, (_, a) => String(Number(a) * 1000))
    .replace(/(\d+)\s?k\b/g, (_, a) => String(Number(a) * 1000));
}

/** Montant et devise dans une phrase déjà normalisée/numérisée. */
export function extractAmount(t: string, main: string): { value: number; currency: string } | null {
  const s = t.replace(/(\d)\s(\d{3})\b/g, '$1$2');
  let m = s.match(/(\d+(?:[.,]\d+)?)\s*(euros?|eur|€|balles)\s*(?:et\s*)?(\d{1,2})\b(?!\s*(?:euros?|€|%|fois|jours?|mois))/);
  if (m) return { value: Number(m[1].replace(',', '.')) + Number(m[3].padEnd(2, '0')) / 100, currency: 'EUR' };
  m = s.match(/(\d+(?:[.,]\d+)?)\s*(euros?|eur|€|balles|francs?(?: cfa)?|fcfa|cfa|f cfa|dollars?|\$)/);
  if (m) {
    const cur = /franc|cfa/.test(m[2]) ? 'XOF' : /dollar|\$/.test(m[2]) ? 'USD' : 'EUR';
    return { value: Number(m[1].replace(',', '.')), currency: cur };
  }
  // nombre seul : le plus grand nombre qui n'est ni une date ni une durée
  const all = [...s.matchAll(/(\d+(?:[.,]\d+)?)(?!\s*(?:fois|jours?|mois|ans?|semaines?|h\b|heures?|%|er\b))/g)]
    .filter((x) => { const after = s.slice((x.index ?? 0) + x[0].length, (x.index ?? 0) + x[0].length + 12).trim(); return !MONTHS_N.some((mm) => after.startsWith(mm)) && !/^(fois|jours?|mois)/.test(after); })
    .filter((x) => !/\ble\s*$/.test(s.slice(Math.max(0, (x.index ?? 0) - 4), x.index)));
  if (!all.length) return null;
  const v = Math.max(...all.map((x) => Number(x[1].replace(',', '.'))));
  return { value: v, currency: main };
}

const MONTHS_N = MONTHS_FR.map(norm);
/** Date passée dite à l'oral (pour une opération déjà faite). */
export function extractPastDate(t: string, ref: DStr): DStr {
  if (/avant[ -]hier/.test(t)) return addDays(ref, -2);
  if (/\bhier\b/.test(t)) return addDays(ref, -1);
  const ago = t.match(/il y a (\d+) jours?/);
  if (ago) return addDays(ref, -Number(ago[1]));
  const m = t.match(new RegExp(`\\ble (\\d{1,2})(?:er)?(?: (${MONTHS_N.join('|')}))?\\b`));
  if (m) {
    const p = parts(ref);
    let y = p.y, mo = m[2] ? MONTHS_N.indexOf(m[2]) + 1 : p.m;
    const d = Number(m[1]);
    if (!m[2] && d > p.d) mo -= 1;
    if (m[2] && (mo > p.m || (mo === p.m && d > p.d))) y -= 1;
    if (mo < 1) { mo = 12; y -= 1; }
    if (d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, '0')}-${String(Math.min(d, daysInMonth(y, mo))).padStart(2, '0')}`;
  }
  return ref;
}

// ------------------------------------------------------------------ catégories, comptes, personnes
const CAT_WORDS: [RegExp, string][] = [
  [/courses|supermarche|lidl|carrefour|intermarche|auchan|leclerc|aldi|franprix|monoprix|epicerie|marche\b/, 'courses'],
  [/restaurant|resto|kebab|mcdo|mc do|burger|pizza|cafe|dejeuner|diner|boulangerie|sandwich/, 'restaurants'],
  [/livraison|uber eats|deliveroo/, 'livraison'],
  [/essence|carburant|gasoil|gazole|diesel|plein/, 'carburant'],
  [/loyer/, 'loyer'], [/electricite|edf|engie/, 'electricite'], [/\beau\b/, 'eau'], [/internet|\bbox\b|fibre/, 'internet'],
  [/telephone|forfait|recharge (?:telephonique|credit)/, 'telephone'],
  [/uber\b|taxi|bus|train|sncf|ticket|navigo|metro|transport|trajet|zem|moto taxi/, 'deplacements'],
  [/pharmacie|medecin|docteur|sante|medicament|dentiste/, 'sante'],
  [/vetement|habits|chaussures|t-shirt|pantalon/, 'habillement'],
  [/cinema|sortie|concert|jeu video|jeux|loisir|bar\b|boite/, 'loisirs'],
  [/netflix|spotify|abonnement|deezer|canal/, 'abonnements'], [/\blivres?\b|librairie/, 'livres'],
  [/cadeau/, 'cadeaux'], [/famille|maman|papa|parents|mere|pere|frere|soeur/, 'aide-familiale'],
  [/cotisation|tontine/, 'cotisations'], [/assurance/, 'assurance'], [/impot|taxe/, 'impots'],
  [/ordinateur|pc\b|portable|clavier|souris|ecran/, 'materiel-info'],
  [/salaire|paie\b|paye\b/, 'salaire'], [/alternance/, 'alternance'], [/\bcaf\b|apl|aide au logement/, 'caf'], [/bourse/, 'bourse'],
  [/freelance|mission|prestation/, 'freelance'], [/vente|vendu/, 'commerce'], [/rembourse(?:ment)? (?:de|par) (?:la )?(?:secu|mutuelle)/, 'remb-recu'],
];
export function guessCategory(t: string, cats: VoiceContext['categories'], kind: 'expense' | 'income'): string | undefined {
  for (const [re, id] of CAT_WORDS) if (re.test(t)) { const c = cats.find((x) => x.id === id); if (c && (c.kind === kind || c.kind === 'both')) return id; }
  for (const c of cats) { const n = norm(c.name); if (n.length > 3 && t.includes(n) && (c.kind === kind || c.kind === 'both')) return c.id; }
  return undefined;
}

function methodOf(t: string): string | undefined {
  if (/espece|cash|liquide/.test(t)) return 'Espèces';
  if (/\b(mtn|moov|celtiis|momo|flooz|orange money|wave|mobile money)\b/.test(t)) return 'Mobile money';
  if (/\bcarte\b|\bcb\b/.test(t)) return 'Carte bancaire';
  if (/virement/.test(t)) return 'Virement';
  if (/cheque/.test(t)) return 'Chèque';
  return undefined;
}
function guessAccount(t: string, accs: VoiceContext['accounts'], prefer?: RegExp): { id?: string; method?: string } {
  const live = accs.filter((a) => !a.archived && !a.projectId);
  const byName = live.filter((a) => norm(a.name).length > 2 && t.includes(norm(a.name))).sort((a, b) => b.name.length - a.name.length)[0];
  if (byName) return { id: byName.id, method: methodOf(t) };
  const byType = (type: string) => live.find((a) => a.type === type)?.id;
  if (/espece|cash|liquide|en main/.test(t)) return { id: byType('especes'), method: 'Espèces' };
  const mm = t.match(/\b(mtn|moov|celtiis|momo|flooz|orange money|wave|mobile money)\b/);
  if (mm) { const key = mm[1] === 'momo' ? 'mtn' : mm[1]; return { id: live.find((a) => a.type === 'mobile' && norm(a.name).includes(key))?.id ?? byType('mobile'), method: 'Mobile money' }; }
  if (/\bcarte\b|\bcb\b/.test(t)) return { id: byType('banque'), method: 'Carte bancaire' };
  if (/virement/.test(t)) return { id: byType('banque'), method: 'Virement' };
  if (/livret|epargne/.test(t)) return { id: byType('epargne') };
  if (prefer) { const p = live.find((a) => prefer.test(a.type)); if (p) return { id: p.id }; }
  return { id: live.find((a) => a.liquid)?.id ?? live[0]?.id };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Retrouve dans la phrase d'origine (avec accents) le passage correspondant à des mots normalisés. */
function fromOriginal(original: string, phrase: string): string {
  const words = original.split(/\s+/);
  const target = norm(phrase).split(' ');
  for (let i = 0; i + target.length <= words.length; i++) {
    const seg = words.slice(i, i + target.length);
    if (seg.every((w, k) => norm(w).replace(/[.,!?;:]+$/, '') === target[k])) return seg.join(' ').replace(/[.,!?;:]+$/, '');
  }
  return phrase;
}
const nice = (original: string, phrase: string) => { const o = fromOriginal(original, phrase); return o === phrase ? cap(phrase) : cap(o); };
const STOP = '(?:pour|en|avec|par|hier|aujourd\'hui|avant|le|la|les|a|au|de|du|sur|ce|cette|il|qui|que|et|avec|euros?|€)';
function after(t: string, word: string): string | undefined {
  const m = t.match(new RegExp(`\\b${word} ((?:(?!${STOP}\\b)[\\p{L}'-]+ ?){1,3})`, 'u'));
  return m ? m[1].trim() : undefined;
}
function findPerson(t: string, debts: VoiceContext['debts'], dir?: 'dette' | 'creance'): { id?: string; person?: string } {
  const pool = debts.filter((d) => !d.archived && (!dir || d.direction === dir));
  const hit = pool.find((d) => t.includes(norm(d.person)));
  if (hit) return { id: hit.id, person: hit.person };
  return {};
}

// ------------------------------------------------------------------ pages
const PAGES: [RegExp, string, string][] = [
  [/tableau de bord|accueil|synthese/, '/', 'Tableau de bord'], [/transactions?|operations?|depenses|historique/, '/transactions', 'Transactions'],
  [/comptes?|portefeuilles?|soldes?/, '/comptes', 'Comptes'], [/engagements?|factures|echeances|abonnements/, '/engagements', 'Engagements'],
  [/calendrier|agenda/, '/calendrier', 'Calendrier'], [/simulat/, '/simulations', 'Simulations'], [/decision/, '/decision', 'Centre de décision'],
  [/planification|prevision|projection/, '/planification', 'Planification'], [/budgets?/, '/budgets', 'Budgets'], [/dettes?|creances?|prets?/, '/dettes', 'Dettes et créances'],
  [/epargne|objectifs?|fonds d'urgence/, '/epargne', 'Épargne'], [/cotisations?|tontines?/, '/cotisations', 'Cotisations'], [/projets?/, '/projets', 'Projets'],
  [/analyses?|rapports?|statistiques/, '/analyses', 'Analyses et rapports'], [/documents?|justificatifs?|factures scannees/, '/documents', 'Documents'],
  [/parametres|reglages/, '/parametres', 'Paramètres'], [/assistant/, '/assistant', 'Assistant'], [/journal/, '/journal', 'Journal'],
];

export const YES = /^(oui|ouais|ouai|yes|ok|okay|d'accord|daccord|confirme|je confirme|valide|vas y|vas-y|c'est bon|enregistre|parfait|exact|c'est ca)\b/;
export const NO = /^(non|nan|annule|annuler|stop|laisse tomber|pas maintenant|surtout pas|corrige|modifier|modifie)\b/;
export function parseConfirm(text: string): boolean | null {
  const t = norm(text).replace(/[.!?,]/g, '');
  if (YES.test(t)) return true;
  if (NO.test(t)) return false;
  return null;
}

// ------------------------------------------------------------------ analyse principale
export function parseVoice(raw: string, ctx: VoiceContext): VoiceIntent {
  const original = raw.trim();
  const t = digitize(original).replace(/[?!]/g, ' ').replace(/\s+/g, ' ').trim();
  const amt = extractAmount(t, ctx.main);
  const money = (cur: string, v: number) => toMinor(v, cur);

  // Navigation
  const nav = t.match(/^(?:ouvre|ouvrir|affiche|afficher|montre|montre moi|va|aller|aller a|aller sur|vas|emmene moi)\b(.*)$/);
  if (nav) { for (const [re, to, label] of PAGES) if (re.test(nav[1])) return { type: 'nav', to, label }; }

  // Question explicite : laissée à l'assistant
  if (/^(?:est ce qu|est-ce qu|combien|quand|quel|quelle|quels|quelles|puis je|puis-je|peux je|comment|pourquoi|qu'est ce|ai je|vais je|dois je|est il|y a t il|ou en)/.test(t) || /\?\s*$/.test(original)) {
    if (!/^(?:ajoute|note|enregistre|simule)/.test(t)) return { type: 'question', text: original };
  }

  // Simulation
  if (/^(?:simule|simuler|fais une simulation|et si j'achete|et si j'achetais|si j'achete|si j'achetais)/.test(t)) {
    if (!amt) return { type: 'incomplete', text: original, missing: 'le prix' };
    const obj = t.match(/\b(?:un|une|des|le|la|l')\s+([\p{L}' -]{2,40}?)\s+(?:a|de|pour|qui coute)\b/u)?.[1];
    const n = t.match(/en (\d+) fois/);
    return { type: 'simulate', label: obj ? nice(original, obj.trim()) : 'Achat', amount: money(amt.currency, amt.value), currency: amt.currency, installments: n ? Number(n[1]) : undefined };
  }

  const date = extractPastDate(t, ctx.ref);

  // Dettes et prêts
  const repayTo = t.match(/(?:j'ai |je )?rembourse(?:r)? (?:\d[\d.,]* ?\S* )?(?:a|au) ([\p{L}' -]+)/u) || t.match(/^rembourse/);
  const repaidBy = t.match(/^([\p{L}' -]+?) m'a rembourse/u) || t.match(/(?:remboursement|j'ai recupere) (?:de )?(?:\d[\d.,]* ?\S* )?(?:de|par|aupres de) ([\p{L}' -]+)/u);
  const lendTo = t.match(/j'ai prete (?:\d[\d.,]* ?\S* )?(?:a|au) ([\p{L}' -]+)/u);
  const borrowFrom = t.match(/(?:j'ai emprunte (?:\d[\d.,]* ?\S* )?(?:a|au|aupres de) ([\p{L}' -]+))|(?:^([\p{L}' -]+?) m'a prete)/u);
  const debtCase = (action: 'repay' | 'received' | 'lend' | 'borrow', who: string | undefined, dir?: 'dette' | 'creance'): VoiceIntent => {
    if (!amt) return { type: 'incomplete', text: original, missing: 'le montant' };
    const known = findPerson(t, ctx.debts, dir);
    const raw = (who ?? '').replace(new RegExp(`\\b${STOP}\\b.*$`), '').replace(/\b(?:mon|ma|mes)\b/g, '').trim();
    const person = known.person ?? (raw ? nice(original, raw) : '?');
    const acc = guessAccount(t, ctx.accounts);
    return { type: 'debt', action, amount: money(amt.currency, amt.value), currency: amt.currency, debtId: action === 'repay' || action === 'received' ? known.id : undefined, person, date, accountId: acc.id };
  };
  if (repaidBy) return debtCase('received', repaidBy[1], 'creance');
  if (lendTo) return debtCase('lend', lendTo[1]);
  if (borrowFrom) return debtCase('borrow', borrowFrom[1] ?? borrowFrom[2]);
  if (repayTo && !/rembourse(?:ment)? (?:de|par) (?:la )?(?:secu|mutuelle)/.test(t)) return debtCase('repay', repayTo[1], 'dette');

  // Transferts
  if (/(?:transf[eè]re|transfert|vire|virement (?:de|du|vers)|retire|retrait|recharge|alimente|depose)/.test(t) && !/virement de (?:mon )?salaire/.test(t)) {
    if (!amt) return { type: 'incomplete', text: original, missing: 'le montant' };
    const live = ctx.accounts.filter((a) => !a.archived);
    const find = (seg: string | undefined) => (seg ? guessAccount(seg, live).id : undefined);
    const fromSeg = t.match(/(?:du|de|depuis) (?:mon |le |la )?((?:(?!vers|sur|au|a\b|en\b).)+)/)?.[1];
    const toSeg = t.match(/(?:vers|sur|au|a|dans) (?:mon |le |la )?(.+)$/)?.[1];
    let fromId = fromSeg && !/^\d/.test(fromSeg) ? find(fromSeg) : undefined;
    let toId = toSeg ? find(toSeg) : undefined;
    if (/retir|retrait/.test(t)) { fromId ??= live.find((a) => a.type === 'banque')?.id; toId = live.find((a) => a.type === 'especes')?.id ?? toId; }
    if (/recharge/.test(t)) { fromId ??= live.find((a) => a.type === 'banque')?.id; toId = toId && live.find((a) => a.id === toId)?.type === 'mobile' ? toId : live.find((a) => a.type === 'mobile')?.id; }
    if (fromId === toId) toId = undefined;
    return { type: 'transfer', amount: money(amt.currency, amt.value), currency: amt.currency, fromId, toId, date, label: /retir|retrait/.test(t) ? 'Retrait d\'espèces' : /recharge/.test(t) ? 'Rechargement mobile money' : 'Transfert' };
  }

  // Opérations : revenu ou dépense
  const income = /\b(?:recu|touche|gagne|encaisse)\b|salaire|rentree d'argent|on m'a (?:donne|paye|vire)|\bbourse\b|\bcaf\b|\bapl\b/.test(t) && !/\b(?:paye|achete|depense)\b/.test(t);
  const expense = /\b(?:depense|depenses|paye|payee|achete|achetee|regle|claque)\b|\bachat\b|^(?:ajoute|ajouter|note|noter|enregistre|enregistrer)\b/.test(t);
  if (amt && (income || expense)) {
    const kind: 'income' | 'expense' = income ? 'income' : 'expense';
    const categoryId = guessCategory(t, ctx.categories, kind);
    const acc = guessAccount(t, ctx.accounts);
    const payee = after(t, 'chez') ?? (kind === 'income' ? after(t, 'de la part de') : undefined);
    const forWhat = t.match(/\bpour (?:le |la |les |l'|un |une |des |mon |ma |mes )?((?:(?!hier|aujourd'hui|en|avec|par|chez|sur)[\p{L}'-]+ ?){1,4})/u)?.[1]?.trim();
    const catName = ctx.categories.find((c) => c.id === categoryId)?.name;
    const payeeNice = payee ? nice(original, payee) : undefined;
    const label = forWhat && !/^\d/.test(forWhat) ? nice(original, forWhat) : catName ?? (payeeNice ? `${kind === 'income' ? 'Revenu' : 'Achat'} ${payeeNice}` : kind === 'income' ? 'Revenu' : 'Dépense');
    return { type: 'tx', kind, amount: money(amt.currency, amt.value), currency: amt.currency, categoryId, accountId: acc.id, date, label, payee: payeeNice, method: acc.method ?? methodOf(t) };
  }
  if (!amt && /^(?:ajoute|ajouter|note|noter|enregistre|enregistrer|j'ai (?:depense|paye|achete|recu))/.test(t)) return { type: 'incomplete', text: original, missing: 'le montant' };

  return { type: 'question', text: original };
}
