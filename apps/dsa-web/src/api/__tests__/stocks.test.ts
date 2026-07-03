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
        params: expect.objectContaining({ period: 'daily', days: 30 }),
        signal: controller.signal,
      }),
    );
  });
});
