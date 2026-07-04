import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StockKLineDrawer } from '../StockKLineDrawer';
import { stocksApi } from '../../../api/stocks';
import type { StockHistoryResponse } from '../../../api/stocks';

vi.mock('../../../api/stocks', () => ({
  stocksApi: {
    getHistory: vi.fn(),
  },
}));

vi.mock('../StockKLineChart', () => ({
  StockKLineChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="kline-chart">chart {data.length}</div>
  ),
}));

const historyPayload = (code = '000001.SZ'): StockHistoryResponse => ({
  stockCode: code,
  stockName: '平安银行',
  period: 'daily',
  source: 'db_cache',
  cacheHit: true,
  stale: false,
  partialCache: false,
  asOfDate: '2026-06-01',
  actualRecords: 1,
  requestedDays: 90,
  effectiveDays: 90,
  data: [
    { date: '2026-06-01', open: 10, high: 11, low: 9, close: 10.5, volume: 1000 },
  ],
});

describe('StockKLineDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stocksApi.getHistory).mockResolvedValue(historyPayload());
  });

  it('loads daily K-line data for the selected stock', async () => {
    render(
      <StockKLineDrawer
        isOpen
        stockCode="000001.SZ"
        stockName="平安银行"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('正在加载 K 线...')).toBeInTheDocument();
    expect(await screen.findByTestId('kline-chart')).toHaveTextContent('chart 1');
    expect(stocksApi.getHistory).toHaveBeenCalledWith(
      '000001.SZ',
      expect.objectContaining({ days: 90, forceRefresh: false, signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText('缓存')).toBeInTheDocument();
    expect(screen.getByText('截至 2026-06-01')).toBeInTheDocument();
    expect(screen.getByText('1 条')).toBeInTheDocument();
  });

  it('refreshes with forceRefresh and updates stale cache status', async () => {
    vi.mocked(stocksApi.getHistory)
      .mockResolvedValueOnce(historyPayload())
      .mockResolvedValueOnce({
        ...historyPayload(),
        stale: true,
        message: '实时源失败，正在展示缓存数据',
      });

    render(
      <StockKLineDrawer
        isOpen
        stockCode="000001.SZ"
        stockName="平安银行"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('kline-chart')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新 K 线' }));

    await waitFor(() => {
      expect(stocksApi.getHistory).toHaveBeenCalledTimes(2);
    });
    expect(stocksApi.getHistory).toHaveBeenLastCalledWith(
      '000001.SZ',
      expect.objectContaining({ days: 90, forceRefresh: true, signal: expect.any(AbortSignal) }),
    );
    expect(await screen.findByText('旧缓存')).toBeInTheDocument();
    expect(screen.getByText('实时源失败，正在展示缓存数据')).toBeInTheDocument();
  });

  it('reuses session cache when reopening the same stock and range', async () => {
    const { rerender } = render(
      <StockKLineDrawer
        isOpen
        stockCode="000001.SZ"
        stockName="平安银行"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('kline-chart')).toHaveTextContent('chart 1');

    rerender(
      <StockKLineDrawer
        isOpen={false}
        stockCode={undefined}
        stockName={undefined}
        onClose={vi.fn()}
      />,
    );

    rerender(
      <StockKLineDrawer
        isOpen
        stockCode="000001.SZ"
        stockName="平安银行"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('kline-chart')).toHaveTextContent('chart 1');
    expect(stocksApi.getHistory).toHaveBeenCalledTimes(1);
  });

  it('aborts the previous request when switching ranges', async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(stocksApi.getHistory).mockImplementation((_code, options) => {
      if (options?.signal) signals.push(options.signal);
      return new Promise<StockHistoryResponse>(() => undefined);
    });

    render(
      <StockKLineDrawer
        isOpen
        stockCode="000001.SZ"
        stockName="平安银行"
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '30 天' }));

    await waitFor(() => {
      expect(stocksApi.getHistory).toHaveBeenCalledTimes(2);
    });
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('does not let an old response overwrite the current stock', async () => {
    let resolveFirst: (value: StockHistoryResponse) => void = () => undefined;
    let resolveSecond: (value: StockHistoryResponse) => void = () => undefined;
    vi.mocked(stocksApi.getHistory)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const { rerender } = render(
      <StockKLineDrawer
        isOpen
        stockCode="000001.SZ"
        stockName="平安银行"
        onClose={vi.fn()}
      />,
    );

    rerender(
      <StockKLineDrawer
        isOpen
        stockCode="00700.HK"
        stockName="腾讯控股"
        onClose={vi.fn()}
      />,
    );

    resolveSecond(historyPayload('00700.HK'));
    expect(await screen.findByTestId('kline-chart')).toHaveTextContent('chart 1');

    resolveFirst({
      ...historyPayload('000001.SZ'),
      data: [],
    });

    await waitFor(() => {
      expect(screen.getByTestId('kline-chart')).toHaveTextContent('chart 1');
    });
  });

  it('shows empty and error states', async () => {
    vi.mocked(stocksApi.getHistory).mockResolvedValueOnce({
      stockCode: '000001.SZ',
      period: 'daily',
      data: [],
    });

    const { rerender } = render(
      <StockKLineDrawer
        isOpen
        stockCode="000001.SZ"
        stockName="平安银行"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('暂无 K 线数据，可能是行情源暂不可用。')).toBeInTheDocument();

    vi.mocked(stocksApi.getHistory).mockRejectedValueOnce(new Error('行情失败'));
    rerender(
      <StockKLineDrawer
        isOpen
        stockCode="600519.SH"
        stockName="贵州茅台"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('K 线加载失败')).toBeInTheDocument();
    expect(screen.getByText('行情失败')).toBeInTheDocument();
  });

  it('aborts pending request when closing the drawer', async () => {
    const onClose = vi.fn();
    const signals: AbortSignal[] = [];
    vi.mocked(stocksApi.getHistory).mockImplementation((_code, options) => {
      if (options?.signal) signals.push(options.signal);
      return new Promise<StockHistoryResponse>(() => undefined);
    });

    render(
      <StockKLineDrawer
        isOpen
        stockCode="000001.SZ"
        stockName="平安银行"
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭抽屉' }));

    expect(onClose).toHaveBeenCalled();
    expect(signals[0].aborted).toBe(true);
  });

  it('does not render the previous chart while reopening another stock before the new response', async () => {
    vi.mocked(stocksApi.getHistory)
      .mockResolvedValueOnce(historyPayload('000001.SZ'))
      .mockImplementationOnce(() => new Promise<StockHistoryResponse>(() => undefined));

    const { rerender } = render(
      <StockKLineDrawer
        isOpen
        stockCode="000001.SZ"
        stockName="平安银行"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('kline-chart')).toHaveTextContent('chart 1');

    rerender(
      <StockKLineDrawer
        isOpen={false}
        stockCode={undefined}
        stockName={undefined}
        onClose={vi.fn()}
      />,
    );

    rerender(
      <StockKLineDrawer
        isOpen
        stockCode="00700.HK"
        stockName="腾讯控股"
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('kline-chart')).not.toBeInTheDocument();
    expect(screen.getByText('正在加载 K 线...')).toBeInTheDocument();
  });
});
