import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StockKLineChart } from '../StockKLineChart';
import { normalizeKLineData } from '../stockKLineData';
import type { KLineData } from '../../../api/stocks';

const remove = vi.fn();
const resize = vi.fn();
const fitContent = vi.fn();
const candleSetData = vi.fn();
const volumeSetData = vi.fn();
const lineSetData = vi.fn();
const applyOptions = vi.fn();
const observe = vi.fn();
const disconnect = vi.fn();
const subscribeCrosshairMove = vi.fn();
const unsubscribeCrosshairMove = vi.fn();
const candleSeries = { setData: candleSetData };
const volumeSeries = { setData: volumeSetData };
const lineSeries = { setData: lineSetData };
let crosshairHandler: ((param: unknown) => void) | null = null;

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'CandlestickSeries',
  ColorType: { Solid: 'solid' },
  HistogramSeries: 'HistogramSeries',
  LineSeries: 'LineSeries',
  createChart: vi.fn(() => ({
    addSeries: vi.fn((seriesType: string) => (
      seriesType === 'CandlestickSeries'
        ? candleSeries
        : seriesType === 'HistogramSeries'
          ? volumeSeries
          : lineSeries
    )),
    priceScale: vi.fn(() => ({ applyOptions })),
    remove,
    resize,
    subscribeCrosshairMove: vi.fn((handler) => {
      crosshairHandler = handler;
      subscribeCrosshairMove(handler);
    }),
    unsubscribeCrosshairMove,
    timeScale: vi.fn(() => ({ fitContent })),
  })),
}));

class MockResizeObserver {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe = observe;
  disconnect = disconnect;
}

