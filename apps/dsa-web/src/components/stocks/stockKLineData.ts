import type { CandlestickData, HistogramData, Time } from 'lightweight-charts';
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
};

export const normalizeKLineData = (rows: KLineData[]): NormalizedKLineData => {
  const byDate = new Map<string, {
    candle: CandlestickData<Time>;
    volume?: HistogramData<Time>;
  }>();

  for (const row of rows) {
    const date = normalizeDate(row.date);
    const open = toFiniteNumber(row.open);
    const high = toFiniteNumber(row.high);
    const low = toFiniteNumber(row.low);
    const close = toFiniteNumber(row.close);

    if (!date || open === null || high === null || low === null || close === null) {
      continue;
    }
    if (!isValidOhlc(open, high, low, close)) {
      continue;
    }

    const volume = toFiniteNumber(row.volume);
    byDate.set(date, {
      candle: {
        time: date,
        open,
        high,
        low,
        close,
      },
      volume: volume !== null && volume >= 0
        ? {
            time: date,
            value: volume,
            color: close >= open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)',
          }
        : undefined,
    });
  }

  const sorted = [...byDate.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([, value]) => value);

  return {
    candles: sorted.map((item) => item.candle),
    volumes: sorted.flatMap((item) => (item.volume ? [item.volume] : [])),
  };
};
