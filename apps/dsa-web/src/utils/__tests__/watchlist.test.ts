import { describe, expect, it } from 'vitest';
import {
  addWatchlistCode,
  isSameStockCode,
  normalizeWatchlistCode,
  parseStockListValue,
  removeWatchlistCode,
  toStockListStorageCode,
} from '../watchlist';

describe('watchlist code helpers', () => {
  it('normalizes A-share and BSE code variants to numeric storage codes', () => {
    expect(toStockListStorageCode('600519', 'CN')).toBe('600519');
    expect(toStockListStorageCode('600519.SH', 'CN')).toBe('600519');
    expect(toStockListStorageCode('SH600519', 'CN')).toBe('600519');
    expect(toStockListStorageCode('000001.SZ', 'CN')).toBe('000001');
    expect(toStockListStorageCode('SZ000001', 'CN')).toBe('000001');
    expect(toStockListStorageCode('920118.BJ', 'BSE')).toBe('920118');
    expect(toStockListStorageCode('BJ920118', 'BSE')).toBe('920118');
  });

  it('normalizes HK code variants only when the code or market identifies HK', () => {
    expect(toStockListStorageCode('00700.HK')).toBe('HK00700');
    expect(toStockListStorageCode('HK00700')).toBe('HK00700');
    expect(toStockListStorageCode('hk700')).toBe('HK00700');
    expect(toStockListStorageCode('00700')).toBe('00700');
    expect(toStockListStorageCode('00700', 'HK')).toBe('HK00700');
  });

  it('normalizes US tickers while preserving unknown suffix tickers conservatively', () => {
    expect(toStockListStorageCode('aapl', 'US')).toBe('AAPL');
    expect(toStockListStorageCode('BRK.B', 'US')).toBe('BRK.B');
    expect(toStockListStorageCode('600519.XSHG')).toBe('600519.XSHG');
  });

  it('compares equivalent codes with market-aware HK handling', () => {
    expect(isSameStockCode('600519', '600519.SH', 'CN')).toBe(true);
    expect(isSameStockCode('SH600519', '600519', 'CN')).toBe(true);
    expect(isSameStockCode('920118.BJ', 'BJ920118', 'BSE')).toBe(true);
    expect(isSameStockCode('00700', 'HK00700')).toBe(false);
    expect(isSameStockCode('00700', 'HK00700', 'HK')).toBe(true);
    expect(isSameStockCode('aapl', 'AAPL', 'US')).toBe(true);
  });

  it('parses, appends, deduplicates and removes stock list values', () => {
    const parsed = parseStockListValue('600519, 600519.SH, HK00700,,aapl');
    expect(parsed).toEqual(['600519', '600519.SH', 'HK00700', 'aapl']);

    expect(addWatchlistCode(['600519', '600519.SH'], 'SH600519', 'CN')).toEqual(['600519']);
    expect(addWatchlistCode(['600519.SH', 'aapl'], '000001.SZ', 'CN')).toEqual(['600519', 'AAPL', '000001']);
    expect(addWatchlistCode(['600519'], '00700', 'HK')).toEqual(['600519', 'HK00700']);
    expect(addWatchlistCode(['HK00700'], 'hk700', 'HK')).toEqual(['HK00700']);

    expect(removeWatchlistCode(['600519', '600519.SH', 'HK00700', '00700'], '00700.HK', 'HK')).toEqual(['600519']);
  });

  it('uses a market resolver to standardize existing bare HK codes when another market is toggled', () => {
    const resolveMarket = (code: string) => (code === '00700' ? 'HK' as const : undefined);

    expect(addWatchlistCode(['00700'], '000001.SZ', 'CN', resolveMarket)).toEqual(['HK00700', '000001']);
    expect(removeWatchlistCode(['00700', '000001'], '000001.SZ', 'CN', resolveMarket)).toEqual(['HK00700']);
  });

  it('returns trimmed uppercase normalized values for display comparison', () => {
    expect(normalizeWatchlistCode(' aapl ')).toBe('AAPL');
    expect(normalizeWatchlistCode(' hk700 ')).toBe('HK00700');
  });
});
