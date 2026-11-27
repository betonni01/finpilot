import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mic, Square, Send, Check, X, Pencil, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { useData } from '../state';
import { Button, Modal, cx, useUI, Badge } from '../ui/ui';
import { TxForm } from '../ui/forms';
import { ask, type Answer } from '../engine/assistant';
import { parseConfirm, parseVoice, type VoiceIntent } from '../engine/voice';
import { findDuplicate } from '../engine/insights';
import { fmt } from '../engine/money';
import { fmtDate } from '../engine/date';
import { convertBetween, createDebt, newTx, recordDebtPayment, save } from '../db/repo';
import { uid } from '../db/db';
import { getVoicePrefs, listen, micSupported, speak, stopSpeaking, toSpoken, type Listener, type VoicePrefs } from './speech';
import type { Tx } from '../engine/types';

const Ctx = createContext<{ open: (text?: string) => void; supported: boolean }>({ open: () => {}, supported: false });
export const useVoice = () => useContext(Ctx);

type Phase = 'idle' | 'listening' | 'processing' | 'confirm' | 'answer' | 'error';

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [openState, setOpen] = useState<{ n: number; text?: string } | null>(null);
  const open = useCallback((text?: string) => setOpen((o) => ({ n: (o?.n ?? 0) + 1, text })), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.key === 'v' || e.key === 'V') && !(e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); open(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);
  return (
    <Ctx.Provider value={{ open, supported: micSupported() }}>
      {children}
      {openState && <VoiceSheet key={openState.n} initialText={openState.text} onClose={() => setOpen(null)} />}
    </Ctx.Provider>
  );
}

export function MicButton({ className, size = 20, label }: { className?: string; size?: number; label?: string }) {
  const { open } = useVoice();
  return <button onClick={() => open()} className={className} aria-label="Assistant vocal" title="Assistant vocal (V)"><Mic size={size} />{label}</button>;
}

interface Pending { intent: Extract<VoiceIntent, { type: 'tx' | 'debt' | 'transfer' }>; lines: { k: string; v: string }[]; title: string; warning?: string; blocked?: string }

