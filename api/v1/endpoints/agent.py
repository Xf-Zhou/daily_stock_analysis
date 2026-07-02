# -*- coding: utf-8 -*-
"""
Agent API endpoints.
"""

import asyncio
import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from src.config import get_config
from src.services.agent_model_service import list_agent_model_deployments
from src.storage import get_db

# Tool name -> Chinese display name mapping
TOOL_DISPLAY_NAMES: Dict[str, str] = {
    "get_realtime_quote":         "获取实时行情",
    "get_daily_history":          "获取历史K线",
    "get_chip_distribution":      "分析筹码分布",
    "get_analysis_context":       "获取分析上下文",
    "get_stock_info":             "获取股票基本面",
    "search_stock_news":          "搜索股票新闻",
    "search_comprehensive_intel": "搜索综合情报",
    "analyze_trend":              "分析技术趋势",
    "calculate_ma":               "计算均线系统",
    "get_volume_analysis":        "分析量能变化",
    "analyze_pattern":            "识别K线形态",
    "get_market_indices":         "获取市场指数",
    "get_sector_rankings":        "分析行业板块",
    "get_skill_backtest_summary": "获取技能回测概览",
    "get_strategy_backtest_summary": "获取策略回测概览",
    "get_stock_backtest_summary": "获取个股回测数据",
}

logger = logging.getLogger(__name__)

router = APIRouter()

SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9:_-]{1,100}$")


def validate_chat_session_id(session_id: str) -> str:
    """Validate chat session ids before using them in storage paths."""
    if not session_id or not SESSION_ID_PATTERN.fullmatch(session_id):
        raise HTTPException(status_code=422, detail="Invalid chat session id")
    return session_id

class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    message: str
    session_id: Optional[str] = None
    skills: Optional[List[str]] = Field(
        default=None,
        validation_alias=AliasChoices("skills", "strategies"),
    )
    context: Optional[Dict[str, Any]] = None  # Previous analysis context for data reuse

    @property
    def effective_skills(self) -> Optional[List[str]]:
        """Return skill ids from the unified request shape."""
        return self.skills

class ChatResponse(BaseModel):
    success: bool
    content: str
    session_id: str
    error: Optional[str] = None


class ChatSessionContextPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    sourceType: str = Field(
        "analysis_report",
        validation_alias=AliasChoices("sourceType", "source_type"),
    )
    sourceRecordId: int = Field(
        ...,
        validation_alias=AliasChoices("sourceRecordId", "source_record_id"),
    )
    stockCode: str = Field(
        ...,
        validation_alias=AliasChoices("stockCode", "stock_code"),
    )
    stockName: Optional[str] = Field(
        None,
        validation_alias=AliasChoices("stockName", "stock_name"),
    )
    previousPrice: Optional[float] = Field(
        None,
        validation_alias=AliasChoices("previousPrice", "previous_price"),
    )
    previousChangePct: Optional[float] = Field(
        None,
        validation_alias=AliasChoices("previousChangePct", "previous_change_pct"),
    )
    previousAnalysisSummary: Optional[Any] = Field(
        None,
        validation_alias=AliasChoices(
            "previousAnalysisSummary",
            "previous_analysis_summary",
        ),
    )
    previousStrategy: Optional[Any] = Field(
        None,
        validation_alias=AliasChoices("previousStrategy", "previous_strategy"),
    )


class ChatSessionContextResponse(ChatSessionContextPayload):
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


def _context_get(context: Dict[str, Any], camel_key: str, snake_key: str) -> Any:
    if camel_key in context:
        return context.get(camel_key)
    return context.get(snake_key)


