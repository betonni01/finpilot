import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Upload, Search, FileText, Image as ImageIcon, Download, Archive, Trash2, Eye, Link2 } from 'lucide-react';
import { db } from '../db/db';
import { addDoc, remove, save } from '../db/repo';
import { docBlob } from '../db/vault';
import { useData } from '../state';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Toggle, useUI, download } from '../ui/ui';
import { fmtDate } from '../engine/date';
import { fmt } from '../engine/money';
import type { DocFile } from '../engine/types';

const CATS = ['Factures', 'Reçus', 'Contrats', 'Preuves de virement', 'Reconnaissances de dette', 'Documents de financement', 'Devis', 'Justificatifs', 'Revenus', 'Autre'];
function guess(name: string) {
  const n = name.toLowerCase();
  if (/factur|invoice/.test(n)) return 'Factures';
  if (/re[cç]u|ticket|receipt/.test(n)) return 'Reçus';
  if (/contrat|bail|contract/.test(n)) return 'Contrats';
  if (/virement|transfer|preuve/.test(n)) return 'Preuves de virement';
  if (/dette|reconnaiss/.test(n)) return 'Reconnaissances de dette';
  if (/devis|quote/.test(n)) return 'Devis';
  if (/subvention|financement|pret|prêt/.test(n)) return 'Documents de financement';
  if (/bulletin|salaire|paie/.test(n)) return 'Revenus';
  return 'Justificatifs';
}
const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1e3))} Ko`);

export default function Documents() {
  const { s, L } = useData();
  const ui = useUI();
  const docs = useLiveQuery(() => db.docs.toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [arch, setArch] = useState(false);
  const [view, setView] = useState<DocFile | null>(null);
  const [link, setLink] = useState<DocFile | null>(null);
  const list = useMemo(() => docs.filter((d) => (arch || !d.archived) && (!cat || d.category === cat) && (!q || `${d.name} ${d.notes ?? ''} ${linkLabel(d)}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [docs, q, cat, arch]); // eslint-disable-line
  function linkLabel(d: DocFile) {
    if (!d.linkId) return '';
    if (d.linkType === 'tx') { const t = s.txs.find((x) => x.id === d.linkId); return t ? `${t.label} · ${fmtDate(t.date)} · ${fmt(t.amount, L.accCur(t.accountId))}` : 'opération supprimée'; }
    if (d.linkType === 'debt') return s.debts.find((x) => x.id === d.linkId)?.person ?? '';
    if (d.linkType === 'project') return s.projects.find((x) => x.id === d.linkId)?.name ?? '';
    return '';
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) await addDoc(f, guess(f.name));
    ui.toast(`${files.length} document(s) importé(s) et classé(s)`);
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Documents et justificatifs" subtitle="Factures, reçus, contrats, preuves de virement, reconnaissances de dette, devis. Stockés sur cet appareil et inclus dans les sauvegardes."
        actions={<label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-sm font-medium text-white hover:bg-slate-800 dark:bg-brand-500 dark:text-slate-950"><Upload size={16} />Importer (PDF, photo)<input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => upload(e.target.files)} /></label>} />
      <Card>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="relative"><Search size={16} className="absolute left-3 top-3 text-slate-400" /><Input className="pl-9" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: 'Toutes les catégories' }, ...CATS.map((c) => ({ value: c, label: c }))]} />
          <div className="flex items-center"><Toggle checked={arch} onChange={setArch} label="Afficher les archives" /></div>
        </div>
      </Card>
      {!list.length ? <Card><Empty icon={<FileText size={36} />} title="Aucun document" text="Importe un PDF ou prends une photo d'un reçu. Tu peux aussi joindre un justificatif directement à une opération." /></Card> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((d) => (
            <div key={d.id} className={`flex gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800 ${d.archived ? 'opacity-60' : ''}`}>
              <Thumb d={d} onClick={() => setView(d)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" title={d.name}>{d.name}</div>
                <div className="text-xs text-slate-500">{fmtDate(d.createdAt.slice(0, 10))} · {size(d.size)}</div>
                <Select className="mt-1 h-7 text-xs" value={d.category} onChange={(e) => save('docs', { ...d, category: e.target.value }, 'Document reclassé')} options={CATS.map((c) => ({ value: c, label: c }))} />
                {d.linkId && <div className="mt-1 truncate text-[11px] text-slate-500"><Link2 size={11} className="mr-0.5 inline" />{linkLabel(d)}</div>}
                <div className="mt-1.5 flex gap-1">
                  <button className="rounded p-1 text-slate-400 hover:text-slate-700" title="Voir" onClick={() => setView(d)}><Eye size={15} /></button>
                  <button className="rounded p-1 text-slate-400 hover:text-slate-700" title="Télécharger" onClick={async () => download(await docBlob(d), d.name)}><Download size={15} /></button>
                  <button className="rounded p-1 text-slate-400 hover:text-slate-700" title="Associer à une opération" onClick={() => setLink(d)}><Link2 size={15} /></button>
                  <button className="rounded p-1 text-slate-400 hover:text-slate-700" title={d.archived ? 'Désarchiver' : 'Archiver'} onClick={() => save('docs', { ...d, archived: !d.archived }, d.archived ? 'Document désarchivé' : 'Document archivé')}><Archive size={15} /></button>
                  <button className="rounded p-1 text-slate-400 hover:text-rose-600" title="Supprimer" onClick={async () => { if (await ui.confirm({ title: 'Supprimer ce document ?', text: d.name, danger: true })) await remove('docs', d.id, 'Document supprimé'); }}><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {view && <Preview d={view} onClose={() => setView(null)} />}
      {link && <LinkForm d={link} onClose={() => setLink(null)} />}
      <p className="text-xs text-slate-500">{docs.length} document(s), {size(docs.reduce((a, d) => a + d.size, 0))} au total.</p>
    </div>
  );
}

function Thumb({ d, onClick }: { d: DocFile; onClick: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (!d.mime.startsWith('image/')) return; let u = ''; let off = false; docBlob(d).then((b) => { if (off) return; u = URL.createObjectURL(b); setUrl(u); }).catch(() => {}); return () => { off = true; if (u) URL.revokeObjectURL(u); }; }, [d]);
  return <button onClick={onClick} className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">{url ? <img src={url} alt="" className="h-full w-full object-cover" /> : d.mime === 'application/pdf' ? <FileText className="text-rose-500" /> : <ImageIcon className="text-slate-400" />}</button>;
}

function Preview({ d, onClose }: { d: DocFile; onClose: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let u = ''; let off = false; docBlob(d).then((b) => { if (off) return; u = URL.createObjectURL(b); setUrl(u); }).catch(() => {}); return () => { off = true; if (u) URL.revokeObjectURL(u); }; }, [d]);
  return (
    <Modal open onClose={onClose} wide title={d.name} footer={<Button onClick={async () => download(await docBlob(d), d.name)} icon={<Download size={15} />}>Télécharger</Button>}>
      {d.mime.startsWith('image/') ? <img src={url} alt={d.name} className="mx-auto max-h-[70vh] rounded-lg" /> : d.mime === 'application/pdf' ? <iframe title={d.name} src={url} className="h-[70vh] w-full rounded-lg" /> : <p className="text-sm text-slate-500">Aperçu indisponible pour ce type de fichier.</p>}
    </Modal>
  );
}

