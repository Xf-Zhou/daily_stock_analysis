import type { Market } from '../types/stockIndex';

const A_SHARE_PREFIX_PATTERN = /^(SH|SZ)(\d{5,6})$/;
const BSE_PREFIX_PATTERN = /^BJ(\d{6})$/;
const HK_PREFIX_PATTERN = /^HK(\d{1,5})$/;
const A_SHARE_SUFFIXES = new Set(['SH', 'SZ', 'SS', 'BJ']);

export type WatchlistMarketResolver = (code: string) => Market | null | undefined;

const padHongKongCode = (value: string) => `HK${value.padStart(5, '0')}`;

const splitExchangeSuffix = (value: string): [string, string] | null => {
  const dotIndex = value.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === value.length - 1) {
    return null;
  }
  return [value.slice(0, dotIndex), value.slice(dotIndex + 1)];
};

export const normalizeWatchlistCode = (code: string, market?: Market | null): string => {
  const value = code.trim().toUpperCase();
  if (!value) {
    return '';
  }

  const hkPrefixMatch = value.match(HK_PREFIX_PATTERN);
  if (hkPrefixMatch) {
    return padHongKongCode(hkPrefixMatch[1]);
  }

  const aPrefixMatch = value.match(A_SHARE_PREFIX_PATTERN);
  if (aPrefixMatch) {
    return aPrefixMatch[2];
  }

  const bsePrefixMatch = value.match(BSE_PREFIX_PATTERN);
  if (bsePrefixMatch) {
    return bsePrefixMatch[1];
  }

  const suffixed = splitExchangeSuffix(value);
  if (suffixed) {
    const [base, suffix] = suffixed;
    if (suffix === 'HK' && /^\d{1,5}$/.test(base)) {
      return padHongKongCode(base);
    }
    if (A_SHARE_SUFFIXES.has(suffix) && /^\d{5,6}$/.test(base)) {
      return base;
    }
    return value;
  }

  if (market === 'HK' && /^\d{1,5}$/.test(value)) {
    return padHongKongCode(value);
  }

  return value;
};

export const toStockListStorageCode = (code: string, market?: Market | null): string => (
  normalizeWatchlistCode(code, market)
);

export const isSameStockCode = (left: string, right: string, market?: Market | null): boolean => (
  normalizeWatchlistCode(left, market) === normalizeWatchlistCode(right, market)
);

export const parseStockListValue = (value?: string | null): string[] => (
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

const getStorageCode = (
  code: string,
  market?: Market | null,
  resolveMarket?: WatchlistMarketResolver,
): string => toStockListStorageCode(code, market ?? resolveMarket?.(code));

const dedupeForStock = (codes: string[], resolveMarket?: WatchlistMarketResolver): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const code of codes) {
    const storageCode = getStorageCode(code, undefined, resolveMarket);
    if (!storageCode || seen.has(storageCode)) {
      continue;
    }
    seen.add(storageCode);
    deduped.push(storageCode);
  }
  return deduped;
};

export const addWatchlistCode = (
  codes: string[],
  code: string,
  market?: Market | null,
  resolveMarket?: WatchlistMarketResolver,
): string[] => {
  const storageCode = getStorageCode(code, market, resolveMarket);
  const normalizedCodes = dedupeForStock(codes, resolveMarket);
  if (normalizedCodes.some((item) => normalizeWatchlistCode(item) === storageCode)) {
    return normalizedCodes;
  }
  return [...normalizedCodes, storageCode];
};

export const removeWatchlistCode = (
  codes: string[],
  code: string,
  market?: Market | null,
  resolveMarket?: WatchlistMarketResolver,
): string[] => {
  const targetStorageCode = getStorageCode(code, market, resolveMarket);
  return dedupeForStock(
    codes.filter((item) => (
      getStorageCode(item, undefined, resolveMarket) !== targetStorageCode
      && normalizeWatchlistCode(item, market) !== targetStorageCode
    )),
    resolveMarket,
  );
};

export const formatStockListValue = (codes: string[]): string => codes.join(',');
