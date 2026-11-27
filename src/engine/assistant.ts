import { addDays, addMonths, daysInMonth, diffDays, endOfMonth, fmtDate, MONTHS_FR, monthLabel, monthsBetween, parts, startOfMonth, type DStr } from './date';
import { convert, fmt, parseAmount, toMinor } from './money';
import { payoffPlan, requiredMonthly } from './debts';
import { project, simulatePurchase, type Level } from './projection';
import type { Ledger } from './ledger';

export interface Answer { text: string[]; level?: Level | 'info'; actions?: { label: string; to: string }[] }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");
const MONTHS_N = MONTHS_FR.map((m) => norm(m));

export function parseMoney(q: string, main: string): { minor: number; cur: string } | null {
  const s = q.replace(/[  ]/g, ' ');
  const re = /(\d{1,3}(?:[ .]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(k\b)?\s*(€|euros?\b|eur\b|fcfa|f\s?cfa|xof|\$|usd)?/gi;
  const found: { v: number; cur?: string; strong: boolean; idx: number; raw: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const after = norm(s.slice(m.index + m[0].length, m.index + m[0].length + 12)).trim();
    const raw = m[1];
    let v = parseAmount(raw.replace(/ /g, ''));
    if (m[2]) v *= 1000;
    const curTok = (m[3] || '').toLowerCase();
    const cur = /cfa|xof/.test(curTok) ? 'XOF' : /\$|usd/.test(curTok) ? 'USD' : curTok ? 'EUR' : undefined;
    const isDateish = MONTHS_N.some((mm) => after.startsWith(mm)) || /^(jours?|semaines?|mois|ans?|annees?|fois|x\b|%)/.test(after) || /^[/]/.test(after);
    if (!cur && isDateish) continue;
    found.push({ v, cur, strong: !!cur || !!m[2], idx: m.index, raw });
  }
  if (!found.length) return null;
  const pick = found.find((f) => f.strong) ?? found.sort((a, b) => b.v - a.v)[0];
  const cur = pick.cur ?? main;
  return { minor: toMinor(pick.v, cur), cur };
}

export function parseDate(q: string, ref: DStr): { date: DStr; month?: boolean; label: string } | null {
  const n = norm(q);
  if (/aujourd'?hui|maintenant|tout de suite/.test(n)) return { date: ref, label: "aujourd'hui" };
  if (/apres-demain/.test(n)) return { date: addDays(ref, 2), label: 'après-demain' };
  if (/\bdemain\b/.test(n)) return { date: addDays(ref, 1), label: 'demain' };
  if (/fin (du|de|de ce) mois/.test(n)) return { date: endOfMonth(ref), label: 'fin du mois' };
  if (/fin (de l'annee|d'annee|decembre)/.test(n)) return { date: ref.slice(0, 4) + '-12-31', label: "fin d'année" };
  if (/mois prochain/.test(n)) { const d = startOfMonth(addMonths(startOfMonth(ref), 1)); return { date: d, month: true, label: monthLabel(d.slice(0, 7)) }; }
  let m = n.match(/dans (\d+|un|une|deux|trois|six|douze) (jours?|semaines?|mois|ans?|annees?)/);
  if (m) {
    const words: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, six: 6, douze: 12 };
    const k = words[m[1]] ?? Number(m[1]);
    const u = m[2];
    const d = u.startsWith('jour') ? addDays(ref, k) : u.startsWith('semaine') ? addDays(ref, 7 * k) : u.startsWith('mois') ? addMonths(ref, k) : addMonths(ref, 12 * k);
    return { date: d, label: `dans ${k} ${u}` };
  }
  m = n.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]);
    let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : parts(ref).y;
    let ds = `${y}-${String(mo).padStart(2, '0')}-${String(Math.min(d, daysInMonth(y, mo))).padStart(2, '0')}`;
    if (!m[3] && ds < ref) { y++; ds = `${y}-${String(mo).padStart(2, '0')}-${String(Math.min(d, daysInMonth(y, mo))).padStart(2, '0')}`; }
    if (mo >= 1 && mo <= 12) return { date: ds, label: fmtDate(ds, 'long') };
  }
  const mi = MONTHS_N.findIndex((mm) => new RegExp(`\\b${mm}\\b`).test(n));
  if (mi >= 0) {
    const yM = n.match(new RegExp(`${MONTHS_N[mi]}\\s+(20\\d\\d)`));
    const dM = n.match(new RegExp(`(\\d{1,2})(?:er)?\\s+${MONTHS_N[mi]}`));
    const pr = parts(ref);
    let y = yM ? Number(yM[1]) : pr.y;
    if (!yM && (mi + 1 < pr.m)) y++;
    const day = dM ? Math.min(Number(dM[1]), daysInMonth(y, mi + 1)) : 1;
    let ds = `${y}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!dM && ds < ref) ds = ref; // mois courant : à partir d'aujourd'hui
    if (dM && !yM && ds < ref) ds = `${y + 1}${ds.slice(4)}`;
    return { date: ds, month: !dM, label: dM ? fmtDate(ds, 'long') : `en ${MONTHS_FR[mi]} ${y}` };
  }
  return null;
}

const LVL_TXT: Record<Level, string> = { ok: '🟢 Achat raisonnable', tendu: '🟠 Achat possible mais tendu', risque: '🔴 Achat risqué' };

export function ask(L: Ledger, question: string): Answer {
  const q = norm(question);
  const money = parseMoney(question, L.main);
  const date = parseDate(question, L.ref);
  const M = (v: number) => fmt(v, L.main);
  const toMain = (mm: { minor: number; cur: string }) => convert(mm.minor, mm.cur, L.main, L.main, L.s.rates);

  if (!L.s.accounts.length) return { text: ["Je n'ai encore aucune donnée : crée d'abord tes comptes et tes revenus/charges récurrents, puis repose ta question."], level: 'info', actions: [{ label: 'Créer un compte', to: '/comptes' }] };

  // 1. Achat
  if (/(acheter|achat|me payer|m'offrir|offrir|commander|payer un|financer un)/.test(q) && money && !/projet/.test(q)) {
    const amount = toMain(money);
    const d = date?.date ?? L.ref;
    const what = (question.match(/(?:acheter|payer|offrir|commander)\s+(?:un|une|des|le|la|l')?\s*([^0-9€,?]{2,40})/i)?.[1] || 'cet achat').trim().replace(/\s+(a|à|pour|de|en|le|dans)$/i, '');
    const r = simulatePurchase(L, { id: 'q', label: what, date: d, amount, direction: 'out', mode: 'comptant' });
    const text = [`**${LVL_TXT[r.level]}** : ${what} à ${M(amount)} ${date ? date.label : "aujourd'hui"}.`, ...r.reasons];
    if (date?.month && r.level !== 'ok' && r.suggestion && r.suggestion.date <= endOfMonth(d)) text.push(`Dans ce mois, le meilleur moment est à partir du ${fmtDate(r.suggestion.date, 'long')}.`);
    text.push(...r.advice);
    return { text, level: r.level, actions: [{ label: 'Ouvrir le simulateur', to: '/simulations' }] };
  }

  // 2. Combien épargner pour atteindre X
  if (/(economiser|epargner|mettre de cote|mettre de côte|garder de cote)/.test(q) && money) {
    const target = toMain(money);
    const d = date?.date ?? addMonths(L.ref, 12);
    const months = Math.max(1, monthsBetween(L.ref, d) + (parts(d).d > parts(L.ref).d ? 0 : 0));
    const need = requiredMonthly(target, months);
    const rav = L.resteAVivre();
    const text = [`Pour disposer de ${M(target)} ${date ? date.label : "dans 12 mois"} (${months} mois), il faut mettre de côté **${M(need)} par mois**.`];
    if (rav.totalIncome > 0) {
      const share = need / rav.totalIncome;
      text.push(`Cela représente ${(share * 100).toFixed(0)} % de tes revenus certains mensuels (${M(rav.totalIncome)}) et ton reste à vivre structurel est de ${M(rav.reste)}.`);
      if (need > rav.reste) text.push('⚠️ Ce rythme dépasse ton reste à vivre : allonge le délai ou réduis la cible.');
      else text.push(`Après cette épargne, il te resterait environ ${M(rav.reste - need)} par mois pour les dépenses variables.`);
    }
    return { text, level: rav.totalIncome && need > rav.reste ? 'risque' : 'info', actions: [{ label: 'Créer un objectif', to: '/epargne' }] };
  }

  // 3. Projet
  if (/projet/.test(q) && money && /(par mois|mensuel|chaque mois)/.test(q)) {
    const monthly = toMain(money);
    const nM = (q.match(/dans (\d+) mois/) || [])[1];
    const months = nM ? Number(nM) : date ? Math.max(1, monthsBetween(L.ref, date.date)) : 6;
    const proj = L.s.projects.find((p) => q.includes(norm(p.name))) ?? (L.s.projects.length === 1 ? L.s.projects[0] : undefined);
    const text: string[] = [];
    if (proj) {
      const st = L.projectStats(proj);
      const cur = proj.currency;
      const add = convert(monthly * months, L.main, cur, L.main, L.s.rates);
      text.push(`**${proj.name}** : trésorerie actuelle ${fmt(st.treasury, cur)}, dépenses engagées ${fmt(st.committed, cur)}.`);
      text.push(`En y consacrant ${M(monthly)} par mois pendant ${months} mois, le projet disposera d'environ **${fmt(st.treasury + add - st.committed, cur)}** (apports ${fmt(add, cur)}, hors recettes futures).`);
    } else text.push(`En y consacrant ${M(monthly)} par mois, le projet recevra **${M(monthly * months)}** en ${months} mois.`);
    const withC = project(L, { days: months * 31, changes: [{ id: 'x', type: 'expense_add', label: 'Apport projet', amount: monthly, from: L.ref }] });
    text.push(`Impact sur ta trésorerie personnelle : point bas ${M(withC.min.value)} le ${fmtDate(withC.min.date)}, solde disponible à ${months} mois ${M(withC.end.free)}.`);
    const lvl = withC.min.value < L.s.settings.safetyThreshold ? 'risque' : 'ok';
    if (lvl === 'risque') text.push('🔴 Ce rythme ferait passer ton solde sous le seuil de sécurité.');
    return { text, level: lvl, actions: [{ label: 'Voir les projets', to: '/projets' }] };
  }

  // 4. Quand les dettes seront remboursées / stratégie
  if (/dettes?/.test(q) && /(strategie|methode|meilleur|comment|avalanche|boule|quand|combien de temps|rembourser toutes)/.test(q)) {
    const debts = L.s.debts.filter((d) => d.direction === 'dette' && !d.archived && L.debtRemaining(d) > 0);
    if (!debts.length) return { text: ['Tu n\'as aucune dette en cours. 🎉'], level: 'ok' };
    const mins = debts.map((d) => ({ d, min: Math.round(L.activeRules().filter((r) => r.debtId === d.id).reduce((a, r) => a + L.ruleMonthly(r), 0)) }));
    let budget = money ? toMain(money) : mins.reduce((a, x) => a + x.min, 0);
    const text: string[] = [];
    if (!budget) { budget = Math.max(Math.round(L.resteAVivre().reste * 0.3), 1); text.push(`Aucun échéancier n'est défini : je prends un budget hypothétique de ${M(budget)} par mois (30 % du reste à vivre). Précise « avec 200 € par mois » pour ajuster.`); }
    const inp = mins.map(({ d, min }) => ({ id: d.id, name: d.person, balance: L.conv(L.debtRemaining(d), d.currency), rate: d.rate ?? 0, min }));
    const sn = payoffPlan(inp, budget, 'boule_de_neige');
    const av = payoffPlan(inp, budget, 'avalanche');
    text.push(`Avec ${M(budget)} par mois consacrés aux dettes (total restant ${M(inp.reduce((a, x) => a + x.balance, 0))}) :`);
    const line = (n: string, r: typeof sn) => r.feasible ? `• ${n} : remboursé en **${r.months} mois** (${fmtDate(addMonths(L.ref, r.months), 'month')}), intérêts ${M(r.totalInterest)}. Ordre : ${r.order.map((o) => o.name).join(' → ')}.` : `• ${n} : budget insuffisant pour couvrir les intérêts.`;
    text.push(line('Boule de neige (plus petites d\'abord)', sn), line('Avalanche (taux les plus élevés d\'abord)', av));
    const best = av.totalInterest < sn.totalInterest ? 'avalanche, qui coûte moins cher en intérêts' : 'boule de neige : même coût, mais des victoires rapides qui motivent';
    text.push(`Recommandation : méthode ${best}.`);
    return { text, level: 'info', actions: [{ label: 'Gérer les dettes', to: '/dettes' }] };
  }

  // 5. Plus grosses dépenses
  if (/(depenses? (les )?plus|plus grosses?|principales? depenses|ou (part|va) (mon|l')argent|top depenses|plus importantes)/.test(q)) {
    const last = /mois dernier|mois precedent/.test(q);
    const ref = last ? addDays(startOfMonth(L.ref), -1) : L.ref;
    const from = startOfMonth(ref), to = endOfMonth(ref);
    const byCat = [...L.expenseByCategory(from, to)].sort((a, b) => b[1] - a[1]);
    const total = byCat.reduce((a, x) => a + x[1], 0);
    if (!total) return { text: [`Aucune dépense enregistrée ${last ? 'le mois dernier' : 'ce mois-ci'}.`], level: 'info' };
    const cat = (id: string) => L.s.categories.find((c) => c.id === id)?.name ?? 'Sans catégorie';
    const big = L.s.txs.filter((t) => t.date >= from && t.date <= to && L.classify(t) === 'depense').sort((a, b) => L.txMain(b) - L.txMain(a)).slice(0, 3);
    return {
      text: [
        `Dépenses de consommation ${last ? 'du mois dernier' : 'de ce mois'} : **${M(total)}**.`,
        ...byCat.slice(0, 5).map(([k, v], i) => `${i + 1}. ${cat(k)} : ${M(v)} (${Math.round((v / total) * 100)} %)`),
        `Plus grosses opérations : ${big.map((t) => `${t.label} ${M(L.txMain(t))}`).join(', ')}.`,
      ], level: 'info', actions: [{ label: 'Voir les analyses', to: '/analyses' }],
    };
  }

  // 6. Combien me restera-t-il / combien aurai-je
  if (/(combien (aurai|j'aurai|me restera|il me restera|vais-je avoir|je vais avoir)|solde (prevu|previsionnel|dans|a la fin|fin)|fin du mois|fin de mois)/.test(q) || (date && /combien/.test(q))) {
    const d = date?.date ?? endOfMonth(L.ref);
    const days = Math.max(1, diffDays(d, L.ref) + 1);
    const sc = (['optimiste', 'realiste', 'pessimiste'] as const).map((s) => project(L, { days, scenario: s }));
    const r = sc[1];
    return {
      text: [
        `Solde prévu ${date ? date.label : 'à la fin du mois'} (${fmtDate(d, 'long')}) : **${M(r.end.balance)}**, dont **${M(r.end.free)}** réellement disponibles (hors épargne affectée).`,
        `Scénarios : optimiste ${M(sc[0].end.free)} · réaliste ${M(sc[1].end.free)} · pessimiste ${M(sc[2].end.free)}.`,
        `Point bas d'ici là : ${M(r.min.value)} le ${fmtDate(r.min.date, 'long')}.`,
        `Dépenses variables estimées : ${M(r.variableDaily)} par jour (${r.variableSource}).`,
      ], level: r.min.value < L.s.settings.safetyThreshold ? 'risque' : 'ok', actions: [{ label: 'Voir la planification', to: '/planification' }],
    };
  }

  // 7. Disponible / reste à vivre
  if (/(reste a vivre|disponible|combien (je )?(peux|puis)[- ]?(je )?depenser|marge)/.test(q)) {
    const a = L.available();
    const r = L.resteAVivre();
    return {
      text: [
        `Disponible réel aujourd'hui : **${M(a.value)}**.`,
        `Calcul : liquidités ${M(a.liquid)} − épargne affectée ${M(a.alloc)} − engagements jusqu'au ${fmtDate(a.until)} ${M(a.commitments)} − réserve de sécurité ${M(a.reserve)}.`,
        a.next ? `Prochain revenu certain : ${a.next.label} (${M(a.next.amount)}) le ${fmtDate(a.next.date, 'long')}.` : 'Aucun revenu certain planifié dans les 2 prochains mois.',
        `Reste à vivre structurel mensuel : ${M(r.reste)} (revenus certains ${M(r.totalIncome)} − obligations ${M(r.totalCharges)}).`,
      ], level: a.value < 0 ? 'risque' : 'info',
    };
  }

  // 8. Situation globale
  if (/(solde|combien j'ai|combien ai-je|patrimoine|situation|bilan)/.test(q)) {
    return {
      text: [
        `Liquidités : **${M(L.liquidTotal())}** · épargne : ${M(L.totalSavings())}.`,
        `Dettes restantes : ${M(L.totalDebts())} · créances à récupérer : ${M(L.totalClaims())}.`,
        `Patrimoine financier net : **${M(L.netWorth())}**.`,
      ], level: 'info',
    };
  }

  return {
    text: [
      'Je réponds à partir de tes données réelles. Exemples de questions :',
      '• « Est-ce que je peux acheter un ordinateur à 1 200 € en janvier ? »',
      '• « Combien dois-je économiser pour avoir 2 000 € en juin ? »',
      '• « Quelles sont mes dépenses les plus importantes ce mois-ci ? »',
      '• « Quelle est la meilleure stratégie pour rembourser mes dettes ? »',
      '• « Si je consacre 150 € par mois à mon projet, quel sera son budget dans six mois ? »',
      '• « Combien me restera-t-il à la fin du mois ? » · « Combien puis-je dépenser ? »',
    ], level: 'info',
  };
}