function LinkForm({ d, onClose }: { d: DocFile; onClose: () => void }) {
  const { s, L } = useData();
  const [type, setType] = useState<string>(d.linkType ?? 'tx');
  const [id, setId] = useState(d.linkId ?? '');
  const [notes, setNotes] = useState(d.notes ?? '');
  const opts = type === 'tx' ? s.txs.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 300).map((t) => ({ value: t.id, label: `${fmtDate(t.date)} · ${t.label} · ${fmt(t.amount, L.accCur(t.accountId))}` })) : type === 'debt' ? s.debts.map((x) => ({ value: x.id, label: x.person })) : s.projects.map((p) => ({ value: p.id, label: p.name }));
  return (
    <Modal open onClose={onClose} title="Associer le document" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={async () => {
      await save('docs', { ...d, linkType: (id ? type : null) as DocFile['linkType'], linkId: id || null, notes }, 'Document associé');
      if (type === 'tx' && id) { const t = s.txs.find((x) => x.id === id); if (t && !t.docIds?.includes(d.id)) await save('txs', { ...t, docIds: [...(t.docIds ?? []), d.id] }, 'Justificatif associé'); }
      onClose();
    }}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <Field label="Type"><Select value={type} onChange={(e) => { setType(e.target.value); setId(''); }} options={[{ value: 'tx', label: 'Opération' }, { value: 'debt', label: 'Dette / créance' }, { value: 'project', label: 'Projet' }]} /></Field>
        <Field label="Élément"><Select value={id} onChange={(e) => setId(e.target.value)} options={[{ value: '', label: 'Aucun' }, ...opts]} /></Field>
        <Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
