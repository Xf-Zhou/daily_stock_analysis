import { useCallback, useEffect, useMemo, useState } from 'react';
import { systemConfigApi, SystemConfigConflictError } from '../api/systemConfig';
import type { Market, StockIndexItem } from '../types/stockIndex';
import {
  addWatchlistCode,
  formatStockListValue,
  isSameStockCode,
  parseStockListValue,
  removeWatchlistCode,
  type WatchlistMarketResolver,
} from '../utils/watchlist';

export type WatchlistNotice = {
  variant: 'success' | 'warning' | 'danger';
  title: string;
  message: string;
} | null;

type UseWatchlistConfigOptions = {
  index: StockIndexItem[];
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

export function useWatchlistConfig({ index }: UseWatchlistConfigOptions) {
  const [codes, setCodes] = useState<string[]>([]);
  const [configVersion, setConfigVersion] = useState('');
  const [maskToken, setMaskToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<WatchlistNotice>(null);

  const saving = Boolean(savingCode);
  const hasConfig = Boolean(configVersion);
  const disabled = loading || saving || Boolean(error) || !configVersion;
  const filterDisabled = loading || saving || (!configVersion && !error);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await systemConfigApi.getConfig(false);
      const stockList = payload.items.find((item) => item.key === 'STOCK_LIST')?.value ?? '';
      setCodes(parseStockListValue(stockList));
      setConfigVersion(payload.configVersion);
      setMaskToken(payload.maskToken);
      setError(null);
      return payload;
    } catch (requestError) {
      const message = getErrorMessage(requestError, '无法加载自选股配置');
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const resolveCodeMarket = useCallback<WatchlistMarketResolver>((stockCode) => {
    const trimmed = stockCode.trim();
    if (!trimmed) return undefined;
    const matched = index.find((item) => (
      item.active
      && item.assetType === 'stock'
      && (
        isSameStockCode(trimmed, item.canonicalCode, item.market)
        || isSameStockCode(trimmed, item.displayCode, item.market)
      )
    ));
    return matched?.market;
  }, [index]);

  const isWatchlisted = useCallback((stockCode: string, stockMarket?: Market | null) => (
    codes.some((code) => isSameStockCode(code, stockCode, stockMarket))
  ), [codes]);

  const isSavingStock = useCallback((stockCode: string, stockMarket?: Market | null) => (
    savingCode ? isSameStockCode(savingCode, stockCode, stockMarket) : false
  ), [savingCode]);

  const toggleWatchlist = useCallback(async (stockCode: string, stockName: string, stockMarket?: Market | null) => {
    if (disabled || savingCode) return;

    const starred = isWatchlisted(stockCode, stockMarket);
    const nextCodes = starred
      ? removeWatchlistCode(codes, stockCode, stockMarket, resolveCodeMarket)
      : addWatchlistCode(codes, stockCode, stockMarket, resolveCodeMarket);

    setSavingCode(stockCode);
    setNotice(null);
    try {
      const result = await systemConfigApi.update({
        configVersion,
        maskToken,
        reloadNow: true,
        items: [{ key: 'STOCK_LIST', value: formatStockListValue(nextCodes) }],
      });
      setCodes(nextCodes);
      if (result.configVersion) {
        setConfigVersion(result.configVersion);
      }
      setNotice({
        variant: 'success',
        title: starred ? '已移出自选' : '已加入自选',
        message: starred ? `${stockName} 已从 STOCK_LIST 移除` : `${stockName} 已追加到 STOCK_LIST`,
      });
    } catch (requestError) {
      if (requestError instanceof SystemConfigConflictError) {
        await loadConfig();
        setNotice({
          variant: 'warning',
          title: '自选配置已更新',
          message: '配置已被其他操作更新，请重试本次自选操作。',
        });
      } else {
        setNotice({
          variant: 'danger',
          title: '自选保存失败',
          message: getErrorMessage(requestError, '暂时无法保存自选股'),
        });
      }
    } finally {
      setSavingCode(null);
    }
  }, [
    codes,
    configVersion,
    disabled,
    isWatchlisted,
    loadConfig,
    maskToken,
    resolveCodeMarket,
    savingCode,
  ]);

  return useMemo(() => ({
    codes,
    loading,
    error,
    saving,
    savingCode,
    hasConfig,
    disabled,
    filterDisabled,
    notice,
    setNotice,
    loadConfig,
    isWatchlisted,
    isSavingStock,
    toggleWatchlist,
  }), [
    codes,
    disabled,
    error,
    filterDisabled,
    hasConfig,
    isSavingStock,
    isWatchlisted,
    loadConfig,
    loading,
    notice,
    saving,
    savingCode,
    toggleWatchlist,
  ]);
}
