import { describe, expect, it } from 'vitest';
import type { StockRankingItem } from '../../api/stocks';
import type { StockIndexItem } from '../../types/stockIndex';
import {
  buildCandidatePool,
  type CandidateRankingSignal,
} from '../candidateScoring';

const stock = (
  canonicalCode: string,
  nameZh: string,
  popularity: number,
  industry = '银行',
): StockIndexItem => ({
  canonicalCode,
  displayCode: canonicalCode.split('.')[0],
  nameZh,
  pinyinFull: nameZh,
  pinyinAbbr: nameZh,
  aliases: [],
  market: canonicalCode.endsWith('.HK') ? 'HK' : 'CN',
  assetType: 'stock',
  active: true,
  popularity,
  industry,
  industrySource: 'override',
});

const ranking = (
  code: string,
  name: string,
  overrides: Partial<StockRankingItem> = {},
): StockRankingItem => ({
  code,
  name,
  market: code.endsWith('.HK') ? 'HK' : 'CN',
  industry: '银行',
  price: 10,
  changePct: 2.5,
  amount: 120000000,
  volume: 3000000,
  ...overrides,
});

const signal = (
  key: CandidateRankingSignal['key'],
  items: StockRankingItem[],
  status: CandidateRankingSignal['status'] = 'ok',
): CandidateRankingSignal => ({
  key,
  status,
  items,
});

describe('candidateScoring', () => {
  it('uses static filtered stocks as the candidate universe and never expands from rankings', () => {
    const result = buildCandidatePool({
      stocks: [stock('600519.SH', '贵州茅台', 100, '白酒')],
      mode: 'balanced',
      signals: [
        signal('amount', [
          ranking('600519.SH', '贵州茅台', { amount: 200000000 }),
          ranking('000001.SZ', '平安银行', { amount: 500000000 }),
        ]),
      ],
      isWatchlisted: () => false,
    });

    expect(result.items.map((item) => item.code)).toEqual(['600519.SH']);
    expect(result.items[0].reasons).toContain('成交额活跃');
    expect(result.items[0].amount).toBe(200000000);
  });

  it('does not give already watchlisted stocks a positive score boost', () => {
    const result = buildCandidatePool({
      stocks: [
        stock('600519.SH', '贵州茅台', 80),
        stock('000001.SZ', '平安银行', 80),
      ],
      mode: 'balanced',
      signals: [],
      isWatchlisted: (code) => code === '000001.SZ',
    });

    const watchlisted = result.items.find((item) => item.code === '000001.SZ');
    const fresh = result.items.find((item) => item.code === '600519.SH');

    expect(watchlisted?.isWatchlisted).toBe(true);
    expect(watchlisted?.reasons).toContain('已自选');
    expect(watchlisted?.score).toBeLessThanOrEqual(fresh?.score ?? 0);
  });

  it('uses real popularity for static ordering without adding a static reason for zero', () => {
    const result = buildCandidatePool({
      stocks: [
        stock('000001.SZ', '平安银行', 0),
        stock('600519.SH', '贵州茅台', 100),
      ],
      mode: 'balanced',
      signals: [],
      isWatchlisted: () => false,
    });

    expect(result.items.map((item) => item.code)).toEqual(['600519.SH', '000001.SZ']);
    expect(result.items.find((item) => item.code === '600519.SH')?.reasons).toContain('静态热度');
    expect(result.items.find((item) => item.code === '000001.SZ')?.reasons).not.toContain('静态热度');
  });

  it('aggregates ranking statuses without discarding usable signals', () => {
    const partial = buildCandidatePool({
      stocks: [stock('600519.SH', '贵州茅台', 100)],
      mode: 'balanced',
      signals: [
        signal('amount', [ranking('600519.SH', '贵州茅台')], 'ok'),
        signal('volume', [], 'unavailable'),
      ],
      isWatchlisted: () => false,
    });

    const cached = buildCandidatePool({
      stocks: [stock('600519.SH', '贵州茅台', 100)],
      mode: 'balanced',
      signals: [signal('amount', [ranking('600519.SH', '贵州茅台')], 'stale')],
      isWatchlisted: () => false,
    });

    const staleAndUnavailable = buildCandidatePool({
      stocks: [stock('600519.SH', '贵州茅台', 100)],
      mode: 'balanced',
      signals: [
        signal('amount', [ranking('600519.SH', '贵州茅台')], 'stale'),
        signal('volume', [], 'unavailable'),
      ],
      isWatchlisted: () => false,
    });

    const staticOnly = buildCandidatePool({
      stocks: [stock('600519.SH', '贵州茅台', 100)],
      mode: 'balanced',
      signals: [signal('amount', [], 'partial')],
      isWatchlisted: () => false,
    });

    expect(partial.status).toBe('partial');
    expect(cached.status).toBe('cached');
    expect(staleAndUnavailable.status).toBe('partial');
    expect(staticOnly.status).toBe('static');
  });

  it('labels pullback candidates only from the actual loser signal', () => {
    const result = buildCandidatePool({
      stocks: [stock('000001.SZ', '平安银行', 90)],
      mode: 'pullback',
      signals: [
        signal('losers', [
          ranking('000001.SZ', '平安银行', { changePct: -3.2 }),
        ]),
      ],
      isWatchlisted: () => false,
    });

    expect(result.items[0].reasons).toContain('回调观察');
    expect(result.items[0].changePct).toBe(-3.2);
  });
});
