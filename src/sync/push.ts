/** Notifications Web Push : abonnement de l'appareil et programmation des rappels d'échéances sur le serveur. */
import { db, DEFAULT_SETTINGS } from '../db/db';
import { Ledger } from '../engine/ledger';
import { pendingOccurrences } from '../engine/recurrence';
import { addDays, parts, today } from '../engine/date';
import type { Snapshot } from '../engine/types';
import { api, getConfig, updateSyncConfig } from './sync';

function urlB64ToBytes(s: string) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("Ce navigateur ne gère pas les notifications. Sur iPhone, installe d'abord FINPILOT sur l'écran d'accueil (iOS 16.4 ou plus).");
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages du navigateur.');
  const { public_key } = await api('/push/vapid/');
  if (!public_key) throw new Error("Le serveur n'a pas de clés VAPID configurées.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(public_key) as BufferSource });
  const c = await getConfig();
  await api('/push/subscribe/', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), device: c?.device }) });
  await updateSyncConfig({ push: true });
  await scheduleReminders();
}

export async function disablePush() {
  if (pushSupported()) {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('/push/subscribe/', { method: 'DELETE', body: JSON.stringify({ subscription: sub.toJSON() }) }).catch(() => {}); await sub.unsubscribe(); }
  }
  await updateSyncConfig({ push: false });
}

async function snapshot(): Promise<Snapshot> {
  const [accounts, txs, rules, occurrences, debts, goals, goalMoves, settings, rates] = await Promise.all([db.accounts.toArray(), db.txs.toArray(), db.rules.toArray(), db.occurrences.toArray(), db.debts.toArray(), db.goals.toArray(), db.goalMoves.toArray(), db.settings.get('main'), db.rates.toArray()]);
  return { accounts, txs, rules, occurrences, debts, goals, goalMoves, cotisations: [], cotisPayments: [], cotisExpenses: [], projects: [], categories: [], budgets: [], wishes: [], scenarios: [], settings: settings ?? DEFAULT_SETTINGS, rates };
}

export interface ReminderItem { key: string; fire_at: string; title: string; body: string }
/** Rappels des 21 prochains jours. Jamais de libellé ni de montant : le serveur ne reçoit qu'un compte. */
export function buildReminders(s: Snapshot, _detailed = false, ref = today()): ReminderItem[] {
  const L = new Ledger(s, ref);
  const occ = pendingOccurrences(L.activeRules(), s.occurrences, ref, addDays(ref, 21), 0, ref).filter((p) => !p.overdue);
  const at = (d: string) => { const { y, m, d: dd } = parts(d); return new Date(y, m - 1, dd, 8, 30).toISOString(); };
  const now = Date.now();
  const items: ReminderItem[] = [];
  const byDay = new Map<string, number>();
  for (const p of occ) {
    if (p.rule.kind === 'income' || p.rule.kind === 'loan_back') continue;
    const lead = p.rule.reminderDays ?? s.settings.reminderDays ?? 3;
    byDay.set(addDays(p.date, -lead), (byDay.get(addDays(p.date, -lead)) ?? 0) + 1);
  }
  for (const [day, n] of byDay) {
    if (Date.parse(at(day)) < now) continue;
    items.push({ key: `g|${day}`, fire_at: at(day), title: 'FINPILOT : échéances à venir', body: `${n} paiement(s) prévu(s) dans les prochains jours. Ouvre l'application pour les détails.` });
  }
  return items.sort((a, b) => a.fire_at.localeCompare(b.fire_at)).slice(0, 200);
}

export async function scheduleReminders() {
  const c = await getConfig();
  if (!c?.push || !c.access) return;
  const items = buildReminders(await snapshot(), false);
  await api('/push/reminders/', { method: 'POST', body: JSON.stringify({ device: c.device, reminders: items }) });
}
