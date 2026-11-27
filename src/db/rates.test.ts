import { describe, expect, it } from 'vitest';
import { fetchRates } from './rates';
import { rateOf } from '../engine/money';

const fake = (rows: { quote: string; rate: number }[]) => (async () => ({ ok: true, status: 200, json: async () => rows })) as unknown as typeof fetch;

describe('taux de change', () => {
  it('calcule la valeur d\'une devise dans la devise principale via l\'euro', async () => {
    const r = await fetchRates('EUR', ['EUR', 'USD', 'XOF'], fake([{ quote: 'USD', rate: 1.25 }]));
    expect(r.USD).toBeCloseTo(0.8);
    expect(r.XOF).toBeCloseTo(1 / 655.957);
  });
  it('fonctionne avec le franc CFA comme devise principale', async () => {
    const r = await fetchRates('XOF', ['EUR', 'USD'], fake([{ quote: 'USD', rate: 1.25 }]));
    expect(r.EUR).toBeCloseTo(655.957);
    expect(r.USD).toBeCloseTo(655.957 / 1.25);
  });
  it('utilise le taux en vigueur à la date de l\'opération', () => {
    const rates = [{ currency: 'USD', rate: 0.9, updatedAt: '2026-11-01T00:00:00Z', history: [{ date: '2026-06-01', rate: 0.8 }] }];
    expect(rateOf('USD', 'EUR', rates, '2026-07-15')).toBe(0.8);
    expect(rateOf('USD', 'EUR', rates, '2026-11-20')).toBe(0.9);
    expect(rateOf('USD', 'EUR', rates, '2025-01-01')).toBe(0.8);
    const sameDay = [{ currency: 'USD', rate: 0.9, updatedAt: '2026-11-01T18:00:00Z', history: [{ date: '2026-11-01', rate: 0.8 }] }];
    expect(rateOf('USD', 'EUR', sameDay, '2026-11-01')).toBe(0.9);
  });
});
