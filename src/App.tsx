import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ArrowLeftRight, Wallet, PiggyBank, Calculator, HandCoins, Users, FolderKanban, CalendarClock, LineChart,
  BarChart3, FileText, Settings as Cog, Compass, MessageCircle, Menu, Plus, CalendarDays, Target, History, Lock, X,
} from 'lucide-react';
import { useData } from './state';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import { cx } from './ui/ui';
import { TxForm } from './ui/forms';
import { LockGate, useLock } from './security/Lock';
import Onboarding from './pages/Onboarding';
import { SyncBadge, SyncManager } from './sync/SyncManager';
import { VoiceProvider, MicButton } from './voice/VoiceAssistant';
import { activeProfile, showPicker } from './db/profiles';
import { Users as UsersIcon, Shield } from 'lucide-react';
import { pendingOccurrences } from './engine/recurrence';
import { addDays, fmtDate } from './engine/date';
import { fmt } from './engine/money';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Budgets = lazy(() => import('./pages/Budgets'));
const Simulations = lazy(() => import('./pages/Simulations'));
const Decision = lazy(() => import('./pages/Decision'));
const Debts = lazy(() => import('./pages/Debts'));
const Savings = lazy(() => import('./pages/Savings'));
const Cotisations = lazy(() => import('./pages/Cotisations'));
const Projects = lazy(() => import('./pages/Projects'));
const Engagements = lazy(() => import('./pages/Engagements'));
const Planning = lazy(() => import('./pages/Planning'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const Analyses = lazy(() => import('./pages/Analyses'));
const Documents = lazy(() => import('./pages/Documents'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Assistant = lazy(() => import('./pages/Assistant'));
const Journal = lazy(() => import('./pages/Journal'));
const Admin = lazy(() => import('./pages/Admin'));

type NavItem = { to: string; label: string; icon: ReactNode };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Pilotage', items: [
    { to: '/', label: 'Tableau de bord', icon: <LayoutDashboard size={18} /> },
    { to: '/decision', label: 'Centre de décision', icon: <Compass size={18} /> },
    { to: '/assistant', label: 'Assistant', icon: <MessageCircle size={18} /> },
  ] },
  { group: 'Opérations', items: [
    { to: '/transactions', label: 'Transactions', icon: <ArrowLeftRight size={18} /> },
    { to: '/comptes', label: 'Comptes', icon: <Wallet size={18} /> },
    { to: '/engagements', label: 'Engagements', icon: <CalendarClock size={18} /> },
    { to: '/calendrier', label: 'Calendrier', icon: <CalendarDays size={18} /> },
  ] },
  { group: 'Anticiper', items: [
    { to: '/simulations', label: 'Simulations', icon: <Calculator size={18} /> },
    { to: '/planification', label: 'Planification', icon: <LineChart size={18} /> },
    { to: '/budgets', label: 'Budgets', icon: <Target size={18} /> },
  ] },
  { group: 'Patrimoine', items: [
    { to: '/dettes', label: 'Dettes & créances', icon: <HandCoins size={18} /> },
    { to: '/epargne', label: 'Épargne', icon: <PiggyBank size={18} /> },
    { to: '/cotisations', label: 'Cotisations', icon: <Users size={18} /> },
    { to: '/projets', label: 'Projets', icon: <FolderKanban size={18} /> },
  ] },
  { group: 'Analyser', items: [
    { to: '/analyses', label: 'Analyses & rapports', icon: <BarChart3 size={18} /> },
    { to: '/documents', label: 'Documents', icon: <FileText size={18} /> },
    { to: '/journal', label: 'Journal des modifications', icon: <History size={18} /> },
    { to: '/parametres', label: 'Paramètres', icon: <Cog size={18} /> },
  ] },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 512 512" className="h-8 w-8"><rect width="512" height="512" rx="112" fill="#0f172a" /><path d="M96 368 L208 256 L272 312 L416 160" fill="none" stroke="#34d399" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" /><circle cx="416" cy="160" r="28" fill="#34d399" /></svg>
      <div className="leading-tight"><div className="text-sm font-bold tracking-wide">FINPILOT</div><div className="text-[10px] text-slate-500">Pilotage financier</div></div>
    </div>
  );
}

function ProfileChip() {
  const p = activeProfile();
  const { s } = useData();
  const name = s.settings.userName || p.name;
  return (
    <button onClick={showPicker} className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-2 py-2 text-left ring-1 ring-slate-200 hover:ring-slate-300 dark:bg-slate-800/60 dark:ring-slate-700" title="Changer de profil">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: p.color }}>{name.trim()[0]?.toUpperCase() ?? '?'}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{name}</span><span className="block truncate text-[11px] text-slate-500">{p.email ?? 'Profil local'} · changer</span></span>
      <UsersIcon size={15} className="text-slate-400" />
    </button>
  );
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { lock } = useLock();
  const sync = useLiveQuery(() => db.meta.get('sync'), []) as { isStaff?: boolean; access?: string } | undefined;
  const isStaff = !!sync?.isStaff && !!sync.access;
  return (
    <nav className="scroll-thin flex h-full flex-col gap-4 overflow-y-auto px-3 py-4">
      <div className="px-2"><Logo /></div>
      <ProfileChip />
      {[...NAV, ...(isStaff ? [{ group: 'Serveur', items: [{ to: '/administration', label: 'Administration', icon: <Shield size={18} /> }] }] : [])].map((g) => (
        <div key={g.group}>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.group}</div>
          {g.items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} onClick={onNavigate}
              className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition', isActive ? 'bg-slate-900 text-white dark:bg-slate-800' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60')}>
              {i.icon}{i.label}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="mt-auto"><SyncBadge /></div>
      <button onClick={lock} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Lock size={18} />Verrouiller</button>
    </nav>
  );
}

