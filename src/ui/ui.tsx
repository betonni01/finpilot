import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { X, AlertTriangle, CheckCircle2, Info, AlertOctagon } from 'lucide-react';
import { fmt, parseAmount, toMajor, toMinor, CURRENCIES } from '../engine/money';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------- Boutons
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
export function Button({ variant = 'secondary', size = 'md', className, icon, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; icon?: ReactNode }) {
  const v: Record<BtnVariant, string> = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-brand-500 dark:text-slate-950 dark:hover:bg-brand-400',
    secondary: 'bg-white text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
    danger: 'bg-rose-600 text-white hover:bg-rose-500',
    soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-400 dark:hover:bg-brand-500/20',
  };
  return (
    <button {...p} className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500', size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-10 px-3.5 text-sm', v[variant], className)}>
      {icon}{children}
    </button>
  );
}

// ---------------------------------------------------------------- Cartes
export function Card({ className, children, title, action, subtitle, pad = true }: { className?: string; children?: ReactNode; title?: ReactNode; action?: ReactNode; subtitle?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx('print-area rounded-2xl bg-white ring-1 ring-slate-200/80 shadow-sm dark:bg-slate-900 dark:ring-slate-800', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          {action && <div className="no-print flex flex-wrap items-center gap-1.5">{action}</div>}
        </header>
      )}
      <div className={pad ? 'p-4 sm:p-5' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'default', icon, onClick }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn' | 'brand'; icon?: ReactNode; onClick?: () => void }) {
  const t = { default: '', good: 'text-emerald-600 dark:text-emerald-400', bad: 'text-rose-600 dark:text-rose-400', warn: 'text-amber-600 dark:text-amber-400', brand: 'text-slate-900 dark:text-white' }[tone];
  return (
    <div onClick={onClick} className={cx('rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 shadow-sm dark:bg-slate-900 dark:ring-slate-800', onClick && 'cursor-pointer hover:ring-slate-300 dark:hover:ring-slate-700')}>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-500 dark:text-slate-400"><span className="truncate">{label}</span>{icon}</div>
      <div className={cx('num mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl', t)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}

export function Money({ v, cur, sign, className, colored }: { v: number; cur: string; sign?: boolean; className?: string; colored?: boolean }) {
  return <span className={cx('num whitespace-nowrap', colored && (v < 0 ? 'text-rose-600 dark:text-rose-400' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''), className)}>{fmt(v, cur, { sign })}</span>;
}

export function Badge({ children, tone = 'slate', className }: { children: ReactNode; tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'violet'; className?: string }) {
  const t = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    red: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400', amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    blue: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400', violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', t, className)}>{children}</span>;
}

export function Progress({ value, tone }: { value: number; tone?: 'auto' | 'brand' }) {
  const pct = Math.max(0, Math.min(1, value));
  const color = tone === 'brand' ? 'bg-brand-500' : value >= 1 ? 'bg-rose-500' : value >= 0.9 ? 'bg-orange-500' : value >= 0.75 ? 'bg-amber-400' : 'bg-brand-500';
  return <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${pct * 100}%` }} /></div>;
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-slate-300 dark:text-slate-600">{icon}</div>}
      <p className="font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {text && <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cx('scroll-thin inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-900 dark:ring-1 dark:ring-slate-800', className)}>
      {items.map((i) => (
        <button key={i.value} onClick={() => onChange(i.value)} className={cx('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition', value === i.value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200')}>{i.label}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Formulaires
export function Field({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}
const inputCls = 'h-10 w-full rounded-lg border-0 bg-white px-3 text-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-slate-950 dark:ring-slate-700';
export function Input(p: InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={cx(inputCls, p.className)} />; }
export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...p} className={cx(inputCls, 'h-auto min-h-[72px] py-2', p.className)} />; }
export function Select({ options, className, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string; group?: string }[] }) {
  const groups = [...new Set(options.map((o) => o.group).filter(Boolean))] as string[];
  return (
    <select {...p} className={cx(inputCls, 'pr-8', className)}>
      {groups.length ? (
        <>
          {options.filter((o) => !o.group).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {groups.map((g) => <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>)}
        </>
      ) : options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-sm">
      <span className={cx('relative h-6 w-10 rounded-full transition', checked ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-700')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      {label && <span className="text-slate-700 dark:text-slate-300">{label}</span>}
    </button>
  );
}

/** Saisie de montant : affiche des unités majeures, renvoie des unités mineures. */
export function MoneyInput({ value, onChange, currency, placeholder, autoFocus, allowNegative }: { value: number | null; onChange: (minor: number | null) => void; currency: string; placeholder?: string; autoFocus?: boolean; allowNegative?: boolean }) {
  const [txt, setTxt] = useState(value == null ? '' : String(toMajor(value, currency)).replace('.', ','));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) { setTxt(value == null ? '' : String(toMajor(value, currency)).replace('.', ',')); last.current = value; }
  }, [value, currency]);
  return (
    <div className="relative">
      <input inputMode="decimal" autoFocus={autoFocus} placeholder={placeholder ?? '0'} className={cx(inputCls, 'num pr-14 text-right')} value={txt}
        onChange={(e) => {
          setTxt(e.target.value);
          const n = parseAmount(e.target.value);
          const v = e.target.value.trim() === '' || !Number.isFinite(n) ? null : toMinor(allowNegative ? n : Math.abs(n), currency);
          last.current = v; onChange(v);
        }} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">{currency}</span>
    </div>
  );
}
export const currencyOptions = Object.entries(CURRENCIES).map(([k, v]) => ({ value: k, label: `${k} · ${v.name}` }));

// ---------------------------------------------------------------- Modale
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true">
      <div className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl dark:bg-slate-900 dark:ring-1 dark:ring-slate-800 sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="safe-bottom flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Notifications et confirmations
type ToastT = { id: number; text: string; tone: 'ok' | 'err' | 'info' };
type ConfirmT = { title: string; text?: string; danger?: boolean; confirmLabel?: string; typed?: string; resolve: (v: boolean) => void };
const UICtx = createContext<{ toast: (t: string, tone?: ToastT['tone']) => void; confirm: (o: Omit<ConfirmT, 'resolve'>) => Promise<boolean> } | null>(null);
export const useUI = () => useContext(UICtx)!;

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastT[]>([]);
  const [c, setC] = useState<ConfirmT | null>(null);
  const [typed, setTyped] = useState('');
  const toast = useCallback((text: string, tone: ToastT['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const confirm = useCallback((o: Omit<ConfirmT, 'resolve'>) => new Promise<boolean>((resolve) => { setTyped(''); setC({ ...o, resolve }); }), []);
  const close = (v: boolean) => { c?.resolve(v); setC(null); };
  return (
    <UICtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm shadow-lg', t.tone === 'err' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white dark:bg-white dark:text-slate-900')}>
            {t.tone === 'err' ? <AlertOctagon size={16} /> : t.tone === 'info' ? <Info size={16} /> : <CheckCircle2 size={16} />}{t.text}
          </div>
        ))}
      </div>
      <Modal open={!!c} onClose={() => close(false)} title={c?.title ?? ''} footer={<>
        <Button variant="ghost" onClick={() => close(false)}>Annuler</Button>
        <Button variant={c?.danger ? 'danger' : 'primary'} disabled={!!c?.typed && typed !== c.typed} onClick={() => close(true)}>{c?.confirmLabel ?? 'Confirmer'}</Button>
      </>}>
        <div className="flex gap-3">
          {c?.danger && <AlertTriangle className="mt-0.5 shrink-0 text-rose-500" size={20} />}
          <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
            {c?.text && <p>{c.text}</p>}
            {c?.typed && <Field label={<>Tape <b>{c.typed}</b> pour confirmer</>}><Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></Field>}
          </div>
        </div>
      </Modal>
    </UICtx.Provider>
  );
}

export function LevelBadge({ level }: { level: 'ok' | 'tendu' | 'risque' | null | undefined }) {
  if (!level) return <Badge tone="slate">Non finançable</Badge>;
  return level === 'ok' ? <Badge tone="green">🟢 Raisonnable</Badge> : level === 'tendu' ? <Badge tone="amber">🟠 Tendu</Badge> : <Badge tone="red">🔴 Risqué</Badge>;
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx('scroll-thin overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-100 text-left text-xs text-slate-500 dark:border-slate-800">{head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-medium first:pl-0 last:pr-0">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{children}</tbody>
      </table>
    </div>
  );
}
export const td = 'px-3 py-2.5 first:pl-0 last:pr-0 align-middle';

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
