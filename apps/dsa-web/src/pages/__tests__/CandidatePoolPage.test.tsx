import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CandidatePoolPage from '../CandidatePoolPage';
import { analysisApi, DuplicateTaskError } from '../../api/analysis';
import { stocksApi } from '../../api/stocks';
import { systemConfigApi } from '../../api/systemConfig';
import { useStockIndex } from '../../hooks/useStockIndex';
import type { StockIndexItem } from '../../types/stockIndex';
import type { SystemConfigResponse } from '../../types/systemConfig';

vi.mock('../../hooks/useStockIndex', () => ({
  useStockIndex: vi.fn(),
}));

vi.mock('../../api/stocks', () => ({
  stocksApi: {
    getRankings: vi.fn(),
  },
}));

vi.mock('../../api/analysis', () => {
  class MockDuplicateTaskError extends Error {
    stockCode: string;
    existingTaskId: string;

    constructor(stockCode: string, existingTaskId: string, message?: string) {
      super(message || `股票 ${stockCode} 正在分析中`);
      this.name = 'DuplicateTaskError';
      this.stockCode = stockCode;
      this.existingTaskId = existingTaskId;
    }
  }

  return {
    analysisApi: {
      analyzeAsync: vi.fn(),
    },
    DuplicateTaskError: MockDuplicateTaskError,
  };
});

vi.mock('../../api/systemConfig', () => ({
  systemConfigApi: {
    getConfig: vi.fn(),
    update: vi.fn(),
  },
  SystemConfigConflictError: class MockSystemConfigConflictError extends Error {},
}));

