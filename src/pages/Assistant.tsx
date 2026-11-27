import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Bot } from 'lucide-react';
import { useData } from '../state';
import { Button, Card, PageHeader, cx } from '../ui/ui';
import { ask, type Answer } from '../engine/assistant';
import { MicButton } from '../voice/VoiceAssistant';

const EXAMPLES = [
  'Est-ce que je peux acheter un ordinateur à 1 200 € en janvier ?',
  'Combien dois-je économiser chaque mois pour avoir 2 000 € en juin ?',
  'Quelles sont mes dépenses les plus importantes ce mois-ci ?',
  'Quelle est la meilleure stratégie pour rembourser mes dettes ?',
  'Si je consacre 150 € par mois à mon projet, quel sera son budget dans six mois ?',
  'Combien me restera-t-il à la fin du mois ?',
  'Combien puis-je dépenser ?',
];

function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>))}</>;
}

export default function Assistant() {
  const { L } = useData();
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState<{ role: 'user' | 'bot'; text?: string; a?: Answer }[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  const send = (text: string) => {
    if (!text.trim()) return;
    const a = ask(L, text);
    setMsgs((m) => [...m, { role: 'user', text }, { role: 'bot', a }]);
    setQ('');
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Assistant financier" subtitle="Pose une question en français : les réponses sont calculées par le moteur financier à partir de tes données réelles, sans rien inventer." />
      <Card pad={false} className="flex min-h-[60vh] flex-col">
        <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {!msgs.length && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-slate-500"><Bot size={18} />Exemples de questions :</div>
              <div className="flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} onClick={() => send(e)} className="rounded-full bg-slate-100 px-3 py-1.5 text-left text-sm hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700">{e}</button>)}</div>
            </div>
          )}
          {msgs.map((m, i) => m.role === 'user' ? (
            <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-slate-900 px-4 py-2.5 text-sm text-white dark:bg-brand-500 dark:text-slate-950">{m.text}</div></div>
          ) : (
            <div key={i} className="flex gap-2.5">
              <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"><Bot size={15} /></div>
              <div className={cx('max-w-[90%] space-y-1.5 rounded-2xl rounded-tl-md px-4 py-3 text-sm ring-1', m.a?.level === 'risque' ? 'bg-rose-50 ring-rose-100 dark:bg-rose-500/10 dark:ring-rose-500/20' : m.a?.level === 'tendu' ? 'bg-amber-50 ring-amber-100 dark:bg-amber-500/10 dark:ring-amber-500/20' : 'bg-slate-50 ring-slate-100 dark:bg-slate-800/60 dark:ring-slate-700')}>
                {m.a?.text.map((t, j) => <p key={j}><Rich text={t} /></p>)}
                {m.a?.actions?.length ? <div className="flex flex-wrap gap-2 pt-1">{m.a.actions.map((x) => <Link key={x.to} to={x.to} className="text-xs font-medium text-brand-600 hover:underline">{x.label} →</Link>)}</div> : null}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
        <form className="flex gap-2 border-t border-slate-100 p-3 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); send(q); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. Puis-je acheter un téléphone à 900 € le 15 décembre ?" className="h-11 flex-1 rounded-xl bg-slate-100 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-slate-800" />
          <MicButton className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200" size={18} />
          <Button variant="primary" className="h-11" icon={<Send size={16} />} type="submit">Envoyer</Button>
        </form>
      </Card>
    </div>
  );
}
