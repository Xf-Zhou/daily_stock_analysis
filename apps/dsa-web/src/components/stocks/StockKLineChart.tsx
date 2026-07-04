import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
} from 'lightweight-charts';
import type { KLineData } from '../../api/stocks';
import { cn } from '../../utils/cn';
import { normalizeKLineData } from './stockKLineData';

const CHART_HEIGHT = 420;
const UP_COLOR = '#10b981';
const DOWN_COLOR = '#ef4444';
const TEXT_COLOR = '#64748b';
const GRID_COLOR = 'rgba(148, 163, 184, 0.18)';
const MA_COLORS = {
  ma5: '#06b6d4',
  ma10: '#f59e0b',
  ma20: '#8b5cf6',
};
const HOVER_INFO_ITEM_CLASS = 'shrink-0';

type StockKLineChartProps = {
  data: KLineData[];
  className?: string;
};

type HoverPoint = {
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
};

const formatNumber = (value: number | undefined, digits = 2) => {
  if (value === undefined || !Number.isFinite(value)) return '-';
  const fixed = value.toFixed(digits);
  return fixed.replace(/\.?0+$/, '');
};

const formatLargeNumber = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 100000000) return `${formatNumber(value / 100000000, 2)}亿`;
  if (Math.abs(value) >= 10000) return `${formatNumber(value / 10000, 2)}万`;
  return formatNumber(value, 0);
};

const formatPercent = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return '-';
  return `${formatNumber(value)}%`;
};

