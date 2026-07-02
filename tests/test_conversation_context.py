# -*- coding: utf-8 -*-
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from sqlalchemy import event

from api.v1.endpoints import agent
from src.storage import DatabaseManager


class TestConversationContextStorage(unittest.TestCase):
    def setUp(self):
        DatabaseManager.reset_instance()
        self.db = DatabaseManager(db_url="sqlite:///:memory:")

    def tearDown(self):
        DatabaseManager.reset_instance()

    def test_context_round_trips_json_fields_and_falsy_values(self):
        self.db.save_conversation_context(
            "ctx-session-1",
            {
                "source_type": "analysis_report",
                "source_record_id": 1,
                "stock_code": "01810.HK",
                "stock_name": "小米集团-W",
                "previous_price": 0,
                "previous_change_pct": 0,
                "previous_analysis_summary": {"operationAdvice": "观望", "sentimentScore": 0},
                "previous_strategy": "等待右侧确认",
            },
        )

        context = self.db.get_conversation_context("ctx-session-1")

        self.assertEqual(context["source_type"], "analysis_report")
        self.assertEqual(context["source_record_id"], 1)
        self.assertEqual(context["previous_price"], 0)
        self.assertEqual(context["previous_change_pct"], 0)
        self.assertEqual(context["previous_analysis_summary"]["sentimentScore"], 0)
        self.assertEqual(context["previous_strategy"], "等待右侧确认")

    def test_context_only_sessions_are_listed_and_limited_after_global_sort(self):
        self.db.save_conversation_message("msg-session", "user", "old chat")
        self.db.save_conversation_context(
            "ctx-session-2",
            {
                "source_type": "analysis_report",
                "source_record_id": 2,
                "stock_code": "600519",
                "stock_name": "贵州茅台",
            },
        )

        sessions = self.db.get_chat_sessions(limit=1)

        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["session_id"], "ctx-session-2")
        self.assertEqual(sessions[0]["message_count"], 0)
        self.assertEqual(sessions[0]["title"], "追问 贵州茅台(600519)")

    def test_deleting_conversation_session_removes_context(self):
        self.db.save_conversation_message("ctx-session-3", "user", "hello")
        self.db.save_conversation_context(
            "ctx-session-3",
            {
                "source_type": "analysis_report",
                "source_record_id": 3,
                "stock_code": "AAPL",
                "stock_name": "Apple",
            },
        )

        deleted = self.db.delete_conversation_session("ctx-session-3")

        self.assertEqual(deleted, 1)
        self.assertIsNone(self.db.get_conversation_context("ctx-session-3"))

    def test_get_chat_sessions_limits_title_lookup_to_candidate_sessions(self):
        for idx in range(30):
            self.db.save_conversation_message(f"msg-session-{idx}", "user", f"chat {idx}")

        query_count = 0

        def count_query(*_args, **_kwargs):
            nonlocal query_count
            query_count += 1

        event.listen(self.db._engine, "before_cursor_execute", count_query)
        try:
            sessions = self.db.get_chat_sessions(limit=2)
        finally:
            event.remove(self.db._engine, "before_cursor_execute", count_query)

        self.assertEqual(len(sessions), 2)
        self.assertLessEqual(query_count, 5)


