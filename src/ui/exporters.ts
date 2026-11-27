import * as XLSX from 'xlsx';

type Row = Record<string, string | number | boolean | null | undefined>;

export function exportRows(rows: Row[], format: 'csv' | 'xlsx', sheetName = 'Données'): Blob {
  if (format === 'csv') {
    const head = rows.length ? Object.keys(rows[0]) : [];
    const esc = (v: unknown) => {
      const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [head.join(';'), ...rows.map((r) => head.map((h) => esc(r[h])).join(';'))].join('\r\n');
    return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  }
  return exportSheets([{ name: sheetName, rows }]);
}

export function exportSheets(sheets: { name: string; rows: Row[] }[]): Blob {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ Info: 'Aucune donnée' }]);
    const keys = Object.keys(s.rows[0] ?? { Info: '' });
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[k] ?? '').length + 1))) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