export const StockKLineChart: React.FC<StockKLineChartProps> = ({ data, className }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const normalized = useMemo(() => normalizeKLineData(data), [data]);
  const pointByTime = useMemo(
    () => new Map(normalized.points.map((point) => [point.time, point])),
    [normalized],
  );
  const [showVolume, setShowVolume] = useState(true);
  const [visibleMa, setVisibleMa] = useState({ ma5: true, ma10: true, ma20: false });
  const [hoverPoint, setHoverPoint] = useState<HoverPoint | null>(null);
  const visibleHoverPoint = hoverPoint && pointByTime.has(hoverPoint.time) ? hoverPoint : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || normalized.candles.length === 0) {
      return undefined;
    }
    const chart = createChart(container, {
      width: container.clientWidth || 640,
      height: CHART_HEIGHT,
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: TEXT_COLOR,
        fontSize: 12,
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: {
          top: 0.08,
          bottom: 0.28,
        },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    });
    candleSeries.setData(normalized.candles);

    const volumeSeries = showVolume
      ? chart.addSeries(HistogramSeries, {
          priceFormat: {
            type: 'volume',
          },
          priceScaleId: 'volume',
          lastValueVisible: false,
          priceLineVisible: false,
        })
      : null;
    if (volumeSeries) {
      volumeSeries.setData(normalized.volumes);
      chart.priceScale('volume').applyOptions({
        scaleMargins: {
          top: 0.82,
          bottom: 0,
        },
      });
    }

    const addMovingAverage = (key: 'ma5' | 'ma10' | 'ma20', label: string) => {
      if (!visibleMa[key] || normalized.movingAverages[key].length === 0) return;
      const series = chart.addSeries(LineSeries, {
        color: MA_COLORS[key],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        title: label,
      });
      series.setData(normalized.movingAverages[key]);
    };

    addMovingAverage('ma5', 'MA5');
    addMovingAverage('ma10', 'MA10');
    addMovingAverage('ma20', 'MA20');

    chart.timeScale().fitContent();

    const handleCrosshairMove = (param: {
      time?: unknown;
      seriesData?: Map<unknown, unknown>;
    }) => {
      if (!param?.time) {
        setHoverPoint(null);
        return;
      }
      const timeKey = String(param.time);
      const point = pointByTime.get(timeKey);
      if (!point) {
        setHoverPoint(null);
        return;
      }
      const candle = param.seriesData?.get(candleSeries) as Partial<HoverPoint> | undefined;
      setHoverPoint({
        ...point,
        open: Number(candle?.open ?? point.open),
        high: Number(candle?.high ?? point.high),
        low: Number(candle?.low ?? point.low),
        close: Number(candle?.close ?? point.close),
      });
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    const cleanupChart = () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
    };

    const resize = (width: number) => {
      if (width > 0) {
        chart.resize(Math.floor(width), CHART_HEIGHT);
      }
    };

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        resize(entry?.contentRect.width ?? container.clientWidth);
      });
      observer.observe(container);
    } else {
      const handleResize = () => resize(container.clientWidth);
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
        cleanupChart();
      };
    }

    return () => {
      observer?.disconnect();
      cleanupChart();
    };
  }, [normalized, pointByTime, showVolume, visibleMa]);

  if (normalized.candles.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center rounded-xl border border-dashed border-border/60 bg-base/30 text-sm text-secondary-text">
        暂无可渲染的 K 线数据
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-border/50 bg-card/55 p-3', className)}>
      <div className="mb-3 flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {(['ma5', 'ma10', 'ma20'] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-label={`${visibleMa[key] ? '隐藏' : '显示'} ${key.toUpperCase()}`}
              onClick={() => setVisibleMa((current) => ({ ...current, [key]: !current[key] }))}
              className={cn(
                'inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium transition-colors',
                visibleMa[key]
                  ? 'border-cyan/30 bg-cyan/10 text-cyan'
                  : 'border-border/60 bg-base/40 text-secondary-text hover:text-foreground',
              )}
            >
              {key.toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            aria-label={showVolume ? '隐藏成交量' : '显示成交量'}
            onClick={() => setShowVolume((current) => !current)}
            className={cn(
              'inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium transition-colors',
              showVolume
                ? 'border-cyan/30 bg-cyan/10 text-cyan'
                : 'border-border/60 bg-base/40 text-secondary-text hover:text-foreground',
            )}
          >
            成交量
          </button>
        </div>
        <div
          data-testid="stock-kline-hover-info"
          className="flex h-8 min-h-8 w-full min-w-0 items-center gap-3 overflow-x-auto overflow-y-hidden whitespace-nowrap rounded-lg border border-border/40 bg-base/25 px-2 text-xs text-secondary-text"
        >
          {visibleHoverPoint ? (
            <>
              <span className="shrink-0 font-medium text-foreground">{visibleHoverPoint.time}</span>
              <span className={HOVER_INFO_ITEM_CLASS}>开 {formatNumber(visibleHoverPoint.open)}</span>
              <span className={HOVER_INFO_ITEM_CLASS}>高 {formatNumber(visibleHoverPoint.high)}</span>
              <span className={HOVER_INFO_ITEM_CLASS}>低 {formatNumber(visibleHoverPoint.low)}</span>
              <span className={HOVER_INFO_ITEM_CLASS}>收 {formatNumber(visibleHoverPoint.close)}</span>
              <span className={HOVER_INFO_ITEM_CLASS}>涨跌幅 {formatPercent(visibleHoverPoint.changePercent)}</span>
              <span className={HOVER_INFO_ITEM_CLASS}>量 {formatLargeNumber(visibleHoverPoint.volume)}</span>
              <span className={HOVER_INFO_ITEM_CLASS}>额 {formatLargeNumber(visibleHoverPoint.amount)}</span>
              {visibleHoverPoint.ma5 !== undefined ? <span className={HOVER_INFO_ITEM_CLASS}>MA5 {formatNumber(visibleHoverPoint.ma5)}</span> : null}
              {visibleHoverPoint.ma10 !== undefined ? <span className={HOVER_INFO_ITEM_CLASS}>MA10 {formatNumber(visibleHoverPoint.ma10)}</span> : null}
              {visibleHoverPoint.ma20 !== undefined ? <span className={HOVER_INFO_ITEM_CLASS}>MA20 {formatNumber(visibleHoverPoint.ma20)}</span> : null}
            </>
          ) : (
            <span className={HOVER_INFO_ITEM_CLASS}>悬停查看 OHLC</span>
          )}
        </div>
      </div>
      <div
        ref={containerRef}
        data-testid="stock-kline-chart"
        className="h-[420px] min-h-[360px] w-full"
      />
    </div>
  );
};
