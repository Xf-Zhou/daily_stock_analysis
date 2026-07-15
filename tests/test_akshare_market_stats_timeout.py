# -*- coding: utf-8 -*-
"""Regression tests for bounded AkShare market-statistics fallbacks."""

import sys
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import pandas as pd

from tests.litellm_stub import ensure_litellm_stub

ensure_litellm_stub()
try:
    import json_repair  # noqa: F401
except ImportError:
    if "json_repair" not in sys.modules:
        sys.modules["json_repair"] = MagicMock()

from data_provider import akshare_fetcher
from data_provider.akshare_fetcher import AkshareFetcher


def _make_market_df():
    return pd.DataFrame(
        [
            {
                "代码": "000001",
                "名称": "平安银行",
                "最新价": 11.0,
                "昨收": 10.0,
                "成交额": 1_000_000,
            },
            {
                "代码": "000002",
                "名称": "万科A",
                "最新价": 9.0,
                "昨收": 10.0,
                "成交额": 2_000_000,
            },
        ]
    )


class TestAkshareMarketStatsTimeout(unittest.TestCase):
    def setUp(self):
        self.fetcher = AkshareFetcher()
        self.fetcher._enforce_rate_limit = lambda: None
        self.fetcher._set_random_user_agent = lambda: None

    @patch("data_provider.akshare_fetcher._ak_call_with_timeout")
    def test_eastmoney_timeout_falls_back_to_bounded_sina_call(self, timeout_call):
        timeout_call.side_effect = [
            TimeoutError("stock_zh_a_spot_em timeout after 30s"),
            _make_market_df(),
        ]
        ak_mock = MagicMock()

        with patch.dict(sys.modules, {"akshare": ak_mock}):
            stats = self.fetcher.get_market_stats()

        self.assertIsNotNone(stats)
        self.assertEqual(stats["up_count"], 1)
        self.assertEqual(stats["down_count"], 1)
        self.assertEqual(
            timeout_call.call_args_list,
            [call(ak_mock.stock_zh_a_spot_em), call(ak_mock.stock_zh_a_spot)],
        )

    @patch("data_provider.akshare_fetcher._ak_call_with_timeout")
    def test_both_timeouts_return_none(self, timeout_call):
        timeout_call.side_effect = [
            TimeoutError("stock_zh_a_spot_em timeout after 30s"),
            TimeoutError("stock_zh_a_spot timeout after 30s"),
        ]
        ak_mock = MagicMock()

        with patch.dict(sys.modules, {"akshare": ak_mock}):
            stats = self.fetcher.get_market_stats()

        self.assertIsNone(stats)
        self.assertEqual(
            timeout_call.call_args_list,
            [call(ak_mock.stock_zh_a_spot_em), call(ak_mock.stock_zh_a_spot)],
        )

    def test_still_running_primary_is_not_resubmitted_after_cooldown(self):
        started = threading.Event()
        release = threading.Event()
        finished = threading.Event()
        primary_call_count = 0

        def hanging_eastmoney():
            nonlocal primary_call_count
            primary_call_count += 1
            started.set()
            try:
                release.wait(timeout=2)
                return pd.DataFrame()
            finally:
                finished.set()

        def healthy_sina():
            return _make_market_df()

        ak_mock = SimpleNamespace(
            stock_zh_a_spot_em=hanging_eastmoney,
            stock_zh_a_spot=healthy_sina,
        )
        real_timeout_call = akshare_fetcher._ak_call_with_timeout

        try:
            with patch.dict(sys.modules, {"akshare": ak_mock}), patch(
                "data_provider.akshare_fetcher._ak_call_with_timeout",
                side_effect=lambda func: real_timeout_call(func, timeout=0.01),
            ):
                first_stats = self.fetcher.get_market_stats()
                self.assertTrue(started.wait(timeout=0.2))

                # Simulate the next scheduled run after the timeout cooldown.
                with akshare_fetcher._AK_TIMEOUT_LOCK:
                    akshare_fetcher._AK_TIMEOUT_UNTIL.pop("hanging_eastmoney", None)

                second_stats = self.fetcher.get_market_stats()

            self.assertIsNotNone(first_stats)
            self.assertIsNotNone(second_stats)
            self.assertEqual(primary_call_count, 1)
        finally:
            release.set()
            self.assertTrue(finished.wait(timeout=1))
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                with akshare_fetcher._AK_TIMEOUT_LOCK:
                    if "hanging_eastmoney" not in akshare_fetcher._AK_INFLIGHT_CALLS:
                        break
                time.sleep(0.01)
            with akshare_fetcher._AK_TIMEOUT_LOCK:
                self.assertNotIn("hanging_eastmoney", akshare_fetcher._AK_INFLIGHT_CALLS)


if __name__ == "__main__":
    unittest.main()
