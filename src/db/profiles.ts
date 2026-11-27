/**
 * Profils locaux : chaque personne utilisant l'appareil a sa propre base IndexedDB,
 * son propre code PIN, son propre coffre et son propre compte en ligne.
 * Le registre (noms des profils uniquement) est conservé dans localStorage.
 */
export interface Profile { id: string; name: string; dbName: string; color: string; createdAt: string; lastUsedAt?: string; email?: string | null }

const REG = 'finpilot.profiles';
const ACTIVE = 'finpilot.activeProfile';
const CHOSEN = 'finpilot.profileChosen';
const COLORS = ['#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6', '#ef4444', '#6366f1'];
const memory: Record<string, string> = {};

const ls = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return memory[k] ?? null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { memory[k] = v; } },
};
const ss = {
  get(k: string) { try { return sessionStorage.getItem(k); } catch { return memory['s:' + k] ?? null; } },
  set(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { memory['s:' + k] = v; } },
  del(k: string) { try { sessionStorage.removeItem(k); } catch { delete memory['s:' + k]; } },
};

export function listProfiles(): Profile[] {
  let list: Profile[] = [];
  try { list = JSON.parse(ls.get(REG) || '[]'); } catch { list = []; }
  if (!list.length) {
    // première ouverture, ou base créée avant l'arrivée des profils : on la reprend telle quelle
    list = [{ id: 'default', name: 'Mon profil', dbName: 'finpilot', color: COLORS[0], createdAt: new Date().toISOString() }];
    ls.set(REG, JSON.stringify(list));
  }
  return list;
}
function saveProfiles(list: Profile[]) { ls.set(REG, JSON.stringify(list)); }

export function activeProfile(): Profile {
  const list = listProfiles();
  const id = ls.get(ACTIVE);
  return list.find((p) => p.id === id) ?? list[0];
}
export function updateProfile(id: string, patch: Partial<Profile>) {
  saveProfiles(listProfiles().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}
export function createProfile(name: string): Profile {
  const list = listProfiles();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const p: Profile = { id, name: name.trim() || `Profil ${list.length + 1}`, dbName: `finpilot-${id}`, color: COLORS[list.length % COLORS.length], createdAt: new Date().toISOString() };
  saveProfiles([...list, p]);
  return p;
}
export async function deleteProfile(id: string) {
  const list = listProfiles();
  const p = list.find((x) => x.id === id);
  if (!p) return;
  await new Promise<void>((res) => { const r = indexedDB.deleteDatabase(p.dbName); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  const rest = list.filter((x) => x.id !== id);
  saveProfiles(rest);
  if (ls.get(ACTIVE) === id) ls.set(ACTIVE, rest[0]?.id ?? '');
}

/** Ouvre un profil : nécessite un rechargement, car chaque profil a sa propre base. */
export function switchTo(id: string) {
  ls.set(ACTIVE, id);
  updateProfile(id, { lastUsedAt: new Date().toISOString() });
  ss.set(CHOSEN, id);
  ss.del('finpilot.forcePicker');
  location.reload();
}
/** Le sélecteur s'affiche quand plusieurs profils existent et qu'aucun n'a été choisi dans cette session. */
export function needsPicker() { return ss.get('finpilot.forcePicker') === '1' || (listProfiles().length > 1 && ss.get(CHOSEN) !== activeProfile().id); }
export function markChosen() { ss.del('finpilot.forcePicker'); ss.set(CHOSEN, activeProfile().id); updateProfile(activeProfile().id, { lastUsedAt: new Date().toISOString() }); }
export function showPicker() { ss.del(CHOSEN); ss.set('finpilot.forcePicker', '1'); location.reload(); }
