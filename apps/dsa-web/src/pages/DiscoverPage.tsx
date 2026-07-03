import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  ChartCandlestick,
  LineChart,
  MessageSquareQuote,
  Play,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { analysisApi, DuplicateTaskError } from '../api/analysis';
import {
  stocksApi,
  type RankingDirection,
  type RankingMetric,
  type RankingStatus,
  type StockRankingItem,
} from '../api/stocks';
import { AppPage, Badge, Button, EmptyState, InlineAlert, Input, Pagination, Select, Tooltip } from '../components/common';
import { StockKLineDrawer } from '../components/stocks/StockKLineDrawer';
import { useStockIndex } from '../hooks/useStockIndex';
import type { Market } from '../types/stockIndex';
import { searchStocks } from '../utils/searchStocks';
import { cn } from '../utils/cn';

const UNCATEGORIZED_INDUSTRY = '__uncategorized__';
const STOCK_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const DEFAULT_STOCK_PAGE_SIZE = 50;
type DiscoverMarket = Extract<Market, 'CN' | 'BSE' | 'HK' | 'US'>;

const MARKET_OPTIONS: Array<{ value: DiscoverMarket; label: string }> = [
  { value: 'CN', label: '沪深 A 股' },
  { value: 'BSE', label: '北交所' },
  { value: 'HK', label: '港股' },
  { value: 'US', label: '美股' },
];

const RANKING_TABS: Array<{
  key: string;
  label: string;
  metric: RankingMetric;
  direction: RankingDirection;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'gainers', label: '涨幅', metric: 'change_pct', direction: 'desc', icon: TrendingUp },
  { key: 'losers', label: '跌幅', metric: 'change_pct', direction: 'asc', icon: TrendingDown },
  { key: 'amount', label: '成交额', metric: 'amount', direction: 'desc', icon: BarChart3 },
  { key: 'volume', label: '成交量', metric: 'volume', direction: 'desc', icon: LineChart },
];

const STATUS_META: Record<RankingStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
  ok: { label: '实时', variant: 'success' },
  partial: { label: '部分', variant: 'warning' },
  stale: { label: '缓存', variant: 'warning' },
  unsupported: { label: '不可用', variant: 'default' },
  unavailable: { label: '失败', variant: 'danger' },
};

type ActionNotice = {
  variant: 'success' | 'warning' | 'danger';
  title: string;
  message: string;
} | null;

const formatNumber = (value?: number | null, options?: Intl.NumberFormatOptions) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('zh-CN', options).format(value);
};

const formatAmount = (value?: number | null) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  if (Math.abs(value) >= 100000000) return `${formatNumber(value / 100000000, { maximumFractionDigits: 2 })} 亿`;
  if (Math.abs(value) >= 10000) return `${formatNumber(value / 10000, { maximumFractionDigits: 2 })} 万`;
  return formatNumber(value, { maximumFractionDigits: 0 });
};

const formatPct = (value?: number | null) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return `${value > 0 ? '+' : ''}${formatNumber(value, { maximumFractionDigits: 2 })}%`;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

const getChangeClass = (value?: number | null) => {
  if (value === undefined || value === null) return 'text-secondary-text';
  if (value > 0) return 'text-success';
  if (value < 0) return 'text-danger';
  return 'text-secondary-text';
};

