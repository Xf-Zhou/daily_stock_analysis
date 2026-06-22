# -*- coding: utf-8 -*-
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import pandas as pd
from fastapi.testclient import TestClient

import src.auth as auth
from api.app import create_app
from src.data.stock_index_loader import StockIndexEntry
from src.services.stock_discovery_service import StockDiscoveryService, _BATCH_CACHE


def _entry(
    canonical: str,
    display: str,
    name: str,
    market: str,
    industry: str | None = None,
) -> StockIndexEntry:
    return StockIndexEntry(
        canonical_code=canonical,
        display_code=display,
        name_zh=name,
        market=market,
        asset_type="stock",
        active=True,
        industry=industry,
        industry_source="test" if industry else None,
    )


class StockRankingsTestCase(unittest.TestCase):
    def setUp(self):
        _BATCH_CACHE.clear()
        from data_provider import akshare_fetcher, efinance_fetcher

        efinance_fetcher._realtime_cache["data"] = None
        efinance_fetcher._realtime_cache["timestamp"] = 0
        akshare_fetcher._realtime_cache["data"] = None
        akshare_fetcher._realtime_cache["timestamp"] = 0

    def test_cn_batch_quotes_uses_efinance_timeout_adapter_before_fallback(self):
        service = StockDiscoveryService(index_entries=[])
        quotes = pd.DataFrame(
            [
                {"代码": "000001", "名称": "平安银行", "最新价": 10.0, "涨跌幅": 1.0, "成交额": 1000, "成交量": 100},
            ]
        )
        raw_ef_call = Mock(side_effect=AssertionError("raw efinance call should not be used"))
        fake_ef = SimpleNamespace(stock=SimpleNamespace(get_realtime_quotes=raw_ef_call))
        fake_ak = SimpleNamespace(stock_zh_a_spot_em=Mock(return_value=quotes))
        circuit = SimpleNamespace(
            is_available=Mock(return_value=True),
            record_success=Mock(),
            record_failure=Mock(),
        )

        with patch.dict(sys.modules, {"efinance": fake_ef, "akshare": fake_ak}), \
             patch("data_provider.efinance_fetcher.get_realtime_circuit_breaker", return_value=circuit), \
             patch("data_provider.efinance_fetcher.EfinanceFetcher._set_random_user_agent"), \
             patch("data_provider.efinance_fetcher.EfinanceFetcher._enforce_rate_limit"), \
             patch("data_provider.efinance_fetcher._ef_call_with_timeout", return_value=quotes) as call_with_timeout:
            result = service._fetch_cn_batch_quotes()

        self.assertEqual(result.df.iloc[0]["代码"], "000001")
        self.assertEqual(result.source, "efinance")
        call_with_timeout.assert_called_once()
        raw_ef_call.assert_not_called()
        fake_ak.stock_zh_a_spot_em.assert_not_called()
        circuit.record_success.assert_called_once_with("efinance")

    def test_rankings_sort_change_pct_asc_and_match_bse_codes(self):
        service = StockDiscoveryService(
            index_entries=[
                _entry("832566.BJ", "832566", "梓橦宫", "BSE", "医药商业"),
                _entry("920118.BJ", "920118", "太湖远大", "BSE", "化工"),
            ]
        )
        quotes = pd.DataFrame(
            [
                {"代码": "832566", "名称": "梓橦宫", "最新价": 12.3, "涨跌幅": -4.2, "成交额": 8000, "成交量": 100},
                {"代码": "920118", "名称": "太湖远大", "最新价": 9.1, "涨跌幅": 2.1, "成交额": 5000, "成交量": 90},
            ]
        )

        with patch.object(service, "_get_cn_batch_quotes", return_value=(quotes, "mock-cn", datetime(2026, 6, 21, tzinfo=timezone.utc), "ok")):
            payload = service.get_rankings(market="BSE", metric="change_pct", direction="asc", limit=10)

        self.assertEqual(payload["status"], "ok")
        self.assertEqual([item["code"] for item in payload["items"]], ["832566.BJ", "920118.BJ"])
        self.assertEqual(payload["items"][0]["change_pct"], -4.2)

    def test_rankings_uncategorized_filter_only_returns_missing_industry(self):
        service = StockDiscoveryService(
            index_entries=[
                _entry("000001.SZ", "000001", "平安银行", "CN", "银行"),
                _entry("000002.SZ", "000002", "万科A", "CN", None),
            ]
        )
        quotes = pd.DataFrame(
            [
                {"代码": "000001", "名称": "平安银行", "最新价": 10.0, "涨跌幅": 1.0, "成交额": 1000, "成交量": 100},
                {"代码": "000002", "名称": "万科A", "最新价": 8.0, "涨跌幅": 3.0, "成交额": 2000, "成交量": 200},
            ]
        )

        with patch.object(service, "_get_cn_batch_quotes", return_value=(quotes, "mock-cn", datetime(2026, 6, 21, tzinfo=timezone.utc), "ok")):
            payload = service.get_rankings(market="CN", industry="__uncategorized__", metric="amount", direction="desc")

        self.assertEqual(payload["status"], "ok")
        self.assertEqual([item["code"] for item in payload["items"]], ["000002.SZ"])
        self.assertIsNone(payload["items"][0]["industry"])

    def test_rankings_returns_empty_without_fetching_when_filter_has_no_candidates(self):
        service = StockDiscoveryService(
            index_entries=[
                _entry("000001.SZ", "000001", "平安银行", "CN", "银行"),
            ]
        )

        with patch.object(service, "_get_cn_batch_quotes") as get_quotes:
            payload = service.get_rankings(market="CN", industry="不存在的行业")

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["items"], [])
        get_quotes.assert_not_called()

    def test_rankings_reports_partial_when_fresh_batch_misses_some_candidates(self):
        service = StockDiscoveryService(
            index_entries=[
                _entry("000001.SZ", "000001", "平安银行", "CN", "银行"),
                _entry("000002.SZ", "000002", "万科A", "CN", "房地产"),
            ]
        )
        quotes = pd.DataFrame(
            [
                {"代码": "000001", "名称": "平安银行", "最新价": 10.0, "涨跌幅": 1.0, "成交额": 1000, "成交量": 100},
            ]
        )

        with patch.object(service, "_get_cn_batch_quotes", return_value=(quotes, "mock-cn", datetime(2026, 6, 21, tzinfo=timezone.utc), "ok")):
            payload = service.get_rankings(market="CN", metric="change_pct", direction="desc")

        self.assertEqual(payload["status"], "partial")
        self.assertEqual([item["code"] for item in payload["items"]], ["000001.SZ"])

    def test_rankings_preserves_stale_status_when_using_old_batch_cache(self):
        service = StockDiscoveryService(
            index_entries=[
                _entry("000001.SZ", "000001", "平安银行", "CN", "银行"),
            ]
        )
        quotes = pd.DataFrame(
            [
                {"代码": "000001", "名称": "平安银行", "最新价": 10.0, "涨跌幅": 1.0, "成交额": 1000, "成交量": 100},
            ]
        )

        with patch.object(service, "_get_cn_batch_quotes", return_value=(quotes, "mock-cn", datetime(2026, 6, 21, tzinfo=timezone.utc), "stale")):
            payload = service.get_rankings(market="CN", metric="change_pct", direction="desc")

        self.assertEqual(payload["status"], "stale")
        self.assertEqual(payload["items"][0]["source"], "mock-cn")

    def test_cn_fallback_reports_akshare_source(self):
        service = StockDiscoveryService(
            index_entries=[
                _entry("000001.SZ", "000001", "平安银行", "CN", "银行"),
            ]
        )
        quotes = pd.DataFrame(
            [
                {"代码": "000001", "名称": "平安银行", "最新价": 10.0, "涨跌幅": 1.0, "成交额": 1000, "成交量": 100},
            ]
        )

        with patch.object(service, "_fetch_efinance_batch_quotes", side_effect=RuntimeError("efinance down")), \
             patch.object(service, "_fetch_akshare_cn_batch_quotes", return_value=quotes):
            payload = service.get_rankings(market="CN", metric="change_pct", direction="desc")

        self.assertEqual(payload["source"], "akshare_em")
        self.assertEqual(payload["items"][0]["source"], "akshare_em")

    def test_hk_sina_fallback_reports_sina_source(self):
        service = StockDiscoveryService(
            index_entries=[
                _entry("00700.HK", "00700", "腾讯控股", "HK", "互联网"),
            ]
        )
        quotes = pd.DataFrame(
            [
                {"代码": "00700", "名称": "腾讯控股", "最新价": 390.0, "涨跌幅": 2.0, "成交额": 3000, "成交量": 200},
            ]
        )
        fake_ak = SimpleNamespace(
            stock_hk_spot_em=Mock(side_effect=RuntimeError("em down")),
            stock_hk_spot=Mock(return_value=quotes),
        )
        circuit = SimpleNamespace(
            is_available=Mock(return_value=True),
            record_success=Mock(),
            record_failure=Mock(),
        )

        with patch.dict(sys.modules, {"akshare": fake_ak}), \
             patch("data_provider.akshare_fetcher.get_realtime_circuit_breaker", return_value=circuit), \
             patch("data_provider.akshare_fetcher.AkshareFetcher._set_random_user_agent"), \
             patch("data_provider.akshare_fetcher.AkshareFetcher._enforce_rate_limit"):
            payload = service.get_rankings(market="HK", metric="change_pct", direction="desc")

        self.assertEqual(payload["source"], "akshare_hk_sina")
        self.assertEqual(payload["items"][0]["source"], "akshare_hk_sina")

    def test_rankings_reports_no_source_when_all_batch_sources_fail_without_cache(self):
        service = StockDiscoveryService(
            index_entries=[
                _entry("000001.SZ", "000001", "平安银行", "CN", "银行"),
            ]
        )

        with patch.object(service, "_fetch_cn_batch_quotes", side_effect=RuntimeError("all sources down")):
            payload = service.get_rankings(market="CN", metric="change_pct", direction="desc")

        self.assertEqual(payload["status"], "stale")
        self.assertIsNone(payload["source"])
        self.assertEqual(payload["items"], [])

    def test_rankings_reports_unsupported_when_us_core_pool_is_empty(self):
        service = StockDiscoveryService(index_entries=[])

        with patch.object(service, "_load_us_core_pool_entries", return_value=()):
            payload = service.get_rankings(market="US")

        self.assertEqual(payload["status"], "unsupported")
        self.assertEqual(payload["items"], [])

    def test_us_core_quotes_are_cached_across_metric_changes(self):
        service = StockDiscoveryService(
            index_entries=[
                _entry("AAPL", "AAPL", "Apple Inc.", "US", "Consumer Electronics"),
            ]
        )
        quote = SimpleNamespace(
            name="Apple Inc.",
            price=190.0,
            change_pct=1.5,
            amount=123456789.0,
            volume=987654,
            source=SimpleNamespace(value="yfinance"),
        )

        with patch.object(service, "_load_us_core_pool_entries", return_value=service.index_entries), \
             patch("src.services.stock_discovery_service.YfinanceFetcher") as fetcher_cls:
            fetcher = fetcher_cls.return_value
            fetcher.get_realtime_quote.return_value = quote

            first = service.get_rankings(market="US", metric="change_pct", direction="desc")
            second = service.get_rankings(market="US", metric="volume", direction="desc")

        self.assertEqual(fetcher.get_realtime_quote.call_count, 1)
        self.assertEqual(first["status"], "ok")
        self.assertEqual(second["items"][0]["code"], "AAPL")

    def test_us_core_pool_industry_source_is_override(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            data_dir = Path(temp_dir) / "data"
            data_dir.mkdir()
            (data_dir / "us_ranking_core_pool.csv").write_text(
                "symbol,name,industry\nAAPL,Apple Inc.,Consumer Electronics\n",
                encoding="utf-8",
            )

            with patch.object(StockDiscoveryService, "_repo_root", return_value=Path(temp_dir)):
                service = StockDiscoveryService(index_entries=[])
                entries = service._load_us_core_pool_entries()

        self.assertEqual(entries[0].industry_source, "override")

    def test_rankings_route_is_not_captured_by_dynamic_stock_routes(self):
        auth._auth_enabled = None
        app = create_app()
        client = TestClient(app)

        with patch("api.middlewares.auth.is_auth_enabled", return_value=False), \
             patch("src.auth.is_auth_enabled", return_value=False), \
             patch(
                 "api.v1.endpoints.stocks.StockDiscoveryService.get_rankings",
                 return_value={
                     "status": "unsupported",
                     "source": None,
                     "updated_at": None,
                     "items": [],
                 },
             ):
            response = client.get("/api/v1/stocks/rankings?market=CN")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "unsupported")


if __name__ == "__main__":
    unittest.main()
