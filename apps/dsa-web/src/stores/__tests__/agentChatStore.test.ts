import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentChatStore } from '../agentChatStore';

vi.mock('../../api/agent', () => ({
  agentApi: {
    getChatSessions: vi.fn(async () => []),
    getChatSessionDetail: vi.fn(async () => ({ session_id: 'session-test', messages: [], context: null })),
    getChatSessionMessages: vi.fn(async () => []),
    saveChatSessionContext: vi.fn(async (_sessionId, context) => context),
    deleteChatSessionContext: vi.fn(async () => undefined),
    chatStream: vi.fn(),
  },
}));

const { agentApi } = await import('../../api/agent');

const encoder = new TextEncoder();

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createStreamResponse(lines: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(lines.join('\n')));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

describe('agentChatStore.startStream', () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentChatStore.setState({
      messages: [],
      loading: false,
      progressSteps: [],
      sessionId: 'session-test',
      sessions: [],
      sessionsLoading: false,
      currentContext: null,
      contextLoading: false,
      chatError: null,
      currentRoute: '/chat',
      completionBadge: false,
      hasInitialLoad: true,
      abortController: null,
    });
    vi.clearAllMocks();
  });

  it('appends the user message and final assistant message from the SSE stream', async () => {
    vi.mocked(agentApi.chatStream).mockResolvedValue(
      createStreamResponse([
        'data: {"type":"thinking","step":1,"message":"分析中"}',
        'data: {"type":"tool_done","tool":"quote","display_name":"行情","success":true,"duration":0.3}',
        'data: {"type":"done","success":true,"content":"最终分析结果"}',
      ]),
    );

    await useAgentChatStore
      .getState()
      .startStream({ message: '分析茅台', session_id: 'session-test' }, { skillName: '趋势技能' });

    const state = useAgentChatStore.getState();
    expect(state.loading).toBe(false);
    expect(state.chatError).toBeNull();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({
      role: 'user',
      content: '分析茅台',
      skillName: '趋势技能',
    });
    expect(state.messages[1]).toMatchObject({
      role: 'assistant',
      content: '最终分析结果',
      skillName: '趋势技能',
    });
    expect(state.messages[1].thinkingSteps).toHaveLength(2);
    expect(state.progressSteps).toEqual([]);
  });

  it('preserves multiple selected skills on streamed user and assistant messages', async () => {
    vi.mocked(agentApi.chatStream).mockResolvedValue(
      createStreamResponse([
        'data: {"type":"done","success":true,"content":"多策略分析结果"}',
      ]),
    );

    await useAgentChatStore
      .getState()
      .startStream(
        {
          message: '分析茅台',
          session_id: 'session-test',
          skills: ['bull_trend', 'ma_golden_cross'],
        },
        {
          skillNames: ['趋势分析', '均线金叉'],
        },
      );

    const state = useAgentChatStore.getState();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({
      role: 'user',
      skills: ['bull_trend', 'ma_golden_cross'],
      skill: 'bull_trend',
      skillNames: ['趋势分析', '均线金叉'],
      skillName: '趋势分析、均线金叉',
    });
    expect(state.messages[1]).toMatchObject({
      role: 'assistant',
      content: '多策略分析结果',
      skills: ['bull_trend', 'ma_golden_cross'],
      skill: 'bull_trend',
      skillNames: ['趋势分析', '均线金叉'],
      skillName: '趋势分析、均线金叉',
    });
  });

  it('preserves parsed error details when done.success is false', async () => {
    vi.mocked(agentApi.chatStream).mockResolvedValue(
      createStreamResponse([
        'data: {"type":"done","success":false,"error":"Agent LLM: no effective primary model configured"}',
      ]),
    );

    await useAgentChatStore
      .getState()
      .startStream({ message: '分析茅台', session_id: 'session-test' }, { skillName: '趋势技能' });

    const state = useAgentChatStore.getState();
    expect(state.loading).toBe(false);
    expect(state.messages).toHaveLength(1);
    expect(state.chatError).toMatchObject({
      title: '系统没有配置可用的 LLM 模型',
      message: '请先在系统设置中配置主模型、可用渠道或相关 API Key 后再重试。',
      category: 'llm_not_configured',
      rawMessage: 'Agent LLM: no effective primary model configured',
    });
  });

  it('uses the same parser for SSE error events', async () => {
    vi.mocked(agentApi.chatStream).mockResolvedValue(
      createStreamResponse([
        'data: {"type":"error","message":"connect timeout while calling upstream provider"}',
      ]),
    );

    await useAgentChatStore
      .getState()
      .startStream({ message: '分析茅台', session_id: 'session-test' }, { skillName: '趋势技能' });

    const state = useAgentChatStore.getState();
    expect(state.loading).toBe(false);
    expect(state.messages).toHaveLength(1);
    expect(state.chatError).toMatchObject({
      title: '连接上游服务超时',
      message: '服务端访问外部依赖时超时，请稍后重试，或检查当前网络与代理设置。',
      category: 'upstream_timeout',
      rawMessage: 'connect timeout while calling upstream provider',
    });
  });

  it('falls back when SSE error fields are empty strings', async () => {
    vi.mocked(agentApi.chatStream).mockResolvedValue(
      createStreamResponse([
        'data: {"type":"error","error":"","message":"   ","content":""}',
      ]),
    );

    await useAgentChatStore
      .getState()
      .startStream({ message: '分析茅台', session_id: 'session-test' }, { skillName: '趋势技能' });

    const state = useAgentChatStore.getState();
    expect(state.loading).toBe(false);
    expect(state.messages).toHaveLength(1);
    expect(state.chatError).toMatchObject({
      title: '请求失败',
      message: '分析出错',
      category: 'unknown',
      rawMessage: '分析出错',
    });
  });

  it('restores a context-only session during initial load', async () => {
    localStorage.setItem('dsa_chat_session_id', 'context-session');
    vi.mocked(agentApi.getChatSessions).mockResolvedValue([
      {
        session_id: 'context-session',
        title: '追问 贵州茅台(600519)',
        message_count: 0,
        created_at: '2026-03-18T08:00:00Z',
        last_active: '2026-03-18T08:05:00Z',
      },
    ]);
    vi.mocked(agentApi.getChatSessionDetail).mockResolvedValue({
      session_id: 'context-session',
      messages: [],
      context: {
        sourceType: 'analysis_report',
        sourceRecordId: 1,
        stockCode: '600519',
        stockName: '贵州茅台',
        previousPrice: 1523.6,
      },
    });
    useAgentChatStore.setState({
      hasInitialLoad: false,
      sessionId: 'context-session',
    });

    await useAgentChatStore.getState().loadInitialSession();

    expect(useAgentChatStore.getState().messages).toEqual([]);
    expect(useAgentChatStore.getState().currentContext).toMatchObject({
      sourceRecordId: 1,
      stockCode: '600519',
    });
  });

  it('does not replace a follow-up session created while initial sessions are loading', async () => {
    localStorage.setItem('dsa_chat_session_id', 'old-session');
    const sessionsDeferred = createDeferred<Awaited<ReturnType<typeof agentApi.getChatSessions>>>();
    vi.mocked(agentApi.getChatSessions).mockReturnValueOnce(sessionsDeferred.promise);
    useAgentChatStore.setState({
      hasInitialLoad: false,
      sessionId: 'old-session',
      sessions: [],
      messages: [],
      currentContext: null,
    });

    const loadPromise = useAgentChatStore.getState().loadInitialSession();
    useAgentChatStore.getState().startNewChat('follow-up-session');

    sessionsDeferred.resolve([
      {
        session_id: 'old-session',
        title: '旧会话',
        message_count: 1,
        created_at: '2026-03-18T08:00:00Z',
        last_active: '2026-03-18T08:05:00Z',
      },
    ]);
    await loadPromise;

    expect(useAgentChatStore.getState().sessionId).toBe('follow-up-session');
    expect(localStorage.getItem('dsa_chat_session_id')).toBe('follow-up-session');
    expect(agentApi.getChatSessionDetail).not.toHaveBeenCalled();
  });

  it('clears context when starting a new chat', () => {
    useAgentChatStore.setState({
      currentContext: {
        sourceType: 'analysis_report',
        sourceRecordId: 1,
        stockCode: '600519',
        stockName: '贵州茅台',
      },
    });

    useAgentChatStore.getState().startNewChat('new-session');

    expect(useAgentChatStore.getState().sessionId).toBe('new-session');
    expect(useAgentChatStore.getState().currentContext).toBeNull();
  });

  it('removes persisted context for the current session', async () => {
    useAgentChatStore.setState({
      sessionId: 'context-session',
      currentContext: {
        sourceType: 'analysis_report',
        sourceRecordId: 1,
        stockCode: '600519',
        stockName: '贵州茅台',
      },
    });

    await useAgentChatStore.getState().removeContext();

    expect(agentApi.deleteChatSessionContext).toHaveBeenCalledWith('context-session');
    expect(useAgentChatStore.getState().currentContext).toBeNull();
  });

  it('does not restore context from an outdated save after removal', async () => {
    const context = {
      sourceType: 'analysis_report' as const,
      sourceRecordId: 1,
      stockCode: '600519',
      stockName: '贵州茅台',
    };
    const deferred = createDeferred<typeof context>();
    vi.mocked(agentApi.saveChatSessionContext).mockReturnValueOnce(deferred.promise);
    useAgentChatStore.setState({
      sessionId: 'context-session',
      currentContext: null,
      contextLoading: false,
    });

    const savePromise = useAgentChatStore.getState().saveContext(context);
    await useAgentChatStore.getState().removeContext();
    deferred.resolve(context);
    await savePromise;

    expect(useAgentChatStore.getState().currentContext).toBeNull();
    expect(useAgentChatStore.getState().contextLoading).toBe(false);
  });
});
