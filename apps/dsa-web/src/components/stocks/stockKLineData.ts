import type { CandlestickData, HistogramData, LineData, Time } from 'lightweight-charts';
import type { KLineData } from '../../api/stocks';

const toFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeDate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const day = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return null;
  return day;
};

const isValidOhlc = (open: number, high: number, low: number, close: number) => (
  high >= low
  && open >= low
  && open <= high
  && close >= low
  && close <= high
);

export type NormalizedKLineData = {
  candles: CandlestickData<Time>[];
  volumes: HistogramData<Time>[];
  movingAverages: {
    ma5: LineData<Time>[];
    ma10: LineData<Time>[];
    ma20: LineData<Time>[];
  };
  points: Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    amount?: number;
    changePercent?: number;
    ma5?: number;
    ma10?: number;
    ma20?: number;
  }>;
};

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const rounded = (value: number) => Number(value.toFixed(4));

export const normalizeKLineData = (rows: KLineData[]): NormalizedKLineData => {
  const byDate = new Map<string, {
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
    amount: number | null;
    changePercent: number | null;
  }>();

  for (const row of rows) {
    const date = normalizeDate(row.date);
    if (!date) {
      continue;
    }

    byDate.set(date, {
      date,
      open: toFiniteNumber(row.open),
      high: toFiniteNumber(row.high),
      low: toFiniteNumber(row.low),
      close: toFiniteNumber(row.close),
      volume: toFiniteNumber(row.volume),
      amount: toFiniteNumber(row.amount),
      changePercent: toFiniteNumber(row.changePercent),
    });
  }

  const sorted = [...byDate.values()]
    .filter((item): item is {
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number | null;
      amount: number | null;
      changePercent: number | null;
    } => (
      item.open !== null
      && item.high !== null
      && item.low !== null
      && item.close !== null
      && isValidOhlc(item.open, item.high, item.low, item.close)
    ))
    .sort((itemA, itemB) => itemA.date.localeCompare(itemB.date))
    .map((item) => {
      const candle: CandlestickData<Time> = {
        time: item.date,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
      };

      return {
        candle,
        volume: item.volume !== null && item.volume >= 0
          ? {
              time: item.date,
              value: item.volume,
              color: item.close >= item.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)',
            }
          : undefined,
        rawVolume: item.volume !== null && item.volume >= 0 ? item.volume : undefined,
        amount: item.amount !== null && item.amount >= 0 ? item.amount : undefined,
        changePercent: item.changePercent !== null ? item.changePercent : undefined,
      };
    });

  const candles = sorted.map((item) => item.candle);
  const movingAverages = {
    ma5: [] as LineData<Time>[],
    ma10: [] as LineData<Time>[],
    ma20: [] as LineData<Time>[],
  };

  const closeWindow: number[] = [];
  const points = sorted.map((item, index) => {
    const close = Number(item.candle.close);
    closeWindow.push(close);

    const point: NormalizedKLineData['points'][number] = {
      time: String(item.candle.time),
      open: Number(item.candle.open),
      high: Number(item.candle.high),
      low: Number(item.candle.low),
      close,
      volume: item.rawVolume,
      amount: item.amount,
      changePercent: item.changePercent,
    };

    const addMa = (period: 5 | 10 | 20, key: 'ma5' | 'ma10' | 'ma20') => {
      if (index + 1 < period) return;
      const value = rounded(average(closeWindow.slice(-period)));
      point[key] = value;
      movingAverages[key].push({ time: item.candle.time, value });
    };

    addMa(5, 'ma5');
    addMa(10, 'ma10');
    addMa(20, 'ma20');
    return point;
  });

  return {
    candles,
    volumes: sorted.flatMap((item) => (item.volume ? [item.volume] : [])),
    movingAverages,
    points,
  };
};
