import { create } from 'zustand';
import { agentApi } from '../api/agent';
import type { ChatSessionContext, ChatSessionItem, ChatSessionMessage, ChatStreamRequest } from '../api/agent';
import {
  getParsedApiError,
  isApiRequestError,
  isParsedApiError,
  type ParsedApiError,
} from '../api/error';
import { generateUUID } from '../utils/uuid';

const STORAGE_KEY_SESSION = 'dsa_chat_session_id';

export interface ProgressStep {
  type: string;
  step?: number;
  tool?: string;
  display_name?: string;
  success?: boolean;
  duration?: number;
  message?: string;
  content?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  skills?: string[];
  skill?: string;
  skillNames?: string[];
  skillName?: string;
  thinkingSteps?: ProgressStep[];
}

export interface StreamMeta {
  skillNames?: string[];
  skillName?: string;
}

type StreamFailureEvent = {
  type: string;
  success?: boolean;
  content?: string;
  error?: unknown;
  message?: unknown;
};

function getFirstMeaningfulStreamError(...candidates: Array<unknown>): unknown {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      if (candidate.trim() !== '') {
        return candidate;
      }
      continue;
    }

    if (candidate != null) {
      return candidate;
    }
  }

  return undefined;
}

function getStreamFailureError(
  event: StreamFailureEvent,
  fallbackMessage: string,
): ParsedApiError {
  return getParsedApiError(
    getFirstMeaningfulStreamError(
      event.error,
      event.message,
      event.content,
      fallbackMessage,
    ),
  );
}

interface AgentChatState {
  messages: Message[];
  loading: boolean;
  progressSteps: ProgressStep[];
  sessionId: string;
  sessions: ChatSessionItem[];
  sessionsLoading: boolean;
  currentContext: ChatSessionContext | null;
  contextLoading: boolean;
  chatError: ParsedApiError | null;
  currentRoute: string;
  completionBadge: boolean;
  hasInitialLoad: boolean;
  abortController: AbortController | null;
}

interface AgentChatActions {
  setCurrentRoute: (path: string) => void;
  clearCompletionBadge: () => void;
  loadSessions: () => Promise<void>;
  loadInitialSession: () => Promise<void>;
  loadSessionDetail: (targetSessionId: string) => Promise<void>;
  switchSession: (targetSessionId: string) => Promise<void>;
  startNewChat: (nextSessionId?: string) => void;
  saveContext: (context: ChatSessionContext) => Promise<void>;
  removeContext: () => Promise<void>;
  startStream: (payload: ChatStreamRequest, meta?: StreamMeta) => Promise<void>;
}

const getInitialSessionId = (): string =>
  typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEY_SESSION) || generateUUID()
    : generateUUID();

let contextMutationVersion = 0;

const mapSessionMessages = (messages: ChatSessionMessage[]): Message[] =>
  messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
  }));

