// Télécharge un modèle Whisper (format ONNX quantifié) dans public/models pour la reconnaissance vocale privée.
// Usage : node scripts/fetch-whisper.mjs [onnx-community/whisper-base]
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const id = process.argv[2] || 'onnx-community/whisper-base';
const base = `https://huggingface.co/${id}/resolve/main/`;
const list = await (await fetch(`https://huggingface.co/api/models/${id}/tree/main?recursive=1`)).json();
const wanted = list.map((f) => f.path).filter((p) => /^[^/]+\.(json|txt)$/.test(p) || /^onnx\/(encoder_model|decoder_model_merged)_quantized\.onnx$/.test(p));
if (!wanted.some((p) => p.includes('encoder_model_quantized'))) throw new Error(`Fichiers ONNX quantifiés introuvables pour ${id}`);
for (const p of wanted) {
  const out = `public/models/${id}/${p}`;
  if (existsSync(out)) continue;
  mkdirSync(dirname(out), { recursive: true });
  const res = await fetch(base + p);
  if (!res.ok) throw new Error(`${p} : HTTP ${res.status}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log('✓', p);
}
console.log(`Modèle ${id} prêt dans public/models/`);