describe('StockKLineChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crosshairHandler = null;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 720,
    });
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes K-line data by filtering invalid rows, keeping last duplicate, and sorting ascending', () => {
    const raw: KLineData[] = [
      { date: '2026-06-03', open: 3, high: 4, low: 2, close: 3.5, volume: 30 },
      { date: '2026-06-02', open: 2, high: 3, low: 1, close: 2.5, volume: 20 },
      { date: '2026-06-02', open: 2.2, high: 3.2, low: 1.2, close: 2.7, volume: 22 },
      { date: '2026-06-01', open: Number.NaN, high: 2, low: 1, close: 1.5, volume: 10 },
      { date: '2026-06-04', open: 4, high: 3, low: 2, close: 3.5, volume: 40 },
    ];

    const normalized = normalizeKLineData(raw);

    expect(normalized.candles).toEqual([
      { time: '2026-06-02', open: 2.2, high: 3.2, low: 1.2, close: 2.7 },
      { time: '2026-06-03', open: 3, high: 4, low: 2, close: 3.5 },
    ]);
    expect(normalized.volumes).toEqual([
      { time: '2026-06-02', value: 22, color: expect.any(String) },
      { time: '2026-06-03', value: 30, color: expect.any(String) },
    ]);
    expect(normalized.movingAverages.ma5).toEqual([]);
    expect(normalized.movingAverages.ma10).toEqual([]);
    expect(normalized.movingAverages.ma20).toEqual([]);
  });

  it('drops a duplicate date when the last row for that date has invalid OHLC', () => {
    const normalized = normalizeKLineData([
      { date: '2026-06-02', open: 2, high: 3, low: 1, close: 2.5, volume: 20 },
      { date: '2026-06-02', open: 4, high: 3, low: 1, close: 2.5, volume: 22 },
      { date: '2026-06-03', open: 3, high: 4, low: 2, close: 3.5, volume: 30 },
    ]);

    expect(normalized.candles).toEqual([
      { time: '2026-06-03', open: 3, high: 4, low: 2, close: 3.5 },
    ]);
    expect(normalized.volumes).toEqual([
      { time: '2026-06-03', value: 30, color: expect.any(String) },
    ]);
  });

  it('computes moving averages after normalized data is sorted', () => {
    const raw: KLineData[] = Array.from({ length: 5 }, (_, index) => ({
      date: `2026-06-0${5 - index}`,
      close: 5 - index,
      open: 5 - index,
      high: 6 - index,
      low: 4 - index,
      volume: 100,
    }));

    const normalized = normalizeKLineData(raw);

    expect(normalized.candles.map((item) => item.close)).toEqual([1, 2, 3, 4, 5]);
    expect(normalized.movingAverages.ma5).toEqual([
      { time: '2026-06-05', value: 3 },
    ]);
  });

  it('renders candlestick and volume series with normalized data', () => {
    render(
      <StockKLineChart
        data={[
          { date: '2026-06-02', open: 2, high: 3, low: 1, close: 2.5, volume: 20 },
          { date: '2026-06-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
        ]}
      />,
    );

    expect(candleSetData).toHaveBeenCalledWith([
      { time: '2026-06-01', open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: '2026-06-02', open: 2, high: 3, low: 1, close: 2.5 },
    ]);
    expect(volumeSetData).toHaveBeenCalledWith([
      { time: '2026-06-01', value: 10, color: expect.any(String) },
      { time: '2026-06-02', value: 20, color: expect.any(String) },
    ]);
    expect(observe).toHaveBeenCalled();
    expect(fitContent).toHaveBeenCalled();
  });

  it('renders default moving average series and lets users toggle volume', () => {
    const data: KLineData[] = Array.from({ length: 10 }, (_, index) => ({
      date: `2026-06-${String(index + 1).padStart(2, '0')}`,
      open: index + 1,
      high: index + 2,
      low: index,
      close: index + 1,
      volume: 100 + index,
    }));

    render(<StockKLineChart data={data} />);

    expect(lineSetData).toHaveBeenCalledWith(expect.arrayContaining([
      { time: '2026-06-05', value: 3 },
    ]));
    expect(lineSetData).toHaveBeenCalledWith(expect.arrayContaining([
      { time: '2026-06-10', value: 5.5 },
    ]));

    fireEvent.click(screen.getByRole('button', { name: '隐藏成交量' }));
    expect(screen.getByRole('button', { name: '显示成交量' })).toBeInTheDocument();
  });

  it('shows crosshair OHLC details and cleans up subscription on unmount', () => {
    const { unmount } = render(
      <StockKLineChart
        data={[
          {
            date: '2026-06-01',
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
            volume: 10,
            amount: 100,
            changePercent: 2.5,
          },
        ]}
      />,
    );

    expect(subscribeCrosshairMove).toHaveBeenCalledTimes(1);
    expect(screen.getByText('悬停查看 OHLC')).toBeInTheDocument();

    act(() => {
      crosshairHandler?.({
        time: '2026-06-01',
        seriesData: new Map([
          [candleSeries, { open: 1, high: 2, low: 0.5, close: 1.5 }],
          [volumeSeries, { value: 10 }],
        ]),
      });
    });

    expect(screen.getByText('2026-06-01')).toBeInTheDocument();
    expect(screen.getByText('开 1')).toBeInTheDocument();
    expect(screen.getByText('高 2')).toBeInTheDocument();
    expect(screen.getByText('涨跌幅 2.5%')).toBeInTheDocument();

    act(() => {
      crosshairHandler?.({ time: undefined, seriesData: new Map() });
    });
    expect(screen.getByText('悬停查看 OHLC')).toBeInTheDocument();

    unmount();

    expect(unsubscribeCrosshairMove).toHaveBeenCalledWith(expect.any(Function));
    expect(remove).toHaveBeenCalled();
  });

  it('formats missing crosshair change percent without a dangling percent sign', () => {
    render(
      <StockKLineChart
        data={[
          {
            date: '2026-06-01',
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
            volume: 10,
            amount: 100,
          },
        ]}
      />,
    );

    act(() => {
      crosshairHandler?.({
        time: '2026-06-01',
        seriesData: new Map([
          [candleSeries, { open: 1, high: 2, low: 0.5, close: 1.5 }],
        ]),
      });
    });

    expect(screen.queryByText('涨跌幅 -%')).not.toBeInTheDocument();
    expect(screen.getByText('涨跌幅 -')).toBeInTheDocument();
  });

  it('cleans up crosshair subscription when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(
      <StockKLineChart
        data={[
          { date: '2026-06-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
        ]}
      />,
    );

    expect(addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(unsubscribeCrosshairMove).toHaveBeenCalledWith(expect.any(Function));
    expect(remove).toHaveBeenCalled();
  });

  it('cleans up chart and observer on unmount', () => {
    const { unmount } = render(
      <StockKLineChart
        data={[
          { date: '2026-06-01', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
        ]}
      />,
    );

    unmount();

    expect(disconnect).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });
});
