import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DiscoverPage from '../DiscoverPage';
import { analysisApi, DuplicateTaskError } from '../../api/analysis';
import { stocksApi } from '../../api/stocks';
import { useStockIndex } from '../../hooks/useStockIndex';
import type { StockIndexItem } from '../../types/stockIndex';

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
  {
    canonicalCode: '00700.HK',
    displayCode: '00700',
    nameZh: '腾讯控股',
    pinyinFull: 'tengxunkonggu',
    pinyinAbbr: 'txkg',
    aliases: ['腾讯'],
    market: 'HK',
    assetType: 'stock',
    active: true,
    popularity: 95,
    industry: '互联网服务',
    industrySource: 'override',
  },
];

const createDiscoverStock = (idx: number): StockIndexItem => {
  const code = String(100000 + idx).padStart(6, '0');
  return {
    canonicalCode: `${code}.SZ`,
    displayCode: code,
    nameZh: `测试股票${idx}`,
    pinyinFull: `ceshigupiao${idx}`,
    pinyinAbbr: `csgp${idx}`,
    aliases: [],
    market: 'CN',
    assetType: 'stock',
    active: true,
    popularity: 1,
    industry: '测试行业',
    industrySource: 'override',
  };
};

describe('DiscoverPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      updatedAt: '2026-06-21T00:00:00+00:00',
      items: [],
    });
    vi.mocked(analysisApi.analyzeAsync).mockResolvedValue({
      taskId: 'task-1',
      status: 'pending',
    });
  });

  it('filters by keyword and calculates industry coverage after keyword filtering', async () => {
    render(
      <MemoryRouter>
        <DiscoverPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('行业覆盖 2/3')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: '平安' } });

    expect(screen.getByText('平安银行')).toBeInTheDocument();
    expect(screen.queryByText('贵州茅台')).not.toBeInTheDocument();
    expect(screen.getByText('行业覆盖 1/1')).toBeInTheDocument();

    await waitFor(() => {
      expect(stocksApi.getRankings).toHaveBeenCalledWith(expect.objectContaining({
        market: 'CN',
        metric: 'change_pct',
        direction: 'desc',
      }));
    });
  });

  it('renders discovery filters and metrics in a compact toolbar', () => {
    render(
      <MemoryRouter>
        <DiscoverPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('discover-compact-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('discover-compact-metrics')).toHaveTextContent('当前市场');
    expect(screen.getByTestId('discover-compact-metrics')).toHaveTextContent('当前结果');
    expect(screen.getByTestId('discover-compact-metrics')).toHaveTextContent('行业覆盖率');
  });

  it('distinguishes unavailable rankings from empty ranking results', async () => {
    vi.mocked(stocksApi.getRankings).mockResolvedValueOnce({
      status: 'unavailable',
      source: null,
      updatedAt: null,
      message: '批量行情源暂不可用，且没有可用缓存',
      items: [],
    });

    render(
      <MemoryRouter>
        <DiscoverPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('行情源不可用')).toBeInTheDocument();
    expect(screen.getByText('批量行情源暂不可用，且没有可用缓存')).toBeInTheDocument();
  });

  it('submits analysis with discover selection source and shows duplicate task feedback', async () => {
    vi.mocked(analysisApi.analyzeAsync).mockRejectedValueOnce(
      new DuplicateTaskError('600519.SH', 'task-1', '股票 600519.SH 正在分析中'),
    );

    render(
      <MemoryRouter>
        <DiscoverPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /分析/ })[0]);

    await waitFor(() => {
      expect(analysisApi.analyzeAsync).toHaveBeenCalledWith(expect.objectContaining({
        stockCode: '600519.SH',
        stockName: '贵州茅台',
        selectionSource: 'discover',
        asyncMode: true,
      }));
    });
    expect(await screen.findByText('分析已在进行')).toBeInTheDocument();
  });

  it('paginates the discoverable stock list with compact page sizes', async () => {
    const largeIndex = Array.from({ length: 125 }, (_, idx) => createDiscoverStock(idx + 1));
    vi.mocked(useStockIndex).mockReturnValue({
      index: largeIndex,
      loading: false,
      error: null,
      fallback: false,
      loaded: true,
    });

    render(
      <MemoryRouter>
        <DiscoverPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('显示 1-50 / 125')).toBeInTheDocument();
    expect(screen.getByText('测试股票1')).toBeInTheDocument();
    expect(screen.queryByText('测试股票51')).not.toBeInTheDocument();
    expect(screen.getByTestId('discover-stock-table-scroll')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '2' }));

    expect(screen.getByText('显示 51-100 / 125')).toBeInTheDocument();
    expect(screen.queryByText('测试股票1')).not.toBeInTheDocument();
    expect(screen.getByText('测试股票51')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('每页'), { target: { value: '100' } });

    expect(screen.getByText('显示 1-100 / 125')).toBeInTheDocument();
    expect(screen.getByText('测试股票1')).toBeInTheDocument();
    expect(screen.queryByText('测试股票101')).not.toBeInTheDocument();
  });
});