export const useAgentChatStore = create<AgentChatState & AgentChatActions>((set, get) => ({
  messages: [],
  loading: false,
  progressSteps: [],
  sessionId: getInitialSessionId(),
  sessions: [],
  sessionsLoading: false,
  currentContext: null,
  contextLoading: false,
  chatError: null,
  currentRoute: '',
  completionBadge: false,
  hasInitialLoad: false,
  abortController: null,

  setCurrentRoute: (path) => set({ currentRoute: path }),

  clearCompletionBadge: () => set({ completionBadge: false }),

  loadSessions: async () => {
    set({ sessionsLoading: true });
    try {
      const sessions = await agentApi.getChatSessions();
      set({ sessions });
    } catch {
      // Ignore load errors
    } finally {
      set({ sessionsLoading: false });
    }
  },

  loadInitialSession: async () => {
    const { hasInitialLoad, sessionId: initialSessionId } = get();
    if (hasInitialLoad) return;
    const initialSavedId = localStorage.getItem(STORAGE_KEY_SESSION);
    const sessionUnchanged = () =>
      get().sessionId === initialSessionId
      && localStorage.getItem(STORAGE_KEY_SESSION) === initialSavedId;
    set({ hasInitialLoad: true, sessionsLoading: true });

    try {
      const sessionList = await agentApi.getChatSessions();
      set({ sessions: sessionList });
      if (!sessionUnchanged()) return;

      const savedId = initialSavedId;
      if (savedId) {
        const sessionExists = sessionList.some((s) => s.session_id === savedId);
        if (sessionExists) {
          const detail = await agentApi.getChatSessionDetail(savedId);
          if (!sessionUnchanged()) return;
          set({
            messages: mapSessionMessages(detail.messages),
            currentContext: detail.context,
          });
        } else {
          const newId = generateUUID();
          set({ sessionId: newId, currentContext: null });
          localStorage.setItem(STORAGE_KEY_SESSION, newId);
        }
      } else {
        localStorage.setItem(STORAGE_KEY_SESSION, get().sessionId);
      }
    } catch {
      // Ignore
    } finally {
      set({ sessionsLoading: false });
    }
  },

  loadSessionDetail: async (targetSessionId) => {
    const mutationVersion = ++contextMutationVersion;
    set({ contextLoading: true });
    try {
      const detail = await agentApi.getChatSessionDetail(targetSessionId);
      if (contextMutationVersion === mutationVersion) {
        set({
          messages: mapSessionMessages(detail.messages),
          currentContext: detail.context,
        });
      }
    } finally {
      if (contextMutationVersion === mutationVersion) {
        set({ contextLoading: false });
      }
    }
  },

  switchSession: async (targetSessionId) => {
    const { sessionId, messages, currentContext, abortController } = get();
    if (targetSessionId === sessionId && (messages.length > 0 || currentContext)) return;

    contextMutationVersion += 1;
    abortController?.abort();
    set({ abortController: null });

    set({ messages: [], currentContext: null, sessionId: targetSessionId });
    localStorage.setItem(STORAGE_KEY_SESSION, targetSessionId);

    try {
      await get().loadSessionDetail(targetSessionId);
    } catch {
      // Ignore
    }
  },

  startNewChat: (nextSessionId) => {
    // Abort any in-flight stream so the old request does not keep running
    get().abortController?.abort();
    contextMutationVersion += 1;
    const newId = nextSessionId || generateUUID();
    set({
      sessionId: newId,
      messages: [],
      currentContext: null,
      contextLoading: false,
      loading: false,
      progressSteps: [],
      chatError: null,
      abortController: null,
    });
    localStorage.setItem(STORAGE_KEY_SESSION, newId);
  },

  saveContext: async (context) => {
    const { sessionId } = get();
    const mutationVersion = ++contextMutationVersion;
    set({ contextLoading: true });
    try {
      const savedContext = await agentApi.saveChatSessionContext(sessionId, context);
      if (contextMutationVersion === mutationVersion) {
        set({ currentContext: savedContext });
        await get().loadSessions();
      }
    } catch (error) {
      if (contextMutationVersion === mutationVersion) {
        set({ currentContext: null });
      }
      throw error;
    } finally {
      if (contextMutationVersion === mutationVersion) {
        set({ contextLoading: false });
      }
    }
  },

  removeContext: async () => {
    const { sessionId } = get();
    contextMutationVersion += 1;
    set({ currentContext: null, contextLoading: false });
    try {
      await agentApi.deleteChatSessionContext(sessionId);
      await get().loadSessions();
    } catch {
      // UI already removed the context optimistically.
    }
  },

  startStream: async (payload, meta) => {
    if (get().loading) return;
    const { abortController: prevAc, sessionId: storeSessionId } = get();
    prevAc?.abort();

    const ac = new AbortController();
    set({ abortController: ac });

    const streamSessionId = payload.session_id || storeSessionId;
    const skillNames = meta?.skillNames?.length
      ? meta.skillNames
      : [meta?.skillName ?? '通用'];
    const skillName = skillNames.join('、');

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: payload.message,
      skills: payload.skills,
      skill: payload.skills?.[0],
      skillNames,
      skillName,
    };

    set((s) => ({
      messages: [...s.messages, userMessage],
      loading: true,
      progressSteps: [],
      chatError: null,
      sessions: s.sessions.some((x) => x.session_id === streamSessionId)
        ? s.sessions
        : [
            {
              session_id: streamSessionId,
              title: payload.message.slice(0, 60),
              message_count: 1,
              created_at: new Date().toISOString(),
              last_active: new Date().toISOString(),
            },
            ...s.sessions,
          ],
    }));

    try {
      const response = await agentApi.chatStream(payload, { signal: ac.signal });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalContent: string | null = null;
      const currentProgressSteps: ProgressStep[] = [];
        const processLine = (line: string) => {
          if (!line.startsWith('data: ')) return;

          const event = JSON.parse(line.slice(6)) as ProgressStep;
          if (event.type === 'done') {
            const doneEvent = event as unknown as StreamFailureEvent;
            if (doneEvent.success === false) {
              throw getStreamFailureError(doneEvent, '大模型调用出错，请检查 API Key 配置');
            }
            finalContent = doneEvent.content ?? '';
            return;
          }

          if (event.type === 'error') {
            throw getStreamFailureError(event as unknown as StreamFailureEvent, '分析出错');
          }

        currentProgressSteps.push(event);
        set((s) => ({ progressSteps: [...s.progressSteps, event] }));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          try {
            processLine(line);
          } catch (parseErr: unknown) {
            if (isParsedApiError(parseErr) || isApiRequestError(parseErr)) {
              throw parseErr;
            }
          }
        }
      }

      if (buf.trim().startsWith('data: ')) {
        try {
          processLine(buf.trim());
        } catch (parseErr: unknown) {
          if (isParsedApiError(parseErr) || isApiRequestError(parseErr)) {
            throw parseErr;
          }
        }
      }

      const { sessionId: currentSessionId, currentRoute } = get();
      const shouldAppend =
        currentSessionId === streamSessionId && !ac.signal.aborted;

      if (shouldAppend) {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: finalContent || '（无内容）',
              skills: payload.skills,
              skill: payload.skills?.[0],
              skillNames,
              skillName,
              thinkingSteps: [...currentProgressSteps],
            },
          ],
        }));
      }

      if (currentRoute !== '/chat') {
        set({ completionBadge: true });
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User-initiated abort: silent, no badge
      } else {
        set({ chatError: getParsedApiError(error) });
        const { currentRoute } = get();
        if (currentRoute !== '/chat') {
          set({ completionBadge: true });
        }
      }
    } finally {
      const { abortController: currentAc } = get();
      if (currentAc === ac) {
        set({
          loading: false,
          progressSteps: [],
          abortController: null,
        });
      }
      await get().loadSessions();
    }
  },
}));
