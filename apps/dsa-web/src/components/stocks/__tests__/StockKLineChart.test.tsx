import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StockKLineChart } from '../StockKLineChart';
import { normalizeKLineData } from '../stockKLineData';
import type { KLineData } from '../../../api/stocks';

const remove = vi.fn();
const resize = vi.fn();
const fitContent = vi.fn();
const candleSetData = vi.fn();
const volumeSetData = vi.fn();
const applyOptions = vi.fn();
const observe = vi.fn();
const disconnect = vi.fn();

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'CandlestickSeries',
  ColorType: { Solid: 'solid' },
  HistogramSeries: 'HistogramSeries',
  createChart: vi.fn(() => ({
    addSeries: vi.fn((seriesType: string) => (
      seriesType === 'CandlestickSeries'
        ? { setData: candleSetData }
        : { setData: volumeSetData }
    )),
    priceScale: vi.fn(() => ({ applyOptions })),
    remove,
    resize,
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
