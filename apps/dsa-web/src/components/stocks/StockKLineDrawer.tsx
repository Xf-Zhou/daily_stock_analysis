import type React from 'react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ChartCandlestick, RefreshCw } from 'lucide-react';
import { stocksApi, type KLineData, type StockHistoryDays } from '../../api/stocks';
import { Badge, Drawer, EmptyState, InlineAlert } from '../common';
import { StockKLineChart } from './StockKLineChart';
import { cn } from '../../utils/cn';

const DAY_OPTIONS: StockHistoryDays[] = [30, 90, 180, 365];
const DEFAULT_DAYS: StockHistoryDays = 90;

type StockKLineDrawerProps = {
  isOpen: boolean;
  stockCode?: string;
  stockName?: string;
  onClose: () => void;
};

type KLineRequestState = {
  data: KLineData[];
  loading: boolean;
  error: string | null;
  requestKey: string | null;
};

type KLineRequestAction =
  | { type: 'loading'; requestKey: string }
  | { type: 'success'; requestKey: string; data: KLineData[] }
  | { type: 'error'; requestKey: string; message: string }
  | { type: 'reset' };

const INITIAL_KLINE_REQUEST_STATE: KLineRequestState = {
  data: [],
  loading: false,
  error: null,
  requestKey: null,
};

const buildRequestKey = (stockCode: string, days: StockHistoryDays) => `${stockCode}:${days}`;

const kLineRequestReducer = (
  state: KLineRequestState,
  action: KLineRequestAction,
): KLineRequestState => {
  switch (action.type) {
    case 'loading':
      return { data: [], loading: true, error: null, requestKey: action.requestKey };
    case 'success':
      return { data: action.data, loading: false, error: null, requestKey: action.requestKey };
    case 'error':
      return { data: [], loading: false, error: action.message, requestKey: action.requestKey };
    case 'reset':
      return INITIAL_KLINE_REQUEST_STATE;
    default:
      return state;
  }
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

const isAbortError = (error: unknown, signal: AbortSignal) => {
  if (signal.aborted) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { code?: string; name?: string };
    return maybeError.code === 'ERR_CANCELED' || maybeError.name === 'CanceledError';
  }
  return false;
};

export const StockKLineDrawer: React.FC<StockKLineDrawerProps> = ({
  isOpen,
  stockCode,
  stockName,
  onClose,
}) => {
  const [days, setDays] = useState<StockHistoryDays>(DEFAULT_DAYS);
  const [{ data, loading, error, requestKey }, dispatch] = useReducer(
    kLineRequestReducer,
    INITIAL_KLINE_REQUEST_STATE,
  );
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelPendingRequest = useCallback(() => {
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    cancelPendingRequest();
    dispatch({ type: 'reset' });
    onClose();
  }, [cancelPendingRequest, onClose]);

  useEffect(() => {
    if (!isOpen || !stockCode) {
      cancelPendingRequest();
      return undefined;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const nextRequestKey = buildRequestKey(stockCode, days);

    dispatch({ type: 'loading', requestKey: nextRequestKey });

    stocksApi.getHistory(stockCode, { days, signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        dispatch({ type: 'success', requestKey: nextRequestKey, data: payload.data ?? [] });
      })
      .catch((requestError: unknown) => {
        if (isAbortError(requestError, controller.signal) || requestId !== requestIdRef.current) return;
        dispatch({
          type: 'error',
          requestKey: nextRequestKey,
          message: getErrorMessage(requestError, '暂时无法加载 K 线数据'),
        });
      });

    return () => {
      controller.abort();
    };
  }, [cancelPendingRequest, days, isOpen, stockCode]);

  const title = stockName ? `${stockName} K线` : stockCode ? `${stockCode} K线` : 'K线';
  const currentRequestKey = isOpen && stockCode ? buildRequestKey(stockCode, days) : null;
  const isCurrentRequest = currentRequestKey !== null && requestKey === currentRequestKey;
  const visibleData = isCurrentRequest ? data : [];
  const visibleError = isCurrentRequest ? error : null;
  const visibleLoading = Boolean(currentRequestKey) && (!isCurrentRequest || loading);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      width="max-w-5xl"
      side="right"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-border/50 bg-elevated/35 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">日 K</Badge>
              {stockCode ? <span className="font-mono text-sm text-secondary-text">{stockCode}</span> : null}
            </div>
            <div className="mt-2 truncate text-lg font-semibold text-foreground">
              {stockName || stockCode || '未选择股票'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="K线范围">
            {DAY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDays(option)}
                className={cn(
                  'inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium transition-colors',
                  days === option
                    ? 'border-cyan/35 bg-cyan/12 text-cyan'
                    : 'border-border/60 bg-card/70 text-secondary-text hover:bg-hover hover:text-foreground',
                )}
              >
                {option} 天
              </button>
            ))}
          </div>
        </div>

        {visibleError ? (
          <InlineAlert
            variant="warning"
            title="K 线加载失败"
            message={visibleError}
          />
        ) : null}

        {visibleLoading ? (
          <div className="flex h-[420px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 bg-base/25 text-secondary-text">
            <RefreshCw className="h-6 w-6 animate-spin text-cyan" />
            <span className="text-sm">正在加载 K 线...</span>
          </div>
        ) : visibleData.length > 0 ? (
          <StockKLineChart data={visibleData} />
        ) : visibleError ? null : (
          <EmptyState
            title="暂无 K 线数据，可能是行情源暂不可用。"
            description=""
            icon={<ChartCandlestick className="h-6 w-6" />}
          />
        )}
      </div>
    </Drawer>
  );
};