const DiscoverPage: React.FC = () => {
  const navigate = useNavigate();
  const { index, loading, error, fallback } = useStockIndex();
  const [market, setMarket] = useState<DiscoverMarket>('CN');
  const [keyword, setKeyword] = useState('');
  const [industry, setIndustry] = useState('');
  const [rankingKey, setRankingKey] = useState('gainers');
  const [rankings, setRankings] = useState<StockRankingItem[]>([]);
  const [rankingStatus, setRankingStatus] = useState<RankingStatus>('unsupported');
  const [rankingUpdatedAt, setRankingUpdatedAt] = useState<string | null>(null);
  const [rankingMessage, setRankingMessage] = useState<string | null>(null);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingError, setRankingError] = useState<string | null>(null);
  const [analyzingCode, setAnalyzingCode] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice>(null);
  const [stockPage, setStockPage] = useState(1);
  const [stockPageSize, setStockPageSize] = useState(DEFAULT_STOCK_PAGE_SIZE);
  const [kLineStock, setKLineStock] = useState<{ code: string; name: string } | null>(null);

  const activeRanking = RANKING_TABS.find((tab) => tab.key === rankingKey) ?? RANKING_TABS[0];

  const marketStocks = useMemo(
    () => index.filter((item) => item.active && item.assetType === 'stock' && item.market === market),
    [index, market],
  );

  const keywordFilteredStocks = useMemo(() => {
    const trimmed = keyword.trim();
    if (!trimmed) return marketStocks;
    const matchedCodes = new Set(
      searchStocks(trimmed, index, { activeOnly: true, limit: index.length })
        .map((suggestion) => suggestion.canonicalCode)
    );
    return marketStocks.filter((item) => matchedCodes.has(item.canonicalCode));
  }, [index, keyword, marketStocks]);

  const industryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let uncategorized = 0;
    for (const item of keywordFilteredStocks) {
      if (item.industry) {
        counts.set(item.industry, (counts.get(item.industry) ?? 0) + 1);
      } else {
        uncategorized += 1;
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
    return [
      { value: '', label: `全部 (${keywordFilteredStocks.length})` },
      ...sorted.map(([value, count]) => ({ value, label: `${value} (${count})` })),
      ...(uncategorized > 0 ? [{ value: UNCATEGORIZED_INDUSTRY, label: `未分类 (${uncategorized})` }] : []),
    ];
  }, [keywordFilteredStocks]);

  useEffect(() => {
    if (!industryOptions.some((option) => option.value === industry)) {
      setIndustry('');
    }
  }, [industry, industryOptions]);

  const filteredStocks = useMemo(() => {
    if (industry === UNCATEGORIZED_INDUSTRY) {
      return keywordFilteredStocks.filter((item) => !item.industry);
    }
    if (industry) {
      return keywordFilteredStocks.filter((item) => item.industry === industry);
    }
    return keywordFilteredStocks;
  }, [industry, keywordFilteredStocks]);

  useEffect(() => {
    setStockPage(1);
  }, [industry, keyword, market]);

  const coverage = useMemo(() => {
    const denominator = keywordFilteredStocks.length;
    const numerator = keywordFilteredStocks.filter((item) => Boolean(item.industry)).length;
    return {
      numerator,
      denominator,
      percent: denominator > 0 ? Math.round((numerator / denominator) * 100) : 0,
    };
  }, [keywordFilteredStocks]);

  useEffect(() => {
    let cancelled = false;
    setRankingLoading(true);
    setRankingError(null);
    setRankingMessage(null);

    stocksApi.getRankings({
      market,
      industry: industry || undefined,
      metric: activeRanking.metric,
      direction: activeRanking.direction,
      limit: 20,
    })
      .then((payload) => {
        if (cancelled) return;
        setRankings(payload.items ?? []);
        setRankingStatus(payload.status);
        setRankingUpdatedAt(payload.updatedAt ?? null);
        setRankingMessage(payload.message ?? null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setRankings([]);
        setRankingStatus('unsupported');
        setRankingMessage(null);
        setRankingError(getErrorMessage(requestError, '榜单暂时不可用'));
      })
      .finally(() => {
        if (!cancelled) setRankingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRanking.direction, activeRanking.metric, industry, market]);

  const handleAnalyze = useCallback(async (stockCode: string, stockName: string) => {
    setAnalyzingCode(stockCode);
    setActionNotice(null);
    try {
      const result = await analysisApi.analyzeAsync({
        stockCode,
        stockName,
        originalQuery: stockCode,
        selectionSource: 'discover',
        asyncMode: true,
      });
      const taskId = 'taskId' in result ? result.taskId : result.accepted?.[0]?.taskId;
      setActionNotice({
        variant: 'success',
        title: '已提交分析',
        message: taskId ? `任务 ${taskId} 已进入队列` : `${stockName} 已进入分析队列`,
      });
    } catch (requestError) {
      if (requestError instanceof DuplicateTaskError) {
        setActionNotice({
          variant: 'warning',
          title: '分析已在进行',
          message: requestError.message,
        });
      } else {
        setActionNotice({
          variant: 'danger',
          title: '提交失败',
          message: getErrorMessage(requestError, '暂时无法提交分析任务'),
        });
      }
    } finally {
      setAnalyzingCode(null);
    }
  }, []);

  const handleAsk = useCallback((stockCode: string, stockName: string) => {
    navigate(`/chat?stock=${encodeURIComponent(stockCode)}&name=${encodeURIComponent(stockName)}`);
  }, [navigate]);

  const handleOpenKLine = useCallback((stockCode: string, stockName: string) => {
    setKLineStock({ code: stockCode, name: stockName });
  }, []);

  const handleStockPageSizeChange = useCallback((value: string) => {
    const parsed = Number(value);
    const nextSize = STOCK_PAGE_SIZE_OPTIONS.find((option) => option === parsed) ?? DEFAULT_STOCK_PAGE_SIZE;
    setStockPageSize(nextSize);
    setStockPage(1);
  }, []);

  const totalStockPages = Math.max(1, Math.ceil(filteredStocks.length / stockPageSize));
  const clampedStockPage = Math.min(stockPage, totalStockPages);
  const pageStartIndex = (clampedStockPage - 1) * stockPageSize;
  const visibleStocks = filteredStocks.slice(pageStartIndex, pageStartIndex + stockPageSize);
  const visibleStart = filteredStocks.length > 0 ? pageStartIndex + 1 : 0;
  const visibleEnd = pageStartIndex + visibleStocks.length;
  const statusMeta = STATUS_META[rankingStatus];
  const rankingEmptyTitle = rankingStatus === 'unsupported'
    ? '暂无榜单数据'
    : rankingStatus === 'unavailable'
      ? '行情源不可用'
      : '没有匹配榜单';
  const rankingEmptyDescription = rankingStatus === 'unavailable'
    ? rankingMessage || '批量行情源暂不可用，且没有可用缓存'
    : '';

  return (
    <AppPage className="space-y-4">
      <section data-testid="discover-compact-toolbar" className="glass-panel-lg px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="label-uppercase text-[10px]">DISCOVER</span>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">股票发现</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">{MARKET_OPTIONS.find((option) => option.value === market)?.label}</Badge>
              <Badge variant={coverage.percent >= 60 ? 'success' : coverage.percent > 0 ? 'warning' : 'default'}>
                行业覆盖 {coverage.numerator}/{coverage.denominator}
              </Badge>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[160px_minmax(220px,1fr)_220px] xl:grid-cols-[160px_minmax(260px,1fr)_220px_minmax(360px,0.7fr)] xl:items-end">
            <Select
              label="市场"
              value={market}
              onChange={(value) => setMarket(value as DiscoverMarket)}
              options={MARKET_OPTIONS}
            />
            <Input
              label="关键词"
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="代码、名称、拼音、别名"
              trailingAction={<Search className="h-4 w-4 text-muted-text" />}
            />
            <Select
              label="行业"
              value={industry}
              onChange={setIndustry}
              options={industryOptions}
              disabled={loading || industryOptions.length <= 1}
            />
            <div data-testid="discover-compact-metrics" className="grid grid-cols-3 gap-2 md:col-span-3 xl:col-span-1">
              <CompactMetric label="当前市场" value={formatNumber(marketStocks.length)} />
              <CompactMetric label="当前结果" value={formatNumber(filteredStocks.length)} />
              <CompactMetric label="行业覆盖率" value={`${coverage.percent}%`} />
            </div>
          </div>
        </div>
      </section>

      {error || fallback ? (
        <InlineAlert
          variant="warning"
          title="静态索引未完整加载"
          message={error?.message || '当前仅能显示已加载的数据'}
        />
      ) : null}

      {actionNotice ? (
        <InlineAlert
          variant={actionNotice.variant}
          title={actionNotice.title}
          message={actionNotice.message}
        />
      ) : null}

      <section className="glass-panel-lg px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {RANKING_TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setRankingKey(key)}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-all',
                  rankingKey === key
                    ? 'border-cyan/35 bg-cyan/12 text-cyan'
                    : 'border-border/60 bg-elevated/35 text-secondary-text hover:bg-hover hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-secondary-text">
            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
            {market === 'US' ? <Badge variant="info">核心池</Badge> : null}
            {rankingUpdatedAt ? <span>{new Date(rankingUpdatedAt).toLocaleString('zh-CN')}</span> : null}
          </div>
        </div>

        {rankingError ? (
          <div className="mt-4">
            <InlineAlert variant="warning" title="榜单不可用" message={rankingError} />
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          {rankingLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-lg border border-border/50 bg-elevated/35" />
            ))
          ) : rankings.length > 0 ? (
            rankings.slice(0, 8).map((item, index) => (
              <RankingTile
                key={`${item.code}-${index}`}
                item={item}
                rank={index + 1}
                onAnalyze={handleAnalyze}
                onAsk={handleAsk}
                onOpenKLine={handleOpenKLine}
                analyzingCode={analyzingCode}
              />
            ))
          ) : (
            <div className="lg:col-span-2 xl:col-span-4">
              <EmptyState
                title={rankingEmptyTitle}
                description={rankingEmptyDescription}
                icon={<AlertCircle className="h-6 w-6" />}
              />
            </div>
          )}
        </div>
      </section>

      <section className="glass-panel-lg px-4 py-4">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">可关注股票</h2>
            <span className="mt-1 block text-xs text-secondary-text">
              {filteredStocks.length > 0
                ? `显示 ${visibleStart}-${visibleEnd} / ${filteredStocks.length}`
                : '0 只'}
            </span>
          </div>
          <Select
            label="每页"
            value={String(stockPageSize)}
            onChange={handleStockPageSizeChange}
            options={STOCK_PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: `${size} 条` }))}
            className="w-full sm:w-32"
            disabled={loading || filteredStocks.length === 0}
          />
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-lg bg-elevated/40" />
            ))}
          </div>
        ) : visibleStocks.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border/45 bg-base/20">
            <div data-testid="discover-stock-table-scroll" className="max-h-[520px] overflow-auto">
              <table className="min-w-[860px] w-full text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-border/60 bg-card/95 text-xs uppercase text-muted-text backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 font-medium">代码</th>
                    <th className="px-3 py-2 font-medium">名称</th>
                    <th className="px-3 py-2 font-medium">市场</th>
                    <th className="px-3 py-2 font-medium">行业</th>
                    <th className="w-[250px] px-3 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/45">
                  {visibleStocks.map((item) => (
                    <tr key={item.canonicalCode} className="transition-colors hover:bg-hover/60">
                      <td className="px-3 py-3 font-mono text-sm text-foreground">{item.displayCode}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-foreground">{item.nameZh}</div>
                        <div className="text-xs text-muted-text">{item.canonicalCode}</div>
                      </td>
                      <td className="px-3 py-3 text-secondary-text">
                        {MARKET_OPTIONS.find((option) => option.value === item.market)?.label ?? item.market}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={item.industry ? 'info' : 'default'}>
                          {item.industry || '未分类'}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Tooltip content="查看 K 线">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="w-9 px-0"
                              onClick={() => handleOpenKLine(item.canonicalCode, item.nameZh)}
                              aria-label={`查看 ${item.nameZh} K线`}
                            >
                              <ChartCandlestick className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleAnalyze(item.canonicalCode, item.nameZh)}
                            isLoading={analyzingCode === item.canonicalCode}
                            loadingText="分析中"
                          >
                            <Play className="h-4 w-4" />
                            分析
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleAsk(item.canonicalCode, item.nameZh)}
                          >
                            <MessageSquareQuote className="h-4 w-4" />
                            问股
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalStockPages > 1 ? (
              <div className="border-t border-border/45 bg-card/80 px-3 py-3">
                <Pagination
                  currentPage={clampedStockPage}
                  totalPages={totalStockPages}
                  onPageChange={setStockPage}
                  className="justify-end"
                />
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState title="没有匹配股票" description="" icon={<Search className="h-6 w-6" />} />
        )}
      </section>

      <StockKLineDrawer
        isOpen={Boolean(kLineStock)}
        stockCode={kLineStock?.code}
        stockName={kLineStock?.name}
        onClose={() => setKLineStock(null)}
      />
    </AppPage>
  );
};