def _normalize_context_number(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_context_record_id(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        record_id = int(value)
    except (TypeError, ValueError):
        return None
    return record_id if record_id > 0 else None


def _normalize_persistable_chat_context(
    context: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Return whitelisted snake_case context when it can be persisted."""
    if not isinstance(context, dict):
        return None
    source_type = _context_get(context, "sourceType", "source_type")
    if source_type != "analysis_report":
        return None
    source_record_id = _normalize_context_record_id(
        _context_get(context, "sourceRecordId", "source_record_id")
    )
    stock_code = _context_get(context, "stockCode", "stock_code")
    if not source_record_id or not stock_code:
        return None

    return {
        "source_type": "analysis_report",
        "source_record_id": source_record_id,
        "stock_code": str(stock_code),
        "stock_name": _context_get(context, "stockName", "stock_name"),
        "previous_price": _normalize_context_number(
            _context_get(context, "previousPrice", "previous_price")
        ),
        "previous_change_pct": _normalize_context_number(
            _context_get(context, "previousChangePct", "previous_change_pct")
        ),
        "previous_analysis_summary": _context_get(
            context,
            "previousAnalysisSummary",
            "previous_analysis_summary",
        ),
        "previous_strategy": _context_get(context, "previousStrategy", "previous_strategy"),
    }


def _normalize_legacy_chat_context(
    context: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Normalize one-shot legacy context for LLM injection without persistence."""
    if not isinstance(context, dict):
        return None
    stock_code = _context_get(context, "stockCode", "stock_code")
    has_context = any(
        _context_get(context, camel_key, snake_key) is not None
        for camel_key, snake_key in (
            ("stockCode", "stock_code"),
            ("stockName", "stock_name"),
            ("previousPrice", "previous_price"),
            ("previousChangePct", "previous_change_pct"),
            ("previousAnalysisSummary", "previous_analysis_summary"),
            ("previousStrategy", "previous_strategy"),
        )
    )
    if not stock_code and not has_context:
        return None
    return {
        "stock_code": str(stock_code) if stock_code is not None else "",
        "stock_name": _context_get(context, "stockName", "stock_name"),
        "previous_price": _normalize_context_number(
            _context_get(context, "previousPrice", "previous_price")
        ),
        "previous_change_pct": _normalize_context_number(
            _context_get(context, "previousChangePct", "previous_change_pct")
        ),
        "previous_analysis_summary": _context_get(
            context,
            "previousAnalysisSummary",
            "previous_analysis_summary",
        ),
        "previous_strategy": _context_get(context, "previousStrategy", "previous_strategy"),
    }


def _context_to_executor_context(context: Dict[str, Any]) -> Dict[str, Any]:
    executor_context: Dict[str, Any] = {}
    for key in (
        "source_type",
        "source_record_id",
        "stock_code",
        "stock_name",
        "previous_price",
        "previous_change_pct",
        "previous_analysis_summary",
        "previous_strategy",
    ):
        if key in context and context.get(key) is not None:
            executor_context[key] = context.get(key)
    return executor_context


def _context_to_response(context: Dict[str, Any]) -> ChatSessionContextResponse:
    return ChatSessionContextResponse(
        sourceType=context.get("source_type") or "analysis_report",
        sourceRecordId=int(context.get("source_record_id")),
        stockCode=context.get("stock_code") or "",
        stockName=context.get("stock_name"),
        previousPrice=context.get("previous_price"),
        previousChangePct=context.get("previous_change_pct"),
        previousAnalysisSummary=context.get("previous_analysis_summary"),
        previousStrategy=context.get("previous_strategy"),
        createdAt=context.get("created_at"),
        updatedAt=context.get("updated_at"),
    )


def _payload_to_storage_context(payload: ChatSessionContextPayload) -> Dict[str, Any]:
    return {
        "source_type": payload.sourceType,
        "source_record_id": payload.sourceRecordId,
        "stock_code": payload.stockCode,
        "stock_name": payload.stockName,
        "previous_price": payload.previousPrice,
        "previous_change_pct": payload.previousChangePct,
        "previous_analysis_summary": payload.previousAnalysisSummary,
        "previous_strategy": payload.previousStrategy,
    }


def _context_ref_matches(
    left: Optional[Dict[str, Any]],
    right: Optional[Dict[str, Any]],
) -> bool:
    if not left or not right:
        return False
    return (
        left.get("source_type") == right.get("source_type")
        and left.get("source_record_id") == right.get("source_record_id")
    )


def resolve_effective_chat_context(
    db,
    session_id: str,
    request_context: Optional[Dict[str, Any]],
) -> tuple[Optional[Dict[str, Any]], Optional[ChatSessionContextResponse]]:
    """
    Resolve the LLM-injected context and separately the persisted UI context.

    A valid analysis_report request context is saved after checking the source
    history record exists. Legacy one-shot context can still be injected for
    compatibility, but it is not returned as persisted session state.
    """
    validate_chat_session_id(session_id)
    persistable_context = _normalize_persistable_chat_context(request_context)
    stored_context = db.get_conversation_context(session_id)
    if persistable_context and _context_ref_matches(persistable_context, stored_context):
        return _context_to_executor_context(stored_context), _context_to_response(stored_context)

    if persistable_context:
        source_record_id = persistable_context["source_record_id"]
        if not db.get_analysis_history_by_id(source_record_id):
            raise HTTPException(status_code=404, detail="Analysis report not found")
        saved_context = db.save_conversation_context(session_id, persistable_context)
        if not isinstance(saved_context, dict):
            saved_context = persistable_context
        return _context_to_executor_context(saved_context), _context_to_response(saved_context)

    if stored_context:
        return _context_to_executor_context(stored_context), _context_to_response(stored_context)

    legacy_context = _normalize_legacy_chat_context(request_context)
    if legacy_context:
        return _context_to_executor_context(legacy_context), None
    return None, None


class SkillInfo(BaseModel):
    id: str
    name: str
    description: str

class SkillsResponse(BaseModel):
    skills: List[SkillInfo]
    default_skill_id: str = ""


class StrategiesResponse(BaseModel):
    strategies: List[SkillInfo]
    default_strategy_id: str = ""


class AgentModelDeployment(BaseModel):
    deployment_id: str
    model: str
    provider: str
    source: str
    api_base: Optional[str] = None
    deployment_name: Optional[str] = None
    is_primary: bool = False
    is_fallback: bool = False


class AgentModelsResponse(BaseModel):
    models: List[AgentModelDeployment]


@router.get("/models", response_model=AgentModelsResponse)
async def get_agent_models():
    """Get configured Agent model deployments for frontend selection."""
    config = get_config()
    return AgentModelsResponse(
        models=[AgentModelDeployment(**item) for item in list_agent_model_deployments(config)]
    )


def _build_skills_response(config) -> SkillsResponse:
    from src.agent.factory import get_skill_manager
    from src.agent.skills.defaults import get_primary_default_skill_id

    skill_manager = get_skill_manager(config)
    available_skills = sorted(
        [
            skill
            for skill in skill_manager.list_skills()
            if getattr(skill, "user_invocable", True)
        ],
        key=lambda skill: (
            int(getattr(skill, "default_priority", 100)),
            skill.display_name,
            skill.name,
        ),
    )
    skills = [
        SkillInfo(id=skill.name, name=skill.display_name, description=skill.description)
        for skill in available_skills
    ]
    return SkillsResponse(
        skills=skills,
        default_skill_id=get_primary_default_skill_id(available_skills),
    )


@router.get("/skills", response_model=SkillsResponse)
async def get_skills():
    """
    Get available agent strategy skills.
    """
    return _build_skills_response(get_config())


@router.get("/strategies", response_model=StrategiesResponse, include_in_schema=False)
async def get_strategies():
    """Compatibility alias for legacy clients."""
    payload = _build_skills_response(get_config())
    return StrategiesResponse(
        strategies=payload.skills,
        default_strategy_id=payload.default_skill_id,
    )

@router.post("/chat", response_model=ChatResponse)
async def agent_chat(request: ChatRequest):
    """
    Chat with the AI Agent.
    """
    config = get_config()
    
    if not config.is_agent_available():
        raise HTTPException(status_code=400, detail="Agent mode is not enabled")
        
    session_id = validate_chat_session_id(request.session_id or str(uuid.uuid4()))
    
    try:
        skills = request.effective_skills
        executor = _build_executor(config, skills or None)
        effective_context, _persisted_context = resolve_effective_chat_context(
            get_db(),
            session_id,
            request.context,
        )

        # Pass explicit skills into context for the orchestrator.
        # Direct assignment so caller-provided skills always take precedence
        # over any stale value carried in the context dict.
        ctx = dict(effective_context or {})
        if skills is not None:
            ctx["skills"] = skills

        # Offload the blocking call to a thread to avoid blocking the event loop.
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: executor.chat(message=request.message, session_id=session_id,
                                  context=ctx),
        )

        return ChatResponse(
            success=result.success,
            content=result.content,
            session_id=session_id,
            error=result.error
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Agent chat API failed: {e}")
        logger.exception("Agent chat error details:")
        raise HTTPException(status_code=500, detail=str(e))


class SessionItem(BaseModel):
    session_id: str
    title: str
    message_count: int
    created_at: Optional[str] = None
    last_active: Optional[str] = None

class SessionsResponse(BaseModel):
    sessions: List[SessionItem]

class SessionMessagesResponse(BaseModel):
    session_id: str
    messages: List[Dict[str, Any]]
    context: Optional[ChatSessionContextResponse] = None


@router.get("/chat/sessions", response_model=SessionsResponse)
async def list_chat_sessions(limit: int = 50, user_id: Optional[str] = None):
    """获取聊天会话列表

    Args:
        limit: Maximum number of sessions to return.
        user_id: Optional platform-prefixed user identifier for session
            isolation.  When provided, only sessions whose session_id
            starts with this prefix are returned.  The value must
            include the platform prefix, e.g. ``telegram_12345``,
            ``feishu_ou_abc``.
    """
    sessions = get_db().get_chat_sessions(
        limit=limit,
        session_prefix=user_id,
        extra_session_ids=[user_id] if user_id else None,
    )
    return SessionsResponse(sessions=sessions)


@router.get("/chat/sessions/{session_id}", response_model=SessionMessagesResponse)
async def get_chat_session_messages(session_id: str, limit: int = 100):
    """获取单个会话的完整消息"""
    session_id = validate_chat_session_id(session_id)
    db = get_db()
    messages = db.get_conversation_messages(session_id, limit=limit)
    context = db.get_conversation_context(session_id)
    return SessionMessagesResponse(
        session_id=session_id,
        messages=messages,
        context=_context_to_response(context) if context else None,
    )


@router.put(
    "/chat/sessions/{session_id}/context",
    response_model=ChatSessionContextResponse,
)
async def put_chat_session_context(
    session_id: str,
    payload: ChatSessionContextPayload,
):
    """保存或覆盖会话级追问上下文。"""
    session_id = validate_chat_session_id(session_id)
    if payload.sourceType != "analysis_report":
        raise HTTPException(status_code=422, detail="Unsupported context source type")
    db = get_db()
    if not db.get_analysis_history_by_id(payload.sourceRecordId):
        raise HTTPException(status_code=404, detail="Analysis report not found")
    saved_context = db.save_conversation_context(
        session_id,
        _payload_to_storage_context(payload),
    )
    return _context_to_response(saved_context)


@router.delete("/chat/sessions/{session_id}/context")
async def delete_chat_session_context(session_id: str):
    """移除指定会话的追问上下文。"""
    session_id = validate_chat_session_id(session_id)
    count = get_db().delete_conversation_context(session_id)
    return {"deleted": count}


@router.delete("/chat/sessions/{session_id}")
async def delete_chat_session(session_id: str):
    """删除指定会话"""
    session_id = validate_chat_session_id(session_id)
    count = get_db().delete_conversation_session(session_id)
    return {"deleted": count}


class SendChatRequest(BaseModel):
    """Request body for sending chat content to notification channels."""

    content: str = Field(..., min_length=1, max_length=50000)
    title: Optional[str] = None


@router.post("/chat/send")
async def send_chat_to_notification(request: SendChatRequest):
    """
    Send chat session content to configured notification channels.
    Uses run_in_executor to avoid blocking the event loop.
    """
    from src.notification import NotificationService

    loop = asyncio.get_running_loop()
    success = await loop.run_in_executor(
        None,
        lambda: NotificationService().send(request.content),
    )
    if not success:
        return {
            "success": False,
            "error": "no_channels",
            "message": "未配置通知渠道，请先在设置中配置",
        }
    return {"success": True}


def _build_executor(config, skills: Optional[List[str]] = None):
    """Build and return a configured AgentExecutor (sync helper)."""
    from src.agent.factory import build_agent_executor
    return build_agent_executor(config, skills=skills)


async def _run_research_in_background(
    agent,
    question: str,
    context: Optional[Dict[str, Any]],
    *,
    timeout: int,
):
    """Run deep research off the event loop with an internal overall timeout."""
    return await asyncio.to_thread(
        agent.research,
        question,
        context,
        timeout_seconds=timeout,
    )


# ============================================================
# Deep research endpoint
# ============================================================

class ResearchRequest(BaseModel):
    question: str
    stock_code: Optional[str] = None

class ResearchResponse(BaseModel):
    success: bool
    content: str
    sources: List[str] = Field(default_factory=list)
    token_usage: int = 0
    error: Optional[str] = None


@router.post("/research", response_model=ResearchResponse)
async def agent_research(request: ResearchRequest):
    """Run a deep-research query via the ResearchAgent.

    Similar to the ``/research`` bot command but exposed as a REST endpoint.
    """
    config = get_config()
    if not config.is_agent_available():
        raise HTTPException(status_code=400, detail="Agent mode is not enabled")

    question = request.question
    context: Optional[Dict[str, Any]] = None
    if request.stock_code:
        question = f"[Stock: {request.stock_code}] {question}"
        context = {"stock_code": request.stock_code}

    try:
        from src.agent.research import ResearchAgent
        from src.agent.factory import get_tool_registry
        from src.agent.llm_adapter import LLMToolAdapter

        registry = get_tool_registry()
        llm_adapter = LLMToolAdapter(config)
        budget = getattr(config, "agent_deep_research_budget", 30000)

        agent = ResearchAgent(
            tool_registry=registry,
            llm_adapter=llm_adapter,
            token_budget=budget,
        )

        research_timeout = getattr(config, "agent_deep_research_timeout", 180)

        result = await _run_research_in_background(
            agent,
            question,
            context,
            timeout=research_timeout,
        )
        if getattr(result, "timed_out", False):
            logger.warning("Agent research API timed out after %ss", research_timeout)
            return ResearchResponse(
                success=False,
                content="",
                sources=[],
                token_usage=0,
                error=f"Deep research timed out after {research_timeout}s",
            )

        return ResearchResponse(
            success=result.success,
            content=result.report,
            sources=[f"Sub-question {i+1}: {q}" for i, q in enumerate(result.sub_questions)],
            token_usage=result.total_tokens,
            error=result.error if not result.success else None,
        )
    except Exception as e:
        logger.error("Agent research API failed: %s", e)
        logger.exception("Agent research error details:")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/stream")
async def agent_chat_stream(request: ChatRequest):
    """
    Chat with the AI Agent, streaming progress via SSE.
    Each SSE event is a JSON object with a 'type' field:
      - thinking: AI is deciding next action
      - tool_start: a tool call has begun
      - tool_done: a tool call finished
      - generating: final answer being generated
      - done: analysis complete, contains 'content' and 'success'
      - error: error occurred, contains 'message'
    """
    config = get_config()
    if not config.is_agent_available():
        raise HTTPException(status_code=400, detail="Agent mode is not enabled")

    session_id = validate_chat_session_id(request.session_id or str(uuid.uuid4()))
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    # Pass explicit skills into context for the orchestrator.
    # Direct assignment so caller-provided skills always take precedence.
    skills = request.effective_skills
    effective_context, _persisted_context = resolve_effective_chat_context(
        get_db(),
        session_id,
        request.context,
    )
    stream_ctx = dict(effective_context or {})
    if skills is not None:
        stream_ctx["skills"] = skills

    def progress_callback(event: dict):
        # Enrich tool events with display names
        if event.get("type") in ("tool_start", "tool_done"):
            tool = event.get("tool", "")
            event["display_name"] = TOOL_DISPLAY_NAMES.get(tool, tool)
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    def run_sync():
        try:
            executor = _build_executor(config, skills or None)
            result = executor.chat(
                message=request.message,
                session_id=session_id,
                progress_callback=progress_callback,
                context=stream_ctx,
            )
            asyncio.run_coroutine_threadsafe(
                queue.put({
                    "type": "done",
                    "success": result.success,
                    "content": result.content,
                    "error": result.error,
                    "total_steps": result.total_steps,
                    "session_id": session_id,
                }),
                loop,
            )
        except Exception as exc:
            logger.error(f"Agent stream error: {exc}")
            asyncio.run_coroutine_threadsafe(
                queue.put({"type": "error", "message": str(exc)}),
                loop,
            )

    async def event_generator():
        # Start executor in a thread so we don't block the event loop
        fut = loop.run_in_executor(None, run_sync)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=300.0)
                except asyncio.TimeoutError:
                    yield "data: " + json.dumps({"type": "error", "message": "分析超时"}, ensure_ascii=False) + "\n\n"
                    break
                yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
                if event.get("type") in ("done", "error"):
                    break
        finally:
            try:
                await asyncio.wait_for(fut, timeout=5.0)
            except asyncio.CancelledError:
                pass
            except asyncio.TimeoutError:
                # Cleanup taking longer than 5s is treated as an expected timeout; no warning.
                logger.debug("agent executor cleanup timed out after 5s for session %s", session_id)
            except Exception as exc:
                logger.warning("agent executor cleanup error (ignored): %s", exc, exc_info=True)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
