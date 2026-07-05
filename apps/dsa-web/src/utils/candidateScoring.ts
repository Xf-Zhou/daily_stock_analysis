import type { RankingStatus, StockRankingItem } from '../api/stocks';
import type { Market, StockIndexItem } from '../types/stockIndex';
import { isSameStockCode } from './watchlist';

export type CandidateMode = 'balanced' | 'momentum' | 'liquidity' | 'pullback';
export type CandidatePoolStatus = 'live' | 'partial' | 'cached' | 'static' | 'empty';
export type CandidateQuoteStatus = 'live' | 'cached' | 'static';
export type CandidateSignalKey = 'gainers' | 'losers' | 'amount' | 'volume';

export type CandidateRankingSignal = {
  key: CandidateSignalKey;
  status: RankingStatus;
  items: StockRankingItem[];
};

export type CandidateItem = {
  code: string;
  displayCode: string;
  name: string;
  market: Market;
  industry?: string | null;
  price?: number | null;
  changePct?: number | null;
  amount?: number | null;
  volume?: number | null;
  quoteStatus: CandidateQuoteStatus;
  score: number;
  reasons: string[];
  isWatchlisted: boolean;
};

export type CandidatePoolResult = {
  status: CandidatePoolStatus;
  items: CandidateItem[];
};

type CandidatePoolOptions = {
  stocks: StockIndexItem[];
  signals: CandidateRankingSignal[];
  mode: CandidateMode;
  isWatchlisted: (stockCode: string, stockMarket?: Market | null) => boolean;
  maxItems?: number;
};

const MODE_WEIGHTS: Record<CandidateMode, Record<CandidateSignalKey, number>> = {
  balanced: { gainers: 16, losers: 0, amount: 22, volume: 18 },
  momentum: { gainers: 30, losers: 0, amount: 16, volume: 14 },
  liquidity: { gainers: 8, losers: 0, amount: 30, volume: 26 },
  pullback: { gainers: 0, losers: 26, amount: 18, volume: 14 },
};

const SIGNAL_REASONS: Record<CandidateSignalKey, string> = {
  gainers: '涨幅靠前',
  losers: '回调观察',
  amount: '成交额活跃',
  volume: '成交量靠前',
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const rankScore = (rank: number, total: number) => {
  if (total <= 1) return 1;
  return Math.max(0, (total - rank) / (total - 1));
};

const normalizePopularity = (popularity?: number | null) => {
  const value = Number(popularity ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value / 100));
};

const addReason = (reasons: string[], reason: string) => {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
};

const resolveStatus = (stocks: StockIndexItem[], signals: CandidateRankingSignal[]): CandidatePoolStatus => {
  if (stocks.length === 0) return 'empty';
  const populated = signals.filter((signal) => signal.items.length > 0);
  if (populated.length === 0) return 'static';
  if (
    signals.some((signal) => signal.status !== 'ok' || signal.items.length === 0)
    || populated.length !== signals.length
  ) {
    if (populated.length === signals.length && populated.every((signal) => signal.status === 'stale')) {
      return 'cached';
    }
    return 'partial';
  }
  return 'live';
};

export function buildCandidatePool({
  stocks,
  signals,
  mode,
  isWatchlisted,
  maxItems = 100,
}: CandidatePoolOptions): CandidatePoolResult {
  const candidateMap = new Map<string, CandidateItem>();

  for (const stock of stocks) {
    const watchlisted = isWatchlisted(stock.canonicalCode, stock.market);
    const reasons: string[] = [];
    if (stock.industry) addReason(reasons, '行业匹配');
    if ((stock.popularity ?? 0) > 0) addReason(reasons, '静态热度');
    if (watchlisted) addReason(reasons, '已自选');

    candidateMap.set(stock.canonicalCode, {
      code: stock.canonicalCode,
      displayCode: stock.displayCode,
      name: stock.nameZh,
      market: stock.market,
      industry: stock.industry,
      quoteStatus: 'static',
      score: 28 + normalizePopularity(stock.popularity) * 22,
      reasons,
      isWatchlisted: watchlisted,
    });
  }

  const weights = MODE_WEIGHTS[mode];
  for (const signal of signals) {
    const total = signal.items.length;
    signal.items.forEach((item, index) => {
      const candidate = [...candidateMap.values()].find((entry) => (
        isSameStockCode(entry.code, item.code, entry.market)
      ));
      if (!candidate) return;

      const weight = weights[signal.key] ?? 0;
      if (weight > 0) {
        candidate.score += rankScore(index, total) * weight + weight * 0.2;
        addReason(candidate.reasons, SIGNAL_REASONS[signal.key]);
      }

      candidate.price = item.price ?? candidate.price;
      candidate.changePct = item.changePct ?? candidate.changePct;
      candidate.amount = item.amount ?? candidate.amount;
      candidate.volume = item.volume ?? candidate.volume;
      candidate.industry = item.industry ?? candidate.industry;
      if (signal.status !== 'unsupported' && signal.status !== 'unavailable') {
        const quoteStatus = signal.status === 'stale' ? 'cached' : 'live';
        if (candidate.quoteStatus !== 'live') {
          candidate.quoteStatus = quoteStatus;
        }
      }
    });
  }

  const items = [...candidateMap.values()]
    .map((item) => ({ ...item, score: clampScore(item.score) }))
    .sort((a, b) => b.score - a.score || b.reasons.length - a.reasons.length || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, maxItems);

  return {
    status: resolveStatus(stocks, signals),
    items,
  };
}