type CompactMetricProps = {
  label: string;
  value: string;
};

const CompactMetric: React.FC<CompactMetricProps> = ({ label, value }) => (
  <div className="min-w-0 rounded-lg border border-border/55 bg-elevated/30 px-3 py-2">
    <div className="truncate text-[11px] leading-4 text-muted-text">{label}</div>
    <div className="truncate text-sm font-semibold leading-5 text-foreground">{value}</div>
  </div>
);

type RankingTileProps = {
  item: StockRankingItem;
  rank: number;
  analyzingCode: string | null;
  onAnalyze: (stockCode: string, stockName: string) => Promise<void>;
  onAsk: (stockCode: string, stockName: string) => void;
  onOpenKLine: (stockCode: string, stockName: string) => void;
};

const RankingTile: React.FC<RankingTileProps> = ({
  item,
  rank,
  analyzingCode,
  onAnalyze,
  onAsk,
  onOpenKLine,
}) => (
  <div className="rounded-lg border border-border/55 bg-elevated/35 p-4 transition-colors hover:bg-hover/60">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-cyan/12 text-xs font-semibold text-cyan">
            {rank}
          </span>
          <span className="truncate text-sm font-semibold text-foreground">{item.name}</span>
        </div>
        <div className="mt-1 font-mono text-xs text-muted-text">{item.code}</div>
      </div>
      <div className={cn('shrink-0 text-right text-sm font-semibold', getChangeClass(item.changePct))}>
        {formatPct(item.changePct)}
      </div>
    </div>
    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
      <ValueCell label="价格" value={formatNumber(item.price, { maximumFractionDigits: 3 })} />
      <ValueCell label="成交额" value={formatAmount(item.amount)} />
      <ValueCell label="成交量" value={formatAmount(item.volume)} />
    </div>
    <div className="mt-3 flex items-center justify-between gap-2">
      <Badge variant={item.industry ? 'info' : 'default'}>{item.industry || '未分类'}</Badge>
      <div className="flex gap-1.5">
        <Tooltip content="查看 K 线">
          <Button
            size="xsm"
            variant="ghost"
            onClick={() => onOpenKLine(item.code, item.name)}
            aria-label={`查看 ${item.name} K线`}
          >
            <ChartCandlestick className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
        <Button
          size="xsm"
          variant="secondary"
          onClick={() => void onAnalyze(item.code, item.name)}
          isLoading={analyzingCode === item.code}
          loadingText=""
          aria-label={`分析 ${item.name}`}
        >
          <Play className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="xsm"
          variant="ghost"
          onClick={() => onAsk(item.code, item.name)}
          aria-label={`问股 ${item.name}`}
        >
          <MessageSquareQuote className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  </div>
);

type ValueCellProps = {
  label: string;
  value: string;
};

const ValueCell: React.FC<ValueCellProps> = ({ label, value }) => (
  <div className="min-w-0 rounded-md bg-base/35 px-2 py-2">
    <div className="truncate text-muted-text">{label}</div>
    <div className="mt-1 truncate font-medium text-foreground">{value}</div>
  </div>
);

export default DiscoverPage;