vi.mock('../../components/stocks/StockKLineDrawer', () => ({
  StockKLineDrawer: ({
    isOpen,
    stockCode,
    stockName,
  }: {
    isOpen: boolean;
    stockCode?: string;
    stockName?: string;
  }) => (isOpen ? <div data-testid="candidate-kline-drawer">{stockName} {stockCode}</div> : null),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const index: StockIndexItem[] = [
  {
    canonicalCode: '600519.SH',
    displayCode: '600519',
    nameZh: '贵州茅台',
    pinyinFull: 'guizhoumaotai',
    pinyinAbbr: 'gzmt',
    aliases: ['茅台'],
    market: 'CN',
    assetType: 'stock',
    active: true,
    popularity: 100,
    industry: '白酒',
    industrySource: 'override',
  },
  {
    canonicalCode: '000001.SZ',
    displayCode: '000001',
    nameZh: '平安银行',
    pinyinFull: 'pinganyinhang',
    pinyinAbbr: 'payh',
    aliases: ['平银'],
    market: 'CN',
    assetType: 'stock',
    active: true,
    popularity: 90,
    industry: '银行',
    industrySource: 'tushare',
  },
  {
    canonicalCode: '000002.SZ',
    displayCode: '000002',
    nameZh: '万科A',
    pinyinFull: 'wankea',
    pinyinAbbr: 'wka',
    aliases: [],
    market: 'CN',
    assetType: 'stock',
    active: true,
    popularity: 80,
  },
];

const createConfigResponse = (stockList: string): SystemConfigResponse => ({
  configVersion: 'config-v1',
  maskToken: 'mask-1',
  items: [
    {
      key: 'STOCK_LIST',
      value: stockList,
      rawValueExists: true,
      isMasked: false,
    },
  ],
});

describe('CandidatePoolPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    vi.mocked(useStockIndex).mockReturnValue({
      index,
      loading: false,
      error: null,
      fallback: false,
      loaded: true,
    });
    vi.mocked(stocksApi.getRankings).mockResolvedValue({
      status: 'ok',
      source: 'mock',
      updatedAt: '2026-07-05T00:00:00+08:00',
      items: [
        {
          code: '600519.SH',
          name: '贵州茅台',
          market: 'CN',
          industry: '白酒',
          price: 1500,
          changePct: 2.2,
          amount: 300000000,
          volume: 2000000,
        },
      ],
    });
    vi.mocked(systemConfigApi.getConfig).mockResolvedValue(createConfigResponse('600519'));
    vi.mocked(systemConfigApi.update).mockResolvedValue({
      success: true,
      configVersion: 'config-v2',
      appliedCount: 1,
      skippedMaskedCount: 0,
      reloadTriggered: true,
      updatedKeys: ['STOCK_LIST'],
      warnings: [],
    });
    vi.mocked(analysisApi.analyzeAsync).mockResolvedValue({
      taskId: 'task-1',
      status: 'pending',
    });
  });

  it('renders the candidate page title and a static candidate base', async () => {
    render(
      <MemoryRouter>
        <CandidatePoolPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '推荐关注' })).toBeInTheDocument();
    expect(screen.getByTestId('candidate-page')).toHaveClass('max-w-[2160px]');
    expect(screen.getByTestId('candidate-search-field')).toHaveClass('2xl:max-w-[720px]');
    expect(screen.getByTestId('candidate-filter-grid')).toHaveClass(
      '2xl:grid-cols-[160px_minmax(260px,720px)_220px_180px_auto]',
    );
    expect(screen.getByTestId('candidate-toolbar')).toHaveAttribute('data-slot', 'toolbar');
    expect(screen.getByTestId('candidate-table-scroll')).toHaveAttribute('data-slot', 'data-table');
    expect(screen.getByText('规则评分')).toBeInTheDocument();
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
    expect(screen.getByText('平安银行')).toBeInTheDocument();

    await waitFor(() => {
      expect(stocksApi.getRankings).toHaveBeenCalledWith(
        expect.objectContaining({ metric: 'amount', direction: 'desc', limit: 100 }),
        expect.any(AbortSignal),
      );
    });
  });

  it('does not add ranking stocks that are outside the static keyword filter', async () => {
    vi.mocked(stocksApi.getRankings).mockResolvedValue({
      status: 'ok',
      source: 'mock',
      updatedAt: '2026-07-05T00:00:00+08:00',
      items: [
        {
          code: '000001.SZ',
          name: '平安银行',
          market: 'CN',
          industry: '银行',
          price: 10,
          changePct: 4.1,
          amount: 900000000,
          volume: 10000000,
        },
      ],
    });

    render(
      <MemoryRouter>
        <CandidatePoolPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: '茅台' } });

    expect(await screen.findByText('贵州茅台')).toBeInTheDocument();
    expect(screen.queryByText('平安银行')).not.toBeInTheDocument();
  });

  it('skips follow-up ranking requests when the primary ranking has no items', async () => {
    vi.mocked(stocksApi.getRankings).mockResolvedValue({
      status: 'unavailable',
      source: null,
      updatedAt: null,
      items: [],
    });

    render(
      <MemoryRouter>
        <CandidatePoolPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(stocksApi.getRankings).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('静态候选')).toBeInTheDocument();
  });

  it('continues loading follow-up rankings when primary ranking is partial and empty', async () => {
    vi.mocked(stocksApi.getRankings)
      .mockResolvedValueOnce({
        status: 'partial',
        source: null,
        updatedAt: null,
        items: [],
      })
      .mockResolvedValueOnce({
        status: 'ok',
        source: 'mock',
        updatedAt: '2026-07-05T00:00:00+08:00',
        items: [
          {
            code: '600519.SH',
            name: '贵州茅台',
            market: 'CN',
            industry: '白酒',
            price: 1500,
            changePct: 3.6,
            amount: null,
            volume: 800000,
          },
        ],
      })
      .mockResolvedValueOnce({
        status: 'ok',
        source: 'mock',
        updatedAt: '2026-07-05T00:00:00+08:00',
        items: [],
      });

    render(
      <MemoryRouter>
        <CandidatePoolPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('涨幅靠前')).toBeInTheDocument();
    expect(stocksApi.getRankings).toHaveBeenCalledTimes(3);
  });

  it('renders planned price, volume, and quote-status columns', async () => {
    render(
      <MemoryRouter>
        <CandidatePoolPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('columnheader', { name: '价格' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '成交量' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '行情状态' })).toBeInTheDocument();
    expect(screen.getByText('1,500')).toBeInTheDocument();
    expect(screen.getByText('200 万')).toBeInTheDocument();
    expect(screen.getAllByText('实时').length).toBeGreaterThan(0);
  });

  it('does not refetch rankings when only hiding watchlisted stocks changes', async () => {
    render(
      <MemoryRouter>
        <CandidatePoolPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(stocksApi.getRankings).toHaveBeenCalledTimes(3);
    });

    fireEvent.click(screen.getByRole('button', { name: '隐藏已自选' }));

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(stocksApi.getRankings).toHaveBeenCalledTimes(3);
  });

  it('shows cached ranking signals immediately while refreshing in the background', async () => {
    window.sessionStorage.setItem('dsa:candidate-rankings:v1:CN::balanced', JSON.stringify({
      cachedAt: Date.now(),
      signals: [
        {
          key: 'amount',
          status: 'ok',
          items: [
            {
              code: '000001.SZ',
              name: '平安银行',
              market: 'CN',
              industry: '银行',
              price: 10.88,
              changePct: 1.6,
              amount: 880000000,
              volume: 6600000,
            },
          ],
        },
      ],
    }));
    let resolveRanking: (value: Awaited<ReturnType<typeof stocksApi.getRankings>>) => void = () => {};
    vi.mocked(stocksApi.getRankings).mockReturnValue(new Promise((resolve) => {
      resolveRanking = resolve;
    }));

    render(
      <MemoryRouter>
        <CandidatePoolPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('10.88')).toBeInTheDocument();
    expect(screen.getByText('缓存行情')).toBeInTheDocument();
    expect(stocksApi.getRankings).toHaveBeenCalledTimes(1);

    resolveRanking({
      status: 'ok',
      source: 'mock',
      updatedAt: '2026-07-05T00:00:00+08:00',
      items: [
        {
          code: '600519.SH',
          name: '贵州茅台',
          market: 'CN',
          industry: '白酒',
          price: 1500,
          changePct: 2.2,
          amount: 300000000,
          volume: 2000000,
        },
      ],
    });
  });

  it('uses candidate_pool selection source when submitting analysis', async () => {
    vi.mocked(analysisApi.analyzeAsync).mockRejectedValueOnce(
      new DuplicateTaskError('600519.SH', 'task-1', '股票 600519.SH 正在分析中'),
    );

    render(
      <MemoryRouter>
        <CandidatePoolPage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /分析 贵州茅台/ }));

    await waitFor(() => {
      expect(analysisApi.analyzeAsync).toHaveBeenCalledWith(expect.objectContaining({
        stockCode: '600519.SH',
        stockName: '贵州茅台',
        selectionSource: 'candidate_pool',
        asyncMode: true,
      }));
    });
    expect(await screen.findByText('分析已在进行')).toBeInTheDocument();
  });

  it('keeps browsing usable when watchlist config fails', async () => {
    vi.mocked(systemConfigApi.getConfig).mockRejectedValueOnce(new Error('配置服务不可用'));

    render(
      <MemoryRouter>
        <CandidatePoolPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('自选配置不可用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加入自选 平安银行' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /分析 平安银行/ })).not.toBeDisabled();
  });
});
