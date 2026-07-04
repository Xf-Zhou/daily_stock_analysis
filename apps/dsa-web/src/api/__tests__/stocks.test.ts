import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stocksApi } from '../stocks';

const get = vi.hoisted(() => vi.fn());

vi.mock('../index', () => ({
  default: {
    get,
  },
}));

describe('stocksApi', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('loads daily K-line history with a fixed daily period', async () => {
    get.mockResolvedValueOnce({
      data: {
        stock_code: '000001.SZ',
        stock_name: '平安银行',
        period: 'daily',
        data: [
          {
            date: '2026-06-01',
            open: 10,
            high: 11,
            low: 9,
            close: 10.5,
            volume: 1000,
            change_percent: 1.2,
          },
        ],
      },
    });

    const result = await stocksApi.getHistory('000001.SZ', { days: 90 });

    expect(get).toHaveBeenCalledWith(
      '/api/v1/stocks/000001.SZ/history',
      {
        params: {
          period: 'daily',
          days: 90,
          force_refresh: false,
        },
        signal: undefined,
      },
    );
    expect(result.stockCode).toBe('000001.SZ');
    expect(result.data[0].changePercent).toBe(1.2);
  });

  it('passes AbortSignal to the stock history request', async () => {
    const controller = new AbortController();
    get.mockResolvedValueOnce({
      data: {
        stock_code: '00700.HK',
        period: 'daily',
        data: [],
      },
    });

    await stocksApi.getHistory('00700.HK', { days: 30, signal: controller.signal });

    expect(get).toHaveBeenCalledWith(
      '/api/v1/stocks/00700.HK/history',
      expect.objectContaining({
        params: expect.objectContaining({ period: 'daily', days: 30, force_refresh: false }),
        signal: controller.signal,
      }),
    );
  });

  it('passes force refresh and maps history metadata', async () => {
    get.mockResolvedValueOnce({
      data: {
        stock_code: '600519.SH',
        stock_name: '贵州茅台',
        period: 'daily',
        source: 'db_cache',
        cache_hit: true,
        stale: true,
        partial_cache: true,
        as_of_date: '2026-06-01',
        actual_records: 30,
        requested_days: 90,
        effective_days: 90,
        message: '实时源失败，正在展示缓存数据',
        data: [],
      },
    });

    const result = await stocksApi.getHistory('600519.SH', { days: 90, forceRefresh: true });

    expect(get).toHaveBeenCalledWith(
      '/api/v1/stocks/600519.SH/history',
      expect.objectContaining({
        params: expect.objectContaining({ force_refresh: true }),
      }),
    );
    expect(result.cacheHit).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.partialCache).toBe(true);
    expect(result.asOfDate).toBe('2026-06-01');
    expect(result.actualRecords).toBe(30);
    expect(result.message).toBe('实时源失败，正在展示缓存数据');
  });
});
