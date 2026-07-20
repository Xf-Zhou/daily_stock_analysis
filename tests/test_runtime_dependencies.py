# -*- coding: utf-8 -*-
"""Smoke tests for runtime dependencies used by optional execution paths."""


def test_orjson_is_available_for_litellm_agent_tool_calls():
    """Agent tool calls enter LiteLLM modules that import orjson at runtime."""
    import orjson

    assert orjson.loads(orjson.dumps({"status": "ok"})) == {"status": "ok"}
