import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
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

type StockKLineChartProps = {
  data: KLineData[];
  className?: string;
};

export const StockKLineChart: React.FC<StockKLineChartProps> = ({ data, className }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const normalized = useMemo(() => normalizeKLineData(data), [data]);

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

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.setData(normalized.volumes);
    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    });

    chart.timeScale().fitContent();

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
        chart.remove();
      };
    }

    return () => {
      observer?.disconnect();
      chart.remove();
    };
  }, [normalized]);

  if (normalized.candles.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center rounded-xl border border-dashed border-border/60 bg-base/30 text-sm text-secondary-text">
        暂无可渲染的 K 线数据
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="stock-kline-chart"
      className={cn('h-[420px] min-h-[360px] w-full rounded-xl border border-border/50 bg-card/55 p-2', className)}
    />
  );
};
