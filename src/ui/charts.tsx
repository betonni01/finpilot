import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart } from 'recharts';
import { fmt } from '../engine/money';
import { fmtDate } from '../engine/date';

const axis = { fontSize: 11, fill: '#94a3b8' };
const short = (cur: string) => (v: number) => fmt(v, cur, { compact: true }).replace(/\s?(€|F\s?CFA|\$)/, (m) => m.trim());
const tipStyle = { contentStyle: { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, background: 'rgba(255,255,255,.97)', color: '#0f172a' } };

export function BalanceChart({ data, cur, threshold, height = 260, splitDate }: { data: { date: string; past?: number | null; free?: number | null; balance?: number | null; low?: number | null; high?: number | null }[]; cur: string; threshold?: number; height?: number; splitDate?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gPast" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f172a" stopOpacity={0.18} /><stop offset="100%" stopColor="#0f172a" stopOpacity={0} /></linearGradient>
          <linearGradient id="gFree" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.25} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
        </defs>
        <CartesianGrid stroke="#94a3b8" strokeOpacity={0.15} vertical={false} />
        <XAxis dataKey="date" tick={axis} tickLine={false} axisLine={false} minTickGap={40} tickFormatter={(d) => fmtDate(d, 'day').replace(/^\S+\s/, '')} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={64} tickFormatter={short(cur)} />
        <Tooltip {...tipStyle} labelFormatter={(d) => fmtDate(String(d), 'long')} formatter={(v: any, n: any) => [fmt(v, cur), n]} />
        {data.some((d) => d.high != null) && <Area type="monotone" dataKey="high" name="Optimiste" stroke="#10b981" strokeOpacity={0.35} strokeDasharray="3 3" fill="none" dot={false} isAnimationActive={false} />}
        {data.some((d) => d.low != null) && <Area type="monotone" dataKey="low" name="Pessimiste" stroke="#f43f5e" strokeOpacity={0.45} strokeDasharray="3 3" fill="none" dot={false} isAnimationActive={false} />}
        <Area type="monotone" dataKey="past" name="Solde réel" stroke="#334155" strokeWidth={2} fill="url(#gPast)" dot={false} isAnimationActive={false} connectNulls={false} />
        <Area type="stepAfter" dataKey="free" name="Disponible prévu" stroke="#10b981" strokeWidth={2} fill="url(#gFree)" dot={false} isAnimationActive={false} />
        {data.some((d) => d.balance != null) && <Line type="stepAfter" dataKey="balance" name="Solde prévu" stroke="#0ea5e9" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
        {threshold != null && <ReferenceLine y={threshold} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Seuil', fontSize: 10, fill: '#f59e0b', position: 'insideTopLeft' }} />}
        <ReferenceLine y={0} stroke="#f43f5e" strokeOpacity={0.5} />
        {splitDate && <ReferenceLine x={splitDate} stroke="#94a3b8" strokeDasharray="2 2" label={{ value: "Aujourd'hui", fontSize: 10, fill: '#94a3b8', position: 'insideTopRight' }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, cur, height = 220 }: { data: { name: string; value: number; color: string }[]; cur: string; height?: number }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative w-full max-w-[220px]" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="95%" paddingAngle={1.5} stroke="none" isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip {...tipStyle} formatter={(v: any, n: any) => [`${fmt(v, cur)} (${Math.round((v / total) * 100)} %)`, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-[11px] text-slate-500">Total</span><span className="num text-sm font-semibold">{fmt(total, cur, { compact: true })}</span></div>
      </div>
      <ul className="w-full flex-1 space-y-1.5 text-sm">
        {data.slice(0, 7).map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} /><span className="truncate">{d.name}</span></span><span className="num text-slate-600 dark:text-slate-300">{fmt(d.value, cur)}</span></li>
        ))}
        {data.length > 7 && <li className="text-xs text-slate-400">+ {data.length - 7} autres catégories</li>}
      </ul>
    </div>
  );
}

export function BarsChart({ data, cur, bars, height = 240, stacked }: { data: Record<string, unknown>[]; cur: string; bars: { key: string; name: string; color: string }[]; height?: number; stacked?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#94a3b8" strokeOpacity={0.15} vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={64} tickFormatter={short(cur)} />
        <Tooltip {...tipStyle} formatter={(v: any, n: any) => [fmt(v, cur), n]} cursor={{ fill: '#94a3b8', fillOpacity: 0.08 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        {bars.map((b) => <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} radius={stacked ? 0 : [4, 4, 0, 0]} stackId={stacked ? 's' : undefined} maxBarSize={36} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LinesChart({ data, cur, lines, height = 240, xKey = 'label', threshold }: { data: Record<string, unknown>[]; cur: string; lines: { key: string; name: string; color: string; dashed?: boolean }[]; height?: number; xKey?: string; threshold?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#94a3b8" strokeOpacity={0.15} vertical={false} />
        <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={false} minTickGap={30} tickFormatter={(d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? fmtDate(String(d), 'day').replace(/^\S+\s/, '') : String(d))} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={64} tickFormatter={short(cur)} />
        <Tooltip {...tipStyle} labelFormatter={(d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? fmtDate(String(d), 'long') : String(d))} formatter={(v: any, n: any) => [fmt(v, cur), n]} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        {threshold != null && <ReferenceLine y={threshold} stroke="#f59e0b" strokeDasharray="4 4" />}
        {lines.map((l) => <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} strokeDasharray={l.dashed ? '5 4' : undefined} dot={false} isAnimationActive={false} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MiniArea({ data, color = '#10b981', height = 48 }: { data: { v: number }[]; color?: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <Area type="monotone" dataKey="v" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
