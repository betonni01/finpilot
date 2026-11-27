import { addDays, diffDays, endOfMonth, fmtDate, monthKey, startOfMonth } from './date';
import { fmt, rateOf, sum } from './money';
import { pendingOccurrences } from './recurrence';
import { project } from './projection';
import type { Ledger } from './ledger';
import type { Tx } from './types';

export interface Alert { id: string; level: 'danger' | 'warning' | 'info' | 'success'; title: string; detail?: string; to?: string }

export function computeAlerts(L: Ledger): Alert[] {
  const out: Alert[] = [];
  const ref = L.ref;
  const cat = (id?: string) => L.s.categories.find((c) => c.id === id)?.name ?? 'Sans catégorie';
  if (!L.s.accounts.length) return [{ id: 'start', level: 'info', title: 'Commence par créer tes comptes', detail: 'Banque, espèces, mobile money : chaque compte a son solde initial.', to: '/comptes' }];

  // Projection fin de mois
  const days = Math.max(2, diffDays(endOfMonth(ref), ref) + 1);
  const p = project(L, { days: Math.max(days, 35) });
  if (p.firstNegative) out.push({ id: 'neg', level: 'danger', title: `Risque de découvert le ${fmtDate(p.firstNegative, 'long')}`, detail: `Point bas prévu : ${fmt(p.min.value, L.main)}.`, to: '/planification' });
  else if (p.firstBelow) out.push({ id: 'below', level: 'warning', title: `Solde disponible sous le seuil de sécurité le ${fmtDate(p.firstBelow, 'long')}`, detail: `Point bas : ${fmt(p.min.value, L.main)} (seuil ${fmt(L.s.settings.safetyThreshold, L.main)}).`, to: '/planification' });

  // Échéances
  const pend = pendingOccurrences(L.activeRules(), L.s.occurrences, ref, addDays(ref, 5), 120, ref);
  const late = pend.filter((x) => x.overdue);
  const soon = pend.filter((x) => !x.overdue && x.rule.kind !== 'income');
  if (late.length) out.push({ id: 'late', level: 'danger', title: `${late.length} opération(s) planifiée(s) en retard`, detail: late.slice(0, 3).map((x) => `${x.rule.label} (${fmtDate(x.date)})`).join(', '), to: '/engagements' });
  if (soon.length) out.push({ id: 'soon', level: 'info', title: `${soon.length} échéance(s) dans les 5 prochains jours`, detail: soon.slice(0, 4).map((x) => `${x.rule.label} ${fmt(L.conv(x.remaining, L.accCur(x.rule.accountId)), L.main)} le ${fmtDate(x.date, 'day')}`).join(' · '), to: '/engagements' });

  // Dettes en retard
  for (const d of L.s.debts) {
    if (d.archived || !d.dueDate || d.dueDate >= ref) continue;
    const rem = L.debtRemaining(d);
    if (rem <= 0) continue;
    out.push(d.direction === 'dette'
      ? { id: 'd' + d.id, level: 'danger', title: `Dette envers ${d.person} échue depuis le ${fmtDate(d.dueDate)}`, detail: `Reste ${fmt(rem, d.currency)}.`, to: '/dettes' }
      : { id: 'c' + d.id, level: 'warning', title: `${d.person} devait te rembourser avant le ${fmtDate(d.dueDate)}`, detail: `Reste ${fmt(rem, d.currency)} à récupérer.`, to: '/dettes' });
  }

  // Budgets
  for (const b of L.s.budgets.filter((x) => x.active)) {
    const u = L.budgetUsage(b);
    const name = b.categoryId ? cat(b.categoryId) : 'Budget global';
    const steps = [...(L.s.settings.budgetAlerts ?? [50, 75, 90, 100])].sort((a, c) => c - a);
    const hit = steps.find((s) => u.pct * 100 >= s);
    if (hit == null) continue;
    const actual = Math.round(u.pct * 100);
    if (u.pct >= 1) out.push({ id: 'b' + b.id, level: 'danger', title: `${name} : budget dépassé`, detail: `${fmt(u.spent, L.main)} sur ${fmt(u.limit, L.main)} (${actual} %).`, to: '/budgets' });
    else out.push({ id: 'b' + b.id, level: 'warning', title: `${name} : ${actual} % du budget atteint`, detail: `Seuil d'alerte : ${hit} %. Reste ${fmt(u.left, L.main)}.`, to: '/budgets' });
  }
  const missingFx = [...new Set(L.s.accounts.filter((a) => !a.archived && a.currency !== L.main && !Number.isFinite(rateOf(a.currency, L.main, L.s.rates))).map((a) => a.currency))];
  if (missingFx.length) out.push({ id: 'fx', level: 'warning', title: `Taux manquant pour ${missingFx.join(', ')}`, detail: 'Ces montants comptent pour zéro dans les totaux en devise principale. Actualise les taux dans Paramètres.', to: '/parametres' });

  // Évolution des catégories (30 derniers jours vs moyenne des 3 périodes précédentes)
  const cur = L.expenseByCategory(addDays(ref, -29), ref);
  const prev = L.expenseByCategory(addDays(ref, -119), addDays(ref, -30));
  const hasHistory = L.s.txs.some((t) => t.date <= addDays(ref, -60));
  if (hasHistory) {
    for (const [k, v] of cur) {
      const avg = (prev.get(k) ?? 0) / 3;
      if (avg > 0 && v > avg * 1.25 && v - avg > L.s.settings.safetyThreshold * 0.05) {
        out.push({ id: 'cat' + k, level: 'warning', title: `${cat(k)} : +${Math.round((v / avg - 1) * 100)} % sur 30 jours`, detail: `${fmt(v, L.main)} contre ${fmt(Math.round(avg), L.main)} en moyenne.`, to: '/analyses' });
      }
    }
  }

  // Dépense inhabituelle récente
  const recent = L.s.txs.filter((t) => t.date >= addDays(ref, -7) && L.classify(t) === 'depense');
  for (const t of recent) {
    const same = L.s.txs.filter((x) => x.categoryId === t.categoryId && x.id !== t.id && L.classify(x) === 'depense').map((x) => L.txMain(x)).sort((a, b) => a - b);
    if (same.length < 5) continue;
    const med = same[Math.floor(same.length / 2)];
    if (L.txMain(t) > med * 3) out.push({ id: 'u' + t.id, level: 'info', title: `Dépense inhabituelle : ${t.label}`, detail: `${fmt(t.amount, L.accCur(t.accountId))}, soit plus de 3 fois la dépense habituelle en ${cat(t.categoryId)}.`, to: '/transactions' });
  }

  // Épargne en baisse sur 3 mois
  const savedAt = (d: string) => sum(L.s.goalMoves.filter((m) => m.date <= d).map((m) => m.amount));
  const m1 = savedAt(addDays(startOfMonth(ref), -1)), m2 = savedAt(addDays(startOfMonth(addDays(startOfMonth(ref), -1)), -1)), m3 = savedAt(addDays(startOfMonth(addDays(startOfMonth(addDays(startOfMonth(ref), -1)), -1)), -1));
  if (m3 > 0 && m1 < m2 && m2 < m3) out.push({ id: 'sav', level: 'warning', title: 'Ton épargne diminue depuis trois mois', to: '/epargne' });

  // Fonds d'urgence
  const ess = L.essentialMonthly().total;
  const ef = L.s.goals.find((g) => g.isEmergency && !g.archived);
  if (ess > 0 && ef) {
    const cov = L.conv(L.goalSaved(ef), ef.currency) / ess;
    if (cov < 1) out.push({ id: 'ef', level: 'info', title: `Fonds d'urgence : ${cov.toFixed(1)} mois de dépenses essentielles couverts`, detail: 'Objectif recommandé : 3 mois.', to: '/epargne' });
  }

  // Sauvegarde
  const lb = L.s.settings.lastBackupAt;
  if (L.s.txs.length > 10 && (!lb || diffDays(ref, lb.slice(0, 10)) > 14)) out.push({ id: 'bk', level: 'warning', title: lb ? `Dernière sauvegarde il y a ${diffDays(ref, lb.slice(0, 10))} jours` : 'Aucune sauvegarde réalisée', detail: 'Tes données sont stockées uniquement sur cet appareil. Exporte une sauvegarde chiffrée.', to: '/parametres' });

  // Récurrences non déclarées
  for (const s of detectRecurring(L).slice(0, 2)) out.push({ id: 'rec' + s.key, level: 'info', title: `Dépense récurrente détectée : ${s.label}`, detail: `${s.months} mois, environ ${fmt(s.amount, L.main)}. Crée une règle pour l'intégrer aux prévisions.`, to: '/engagements' });

  if (!out.length) out.push({ id: 'ok', level: 'success', title: 'Aucune alerte : ta situation est sous contrôle', detail: 'Les prévisions restent au-dessus de ton seuil de sécurité.' });
  const order = { danger: 0, warning: 1, info: 2, success: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** Opérations semblables revenant sur au moins 3 mois différents et sans règle associée. */
export function detectRecurring(L: Ledger) {
  const groups = new Map<string, Tx[]>();
  for (const t of L.s.txs) {
    if (t.ruleId || t.kind !== 'expense') continue;
    const key = (t.payee || t.label).toLowerCase().replace(/\d+/g, '').trim();
    if (!key) continue;
    const a = groups.get(key); if (a) a.push(t); else groups.set(key, [t]);
  }
  const ruledLabels = new Set(L.s.rules.map((r) => (r.payee || r.label).toLowerCase().trim()));
  const res: { key: string; label: string; months: number; amount: number; categoryId?: string; accountId: string }[] = [];
  for (const [k, arr] of groups) {
    if (ruledLabels.has(k)) continue;
    const months = new Set(arr.map((t) => monthKey(t.date)));
    if (months.size < 3) continue;
    const amounts = arr.map((t) => L.txMain(t)).sort((a, b) => a - b);
    const med = amounts[Math.floor(amounts.length / 2)];
    const close = amounts.filter((a) => Math.abs(a - med) <= med * 0.15).length / amounts.length;
    if (close < 0.7) continue;
    const last = arr.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    res.push({ key: k, label: last.payee || last.label, months: months.size, amount: med, categoryId: last.categoryId, accountId: last.accountId });
  }
  return res;
}

/** Doublon probable : même compte, même montant, ±1 jour, libellé proche. */
export function findDuplicate(txs: Tx[], t: Pick<Tx, 'accountId' | 'amount' | 'date' | 'label' | 'id'>): Tx | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return txs.find((x) => x.id !== t.id && x.accountId === t.accountId && x.amount === t.amount && Math.abs(diffDays(x.date, t.date)) <= 1 && (norm(x.label) === norm(t.label) || !t.label || !x.label));
}