function VoiceSheet({ onClose, initialText }: { onClose: () => void; initialText?: string }) {
  const { s, L, main } = useData();
  const ui = useUI();
  const nav = useNavigate();
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [text, setText] = useState('');
  const [partial, setPartial] = useState('');
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [edit, setEdit] = useState<Partial<Tx> | null>(null);
  const [muted, setMuted] = useState(false);
  const listener = useRef<Listener | null>(null);
  const confirmMode = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const say = useCallback(async (t: string) => { if (prefs?.speak && !muted) await speak(t, prefs); }, [prefs, muted]);
  const accName = (id?: string) => s.accounts.find((a) => a.id === id)?.name ?? 'non précisé';
  const catName = (id?: string) => s.categories.find((c) => c.id === id)?.name ?? 'sans catégorie';

  // ---------------------------------------------------------------- écoute
  const start = useCallback((forConfirm = false) => {
    if (!prefs) return;
    stopSpeaking();
    listener.current?.abort();
    confirmMode.current = forConfirm;
    setErr(''); setPartial('');
    if (!forConfirm) { setAnswer(null); setPending(null); }
    listener.current = listen(prefs, {
      onPartial: setPartial,
      onState: (st) => { if (st === 'listening' || st === 'processing') setPhase(st); },
      onLevel: setLevel,
      onFinal: (t) => { setPartial(''); if (confirmMode.current) handleConfirm(t); else { setText(t); handle(t); } },
      onError: (m) => { if (!m) return; if (confirmMode.current && pendingRef.current) { setPhase('confirm'); return; } setErr(m); setPhase('error'); },
    });
  }, [prefs]); // eslint-disable-line

  useEffect(() => { getVoicePrefs().then(setPrefs); return () => { listener.current?.abort(); stopSpeaking(); }; }, []);
  useEffect(() => {
    if (!prefs) return;
    if (initialText) { setText(initialText); handle(initialText); }
    else if (micSupported()) start();
    else { setErr("La reconnaissance vocale n'est pas disponible ici : écris ta demande ci-dessous."); setPhase('error'); }
  }, [prefs]); // eslint-disable-line

  // ---------------------------------------------------------------- compréhension
  function describe(i: Pending['intent']): Pending {
    const amt = fmt(i.amount, i.currency);
    if (i.type === 'tx') {
      const acc = s.accounts.find((a) => a.id === i.accountId);
      const dup = acc ? findDuplicate(s.txs, { id: '', accountId: acc.id, amount: i.amount, date: i.date, label: i.label }) : undefined;
      return {
        intent: i, title: i.kind === 'income' ? 'Nouveau revenu' : 'Nouvelle dépense',
        lines: [{ k: 'Montant', v: amt }, { k: 'Libellé', v: i.label }, { k: 'Catégorie', v: catName(i.categoryId) }, { k: 'Compte', v: accName(i.accountId) }, { k: 'Date', v: fmtDate(i.date, 'long') }, ...(i.payee ? [{ k: i.kind === 'income' ? 'Source' : 'Bénéficiaire', v: i.payee }] : [])],
        warning: dup ? `Une opération identique existe déjà le ${fmtDate(dup.date)} (${dup.label}).` : undefined,
        blocked: !acc ? 'Aucun compte : crée d\'abord un compte.' : undefined,
      };
    }
    if (i.type === 'debt') {
      const t = { repay: 'Remboursement d\'une dette', received: 'Remboursement reçu', lend: 'Nouveau prêt accordé', borrow: 'Nouvel emprunt' }[i.action];
      const debt = s.debts.find((d) => d.id === i.debtId);
      return {
        intent: i, title: t,
        lines: [{ k: 'Montant', v: amt }, { k: 'Personne', v: i.person }, { k: 'Compte', v: accName(i.accountId) }, { k: 'Date', v: fmtDate(i.date, 'long') }, ...(debt ? [{ k: 'Reste dû avant', v: fmt(L.debtRemaining(debt), debt.currency) }] : [])],
        blocked: (i.action === 'repay' || i.action === 'received') && !debt ? `Aucune ${i.action === 'repay' ? 'dette envers' : 'créance sur'} « ${i.person} » n'est enregistrée. Crée-la dans Dettes et créances.` : !i.accountId ? 'Aucun compte disponible.' : undefined,
      };
    }
    return {
      intent: i, title: i.label,
      lines: [{ k: 'Montant', v: amt }, { k: 'Depuis', v: accName(i.fromId) }, { k: 'Vers', v: accName(i.toId) }, { k: 'Date', v: fmtDate(i.date, 'long') }],
      blocked: !i.fromId || !i.toId ? 'Précise les deux comptes (bouton Modifier).' : undefined,
    };
  }

  async function handle(raw: string) {
    const t = raw.trim();
    if (!t) return;
    setPhase('processing');
    const intent = parseVoice(t, { accounts: s.accounts, categories: s.categories, debts: s.debts, main, ref: L.ref });
    if (intent.type === 'nav') { setPhase('idle'); await say(`J'ouvre ${intent.label}.`); nav(intent.to); onClose(); return; }
    if (intent.type === 'simulate') {
      setPhase('idle');
      await say(`Je simule ${intent.label} à ${toSpoken([fmt(intent.amount, intent.currency)])}.`);
      nav(`/simulations?objet=${encodeURIComponent(intent.label)}&prix=${intent.amount}${intent.installments ? `&fois=${intent.installments}` : ''}`); onClose(); return;
    }
    if (intent.type === 'incomplete') { setErr(`Il me manque ${intent.missing}. Peux-tu répéter avec ${intent.missing} ?`); setPhase('error'); await say(`Il me manque ${intent.missing}.`); return; }
    if (intent.type === 'question') {
      const a = ask(L, t);
      setAnswer(a); setPhase('answer');
      // on lit l'essentiel : le verdict ou le chiffre clé (et le point bas pour un achat)
      const first = a.text[0] ?? '';
      await say(toSpoken(/^\*\*[🟢🟠🔴]/u.test(first) ? a.text.slice(0, 2) : [first]));
      return;
    }
    const p = describe(intent);
    setPending(p); setPhase('confirm');
    if (p.blocked) { await say(p.blocked); return; }
    const spoken = `${p.title} : ${p.lines.filter((l) => ['Montant', 'Libellé', 'Personne', 'Compte', 'Catégorie', 'Vers'].includes(l.k)).map((l) => `${l.k.toLowerCase()} ${l.v}`).join(', ')}.${p.warning ? ' Attention, doublon possible.' : ''} Je confirme ?`;
    await say(toSpoken([spoken]));
    if (prefs?.vocalConfirm && micSupported()) start(true);
  }

  async function handleConfirm(t: string) {
    const c = parseConfirm(t);
    if (c === true) return execute();
    if (c === false) { setPending(null); setPhase('idle'); await say('Annulé.'); return; }
    // nouvelle demande au lieu d'une confirmation
    setText(t); handle(t);
  }

  async function execute() {
    const p = pendingRef.current;
    if (!p || p.blocked) return;
    listener.current?.abort();
    const i = p.intent;
    try {
      if (i.type === 'tx') {
        const cur = s.accounts.find((a) => a.id === i.accountId)!.currency;
        const amount = await convertBetween(i.amount, i.currency, cur);
        await save('txs', newTx({ kind: i.kind, amount, accountId: i.accountId!, date: i.date, label: i.label, categoryId: i.categoryId, payee: i.payee, method: i.method, notes: i.currency !== cur ? `Dicté : ${fmt(i.amount, i.currency)}` : undefined }), `Opération dictée : ${i.label}`);
      } else if (i.type === 'debt') {
        const accCur = s.accounts.find((a) => a.id === i.accountId)?.currency ?? main;
        if (i.action === 'repay' || i.action === 'received') {
          const d = s.debts.find((x) => x.id === i.debtId)!;
          await recordDebtPayment(d, await convertBetween(i.amount, i.currency, accCur), i.accountId!, i.date, 'Saisi à la voix');
        } else {
          await createDebt({ id: uid(), direction: i.action === 'lend' ? 'creance' : 'dette', person: i.person, initialAmount: i.amount, currency: i.currency, createdAt: i.date, priority: 2, archived: false }, i.accountId ? { accountId: i.accountId, date: i.date } : undefined);
        }
      } else {
        const fc = s.accounts.find((a) => a.id === i.fromId)!.currency, tc = s.accounts.find((a) => a.id === i.toId)!.currency;
        await save('txs', newTx({ kind: 'transfer', amount: await convertBetween(i.amount, i.currency, fc), accountId: i.fromId!, toAccountId: i.toId, toAmount: await convertBetween(i.amount, i.currency, tc), date: i.date, label: i.label }), `Transfert dicté`);
      }
      ui.toast('Enregistré');
      setPending(null); setPhase('idle');
      await say("C'est enregistré.");
      if (prefs?.continuous && micSupported()) start(); else onClose();
    } catch (e) { setErr((e as Error).message); setPhase('error'); }
  }

  function openEditor() {
    const p = pendingRef.current;
    if (!p) return;
    const i = p.intent;
    listener.current?.abort(); stopSpeaking();
    if (i.type === 'tx') setEdit({ kind: i.kind, amount: i.amount, accountId: i.accountId, date: i.date, label: i.label, categoryId: i.categoryId, payee: i.payee, method: i.method });
    else if (i.type === 'transfer') setEdit({ kind: 'transfer', amount: i.amount, accountId: i.fromId, toAccountId: i.toId, date: i.date, label: i.label });
    else setEdit({ kind: i.action === 'repay' ? 'debt_repay' : i.action === 'received' ? 'loan_back' : i.action === 'lend' ? 'loan_out' : 'debt_borrow', amount: i.amount, accountId: i.accountId, date: i.date, debtId: i.debtId, payee: i.person, label: p.title });
  }

  const listening = phase === 'listening';
  return (
    <>
      <Modal open={!edit} onClose={() => { listener.current?.abort(); stopSpeaking(); onClose(); }} title={<span className="flex items-center gap-2"><Mic size={18} />Assistant vocal{prefs && <Badge tone="slate">{prefs.engine === 'local' ? 'privé, sur l\'appareil' : prefs.engine === 'browser' ? 'navigateur' : 'automatique'}</Badge>}</span>}>
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 py-2">
            <button onClick={() => (listening ? listener.current?.stop() : start(phase === 'confirm'))} disabled={phase === 'processing' || !micSupported()}
              className={cx('relative flex h-20 w-20 items-center justify-center rounded-full text-white shadow-lg transition', listening ? 'bg-rose-500' : 'bg-slate-900 dark:bg-brand-500 dark:text-slate-950', phase === 'processing' && 'opacity-60')} aria-label={listening ? 'Arrêter' : 'Parler'}>
              {listening && <span className="absolute inset-0 animate-ping rounded-full bg-rose-400/40" style={{ transform: `scale(${1 + level * 0.6})` }} />}
              {listening ? <Square size={26} /> : <Mic size={30} />}
            </button>
            <div className="min-h-5 text-center text-sm text-slate-500">
              {listening ? (confirmMode.current ? 'Dis « oui » pour confirmer ou « non » pour annuler…' : 'Je t\'écoute…') : phase === 'processing' ? 'Je réfléchis…' : phase === 'confirm' ? 'Vérifie puis confirme' : 'Touche le micro pour parler'}
            </div>
            {partial && <p className="text-center text-base italic text-slate-700 dark:text-slate-200">« {partial} »</p>}
          </div>

          {err && <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{err}</div>}

          {pending && (
            <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
              <div className="border-b border-slate-100 px-4 py-2.5 font-medium dark:border-slate-800">{pending.title}</div>
              <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{pending.lines.map((l) => <div key={l.k} className="flex justify-between gap-3 px-4 py-2"><dt className="text-slate-500">{l.k}</dt><dd className="text-right font-medium">{l.v}</dd></div>)}</dl>
              {pending.warning && <p className="px-4 pb-2 text-xs text-amber-700 dark:text-amber-300">{pending.warning}</p>}
              {pending.blocked && <p className="px-4 pb-2 text-xs text-rose-600">{pending.blocked}</p>}
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                <Button variant="ghost" icon={<X size={15} />} onClick={() => { listener.current?.abort(); setPending(null); setPhase('idle'); }}>Annuler</Button>
                <Button icon={<Pencil size={15} />} onClick={openEditor}>Modifier</Button>
                <Button variant="primary" icon={<Check size={15} />} disabled={!!pending.blocked} onClick={execute}>Confirmer</Button>
              </div>
            </div>
          )}

          {answer && (
            <div className="space-y-1.5 rounded-xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-800/60">
              {answer.text.map((l, j) => <p key={j}>{l.split(/(\*\*[^*]+\*\*)/g).map((x, k) => (x.startsWith('**') ? <b key={k}>{x.slice(2, -2)}</b> : <span key={k}>{x}</span>))}</p>)}
              {answer.actions?.length ? <div className="flex flex-wrap gap-3 pt-1">{answer.actions.map((a) => <Link key={a.to} to={a.to} onClick={onClose} className="text-xs font-medium text-brand-600 hover:underline">{a.label} →</Link>)}</div> : null}
            </div>
          )}

          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); listener.current?.abort(); handle(text); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="…ou écris ta demande" className="h-10 flex-1 rounded-lg bg-slate-100 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-slate-800" />
            <Button type="submit" icon={<Send size={15} />} aria-label="Envoyer" />
            <Button type="button" variant="ghost" icon={muted ? <VolumeX size={15} /> : <Volume2 size={15} />} onClick={() => { setMuted(!muted); stopSpeaking(); }} aria-label={muted ? 'Activer la voix' : 'Couper la voix'} />
          </form>
          {phase === 'error' && micSupported() && <div className="flex justify-center"><Button size="sm" variant="soft" icon={<RotateCcw size={14} />} onClick={() => start()}>Réessayer</Button></div>}
          {!pending && !answer && <Examples onPick={(t) => { setText(t); handle(t); }} />}
        </div>
      </Modal>
      <TxForm open={!!edit} onClose={() => { setEdit(null); onClose(); }} initial={edit ?? undefined} />
    </>
  );
}

function Examples({ onPick }: { onPick: (t: string) => void }) {
  const ex = ["J'ai payé 12 euros 50 de courses chez Lidl", "J'ai reçu mon salaire de 1 200 euros", "J'ai remboursé 50 euros à Koffi", "J'ai retiré 60 euros", 'Combien me reste-t-il à la fin du mois ?', 'Simule un téléphone à 900 euros en 3 fois', 'Ouvre mes dettes'];
  return (
    <div>
      <div className="mb-1.5 text-xs text-slate-500">Exemples (touche pour essayer) :</div>
      <div className="flex flex-wrap gap-1.5">{ex.map((e) => <button key={e} onClick={() => onPick(e)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700">{e}</button>)}</div>
    </div>
  );
}
