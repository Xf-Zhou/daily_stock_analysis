import type { AnalysisReport } from '../types/analysis';
import { historyApi } from '../api/history';
import type { ChatSessionContext } from '../api/agent';
import { validateStockCode } from './validation';

export type ChatFollowUpContext = ChatSessionContext;

type ResolveChatFollowUpContextParams = {
  stockCode: string;
  stockName: string | null;
  recordId?: number;
};

const MAX_FOLLOW_UP_NAME_LENGTH = 80;
const CHAT_SESSION_ID_PATTERN = /^[A-Za-z0-9:_-]{1,100}$/;

function hasInvalidFollowUpNameCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function sanitizeFollowUpStockCode(stockCode: string | null): string | null {
  if (!stockCode) {
    return null;
  }

  const { valid, normalized } = validateStockCode(stockCode);
  return valid ? normalized : null;
}

export function sanitizeFollowUpStockName(stockName: string | null): string | null {
  const normalized = stockName?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalized) {
    return null;
  }

  if (
    normalized.length > MAX_FOLLOW_UP_NAME_LENGTH
    || hasInvalidFollowUpNameCharacter(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function parseFollowUpRecordId(recordId: string | null): number | undefined {
  if (!recordId || !/^\d+$/.test(recordId)) {
    return undefined;
  }

  const parsed = Number(recordId);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

export function sanitizeFollowUpSessionId(sessionId: string | null): string | null {
  const normalized = sessionId?.trim() ?? '';
  return CHAT_SESSION_ID_PATTERN.test(normalized) ? normalized : null;
}

export function buildFollowUpPrompt(stockCode: string, stockName: string | null): string {
  const displayName = stockName ? `${stockName}(${stockCode})` : stockCode;
  return `请深入分析 ${displayName}`;
}

export function buildChatFollowUpContext(
  stockCode: string,
  stockName: string | null,
  recordId: number,
  report?: AnalysisReport | null,
): ChatFollowUpContext | null {
  if (!report) {
    return null;
  }

  const context: ChatFollowUpContext = {
    sourceType: 'analysis_report',
    sourceRecordId: recordId,
    stockCode,
    stockName,
  };

  if (report.summary) {
    context.previousAnalysisSummary = report.summary;
  }

  if (report.strategy) {
    context.previousStrategy = report.strategy;
  }

  if (report.meta) {
    context.previousPrice = report.meta.currentPrice;
    context.previousChangePct = report.meta.changePct;
  }

  return context;
}

export async function resolveChatFollowUpContext({
  stockCode,
  stockName,
  recordId,
}: ResolveChatFollowUpContextParams): Promise<ChatFollowUpContext | null> {
  if (!recordId) {
    return null;
  }

  try {
    const report = await historyApi.getDetail(recordId);
    return buildChatFollowUpContext(stockCode, stockName, recordId, report);
  } catch {
    return null;
  }
}
