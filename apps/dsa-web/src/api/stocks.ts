import apiClient from './index';
import { toCamelCase } from './utils';
import type { Market } from '../types/stockIndex';

export type ExtractItem = {
  code?: string | null;
  name?: string | null;
  confidence: string;
};

export type ExtractFromImageResponse = {
  codes: string[];
  items?: ExtractItem[];
  rawText?: string;
};

export type RankingMetric = 'change_pct' | 'amount' | 'volume';
export type RankingDirection = 'asc' | 'desc';
export type RankingStatus = 'ok' | 'partial' | 'stale' | 'unsupported';

export type StockRankingItem = {
  code: string;
  name: string;
  market: Market;
  industry?: string | null;
  price?: number | null;
  changePct?: number | null;
  amount?: number | null;
  volume?: number | null;
  source?: string | null;
  updatedAt?: string | null;
};

export type StockRankingsResponse = {
  status: RankingStatus;
  source?: string | null;
  updatedAt?: string | null;
  items: StockRankingItem[];
};

export type StockRankingsParams = {
  market: Extract<Market, 'CN' | 'BSE' | 'HK' | 'US'>;
  industry?: string;
  metric?: RankingMetric;
  direction?: RankingDirection;
  limit?: number;
};

export const stocksApi = {
  async extractFromImage(file: File): Promise<ExtractFromImageResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: { [key: string]: string | undefined } = { 'Content-Type': undefined };
    const response = await apiClient.post(
      '/api/v1/stocks/extract-from-image',
      formData,
      {
        headers,
        timeout: 60000, // Vision API can be slow; 60s
      },
    );

    const data = response.data as { codes?: string[]; items?: ExtractItem[]; raw_text?: string };
    return {
      codes: data.codes ?? [],
      items: data.items,
      rawText: data.raw_text,
    };
  },

  async parseImport(file?: File, text?: string): Promise<ExtractFromImageResponse> {
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      const headers: { [key: string]: string | undefined } = { 'Content-Type': undefined };
      const response = await apiClient.post('/api/v1/stocks/parse-import', formData, { headers });
      const data = response.data as { codes?: string[]; items?: ExtractItem[] };
      return { codes: data.codes ?? [], items: data.items };
    }
    if (text) {
      const response = await apiClient.post('/api/v1/stocks/parse-import', { text });
      const data = response.data as { codes?: string[]; items?: ExtractItem[] };
      return { codes: data.codes ?? [], items: data.items };
    }
    throw new Error('请提供文件或粘贴文本');
  },

  async getRankings(params: StockRankingsParams): Promise<StockRankingsResponse> {
    const response = await apiClient.get<Record<string, unknown>>(
      '/api/v1/stocks/rankings',
      { params }
    );
    return toCamelCase<StockRankingsResponse>(response.data);
  },
};