class TestAgentConversationContextApi(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_session_id_is_rejected(self):
        with self.assertRaises(HTTPException) as cm:
            await agent.get_chat_session_messages("../bad", limit=100)

        self.assertEqual(cm.exception.status_code, 422)

    async def test_put_context_rejects_missing_analysis_report(self):
        db = MagicMock()
        db.get_analysis_history_by_id.return_value = None
        payload = agent.ChatSessionContextPayload(
            sourceType="analysis_report",
            sourceRecordId=999999,
            stockCode="01810.HK",
            stockName="小米集团-W",
        )

        with patch("api.v1.endpoints.agent.get_db", return_value=db):
            with self.assertRaises(HTTPException) as cm:
                await agent.put_chat_session_context("valid-session", payload)

        self.assertEqual(cm.exception.status_code, 404)
        db.save_conversation_context.assert_not_called()

    async def test_chat_uses_persisted_context_when_request_context_is_absent(self):
        db = MagicMock()
        db.get_conversation_context.return_value = {
            "source_type": "analysis_report",
            "source_record_id": 1,
            "stock_code": "01810.HK",
            "stock_name": "小米集团-W",
            "previous_price": 0,
            "previous_change_pct": 0,
            "previous_analysis_summary": {"operationAdvice": "观望"},
            "previous_strategy": {"stopLoss": "20.50"},
        }
        config = SimpleNamespace(is_agent_available=lambda: True)
        executor = MagicMock()
        executor.chat.return_value = SimpleNamespace(success=True, content="ok", error=None)
        request = agent.ChatRequest(message="继续分析", session_id="valid-session")

        class _ImmediateLoop:
            def __init__(self, loop):
                self._loop = loop

            def run_in_executor(self, _executor, func):
                future = self._loop.create_future()
                future.set_result(func())
                return future

        real_get_running_loop = asyncio.get_running_loop
        with patch("api.v1.endpoints.agent.get_config", return_value=config), patch(
            "api.v1.endpoints.agent.get_db",
            return_value=db,
        ), patch(
            "api.v1.endpoints.agent._build_executor",
            return_value=executor,
        ), patch(
            "api.v1.endpoints.agent.asyncio.get_running_loop",
            side_effect=lambda: _ImmediateLoop(real_get_running_loop()),
        ):
            payload = await agent.agent_chat(request)

        self.assertEqual(payload.content, "ok")
        context = executor.chat.call_args.kwargs["context"]
        self.assertEqual(context["stock_code"], "01810.HK")
        self.assertEqual(context["previous_price"], 0)
        self.assertEqual(context["previous_change_pct"], 0)
        self.assertNotIn("sourceRecordId", context)

    async def test_stream_chat_uses_persisted_context_when_request_context_is_absent(self):
        db = MagicMock()
        db.get_conversation_context.return_value = {
            "source_type": "analysis_report",
            "source_record_id": 1,
            "stock_code": "01810.HK",
            "stock_name": "小米集团-W",
            "previous_price": 0,
            "previous_change_pct": 0,
        }
        config = SimpleNamespace(is_agent_available=lambda: True)
        executor = MagicMock()
        executor.chat.return_value = SimpleNamespace(
            success=True,
            content="ok",
            error=None,
            total_steps=1,
        )
        request = agent.ChatRequest(message="继续分析", session_id="valid-session")

        with patch("api.v1.endpoints.agent.get_config", return_value=config), patch(
            "api.v1.endpoints.agent.get_db",
            return_value=db,
        ), patch(
            "api.v1.endpoints.agent._build_executor",
            return_value=executor,
        ):
            response = await agent.agent_chat_stream(request)
            chunks = []
            async for chunk in response.body_iterator:
                chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)

        self.assertTrue(any('"type": "done"' in chunk for chunk in chunks))
        context = executor.chat.call_args.kwargs["context"]
        self.assertEqual(context["stock_code"], "01810.HK")
        self.assertEqual(context["previous_price"], 0)
        self.assertEqual(context["previous_change_pct"], 0)

    def test_request_context_persistence_whitelists_fields(self):
        db = MagicMock()
        db.get_analysis_history_by_id.return_value = SimpleNamespace(id=1)
        request_context = {
            "sourceType": "analysis_report",
            "sourceRecordId": 1,
            "stockCode": "01810.HK",
            "stockName": "小米集团-W",
            "previousPrice": 21.64,
            "previousChangePct": -1.0,
            "previousAnalysisSummary": {"operationAdvice": "观望"},
            "previousStrategy": {"stopLoss": "20.50"},
            "skills": ["stale_skill"],
            "unknown": "drop me",
        }

        effective, persisted = agent.resolve_effective_chat_context(
            db,
            "valid-session",
            request_context,
        )

        db.save_conversation_context.assert_called_once()
        saved = db.save_conversation_context.call_args.args[1]
        self.assertEqual(saved["source_type"], "analysis_report")
        self.assertEqual(saved["source_record_id"], 1)
        self.assertNotIn("skills", saved)
        self.assertNotIn("unknown", saved)
        self.assertEqual(effective["stock_code"], "01810.HK")
        self.assertEqual(persisted.sourceRecordId, 1)

    def test_request_context_matching_saved_snapshot_does_not_revalidate_deleted_report(self):
        stored_context = {
            "source_type": "analysis_report",
            "source_record_id": 1,
            "stock_code": "01810.HK",
            "stock_name": "小米集团-W",
            "previous_price": 0,
            "previous_change_pct": 0,
        }
        db = MagicMock()
        db.get_conversation_context.return_value = stored_context
        db.get_analysis_history_by_id.return_value = None
        request_context = {
            "sourceType": "analysis_report",
            "sourceRecordId": 1,
            "stockCode": "01810.HK",
            "stockName": "小米集团-W",
        }

        effective, persisted = agent.resolve_effective_chat_context(
            db,
            "valid-session",
            request_context,
        )

        db.get_analysis_history_by_id.assert_not_called()
        db.save_conversation_context.assert_not_called()
        self.assertEqual(effective["stock_code"], "01810.HK")
        self.assertEqual(effective["previous_price"], 0)
        self.assertEqual(persisted.sourceRecordId, 1)


if __name__ == "__main__":
    unittest.main()