function useDueReminders() {
  const { s, L } = useData();
  useEffect(() => {
    if (!s.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    const key = 'finpilot-notified-' + L.ref;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* stockage indisponible */ }
    const due = pendingOccurrences(L.activeRules(), s.occurrences, L.ref, addDays(L.ref, s.settings.reminderDays || 3), 60, L.ref);
    if (!due.length) return;
    const body = due.slice(0, 4).map((p) => `${p.rule.label} : ${fmt(p.remaining, L.accCur(p.rule.accountId))} (${p.overdue ? 'en retard' : fmtDate(p.date, 'day')})`).join('\n');
    try { new Notification(`FINPILOT : ${due.length} échéance(s) à venir`, { body, icon: './icon-192.png' }); } catch { /* */ }
  }, [s.settings.notifications, L.ref]); // eslint-disable-line
}

function Shell() {
  useDueReminders();
  const [menu, setMenu] = useState(false);
  const [add, setAdd] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.key === 'n' || e.key === 'N') && !(e.target as HTMLElement)?.closest('input,textarea,select') && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setAdd(true); } };
    window.addEventListener('keydown', h);
    const q = () => setAdd(true);
    window.addEventListener('finpilot:add', q);
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('finpilot:add', q); };
  }, []);
  const tab = (to: string, label: string, icon: ReactNode) => (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium', isActive ? 'text-slate-900 dark:text-white' : 'text-slate-400')}>{icon}{label}</NavLink>
  );
  return (
    <div className="flex min-h-full">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-60 border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900"><SideNav /></aside>
      {menu && (
        <div className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden" onClick={() => setMenu(false)}>
          <div className="h-full w-72 bg-white dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <button className="absolute right-3 top-3 rounded-lg p-2 text-white" onClick={() => setMenu(false)} aria-label="Fermer"><X /></button>
            <SideNav onNavigate={() => setMenu(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/90">
          <button onClick={() => setMenu(true)} className="rounded-lg p-1.5" aria-label="Menu"><Menu /></button>
          <Logo />
          <div className="flex items-center gap-1"><MicButton className="rounded-lg p-1.5" size={22} /><button onClick={() => nav('/assistant')} className="rounded-lg p-1.5" aria-label="Assistant"><MessageCircle /></button></div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-10 lg:pt-8">
          <Suspense fallback={<div className="py-20 text-center text-sm text-slate-400">Chargement…</div>}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/comptes" element={<Accounts />} />
              <Route path="/budgets" element={<Budgets />} />
              <Route path="/simulations" element={<Simulations />} />
              <Route path="/decision" element={<Decision />} />
              <Route path="/dettes" element={<Debts />} />
              <Route path="/epargne" element={<Savings />} />
              <Route path="/cotisations" element={<Cotisations />} />
              <Route path="/projets" element={<Projects />} />
              <Route path="/engagements" element={<Engagements />} />
              <Route path="/planification" element={<Planning />} />
              <Route path="/calendrier" element={<CalendarPage />} />
              <Route path="/analyses" element={<Analyses />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/journal" element={<Journal />} />
              <Route path="/parametres" element={<SettingsPage />} />
              <Route path="/assistant" element={<Assistant />} />
              <Route path="/administration" element={<Admin />} />
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </Suspense>
        </main>
        <MicButton className="no-print fixed bottom-24 right-7 z-30 hidden h-12 w-12 items-center justify-center rounded-full bg-white text-slate-800 shadow-lg ring-1 ring-slate-200 hover:bg-slate-50 lg:flex dark:bg-slate-800 dark:text-white dark:ring-slate-700" />
        <button onClick={() => setAdd(true)} className="no-print fixed bottom-6 right-6 z-30 hidden h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-800 lg:flex dark:bg-brand-500 dark:text-slate-950" title="Nouvelle opération (N)"><Plus /></button>
        <nav className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/95">
          {tab('/', 'Accueil', <LayoutDashboard size={20} />)}
          {tab('/transactions', 'Opérations', <ArrowLeftRight size={20} />)}
          <button onClick={() => setAdd(true)} className="flex flex-1 items-center justify-center" aria-label="Ajouter"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white shadow dark:bg-brand-500 dark:text-slate-950"><Plus /></span></button>
          {tab('/simulations', 'Simuler', <Calculator size={20} />)}
          {tab('/calendrier', 'Calendrier', <CalendarDays size={20} />)}
        </nav>
      </div>
      <TxForm open={add} onClose={() => setAdd(false)} />
      <SyncManager />
    </div>
  );
}

export default function App() {
  const { s } = useData();
  return (
    <LockGate>
      <HashRouter>{s.settings.onboarded ? <VoiceProvider><Shell /></VoiceProvider> : <Onboarding />}</HashRouter>
    </LockGate>
  );
}
