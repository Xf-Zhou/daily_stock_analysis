# -*- coding: utf-8 -*-
from __future__ import annotations

import math
import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd
from fastapi.testclient import TestClient

import src.auth as auth
from api.app import create_app


class _DailyRow:
    def __init__(self, code: str, row_date: date, close: float = 10.0) -> None:
        self.code = code
        self.date = row_date
        self.open = close - 0.2
        self.high = close + 0.4
        self.low = close - 0.5
        self.close = close
        self.volume = 1000
        self.amount = 10000
        self.pct_chg = 1.2
        self.data_source = "unit-test"

    def to_dict(self):
        return {
            "code": self.code,
            "date": self.date,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
            "amount": self.amount,
            "pct_chg": self.pct_chg,
            "data_source": self.data_source,
        }


def _rows(code: str, latest: date, count: int) -> list[_DailyRow]:
    start = latest - timedelta(days=count - 1)
    return [_DailyRow(code, start + timedelta(days=offset), close=10.0 + offset) for offset in range(count)]


class _FakeDb:
    def __init__(self, rows_by_code=None) -> None:
        self.rows_by_code = rows_by_code or {}
        self.save_daily_data = MagicMock(return_value=1)

    def get_data_range(self, code: str, start_date: date, end_date: date):
        return [
            row
            for row in self.rows_by_code.get(code, [])
            if start_date <= row.date <= end_date
        ]


class StockHistorySnapshotTestCase(unittest.TestCase):
    def test_bse_cache_uses_cn_effective_trading_date_without_fetching(self) -> None:
        from src.services.history_loader import load_history_snapshot

        effective = date(2026, 3, 27)
        db = _FakeDb({"832566": _rows("832566", effective, 30)})
        manager = SimpleNamespace(get_daily_data=MagicMock())

        with patch("src.storage.get_db", return_value=db), \
             patch("src.services.history_loader._get_fetcher_manager", return_value=manager), \
             patch("src.core.trading_calendar.get_effective_trading_date", return_value=effective) as effective_date:
            result = load_history_snapshot("832566.BJ", days=30)

        effective_date.assert_called_once_with("cn")
        manager.get_daily_data.assert_not_called()
        self.assertEqual(result.source, "db_cache")
        self.assertTrue(result.cache_hit)
        self.assertFalse(result.stale)
        self.assertEqual(result.as_of_date, "2026-03-27")
        self.assertEqual(len(result.df), 30)

    def test_force_refresh_failure_falls_back_to_stale_db_candidate(self) -> None:
        from src.services.history_loader import load_history_snapshot

        effective = date(2026, 3, 27)
        stale_latest = date(2026, 3, 26)
        db = _FakeDb({"600519": _rows("600519", stale_latest, 30)})
        manager = SimpleNamespace(get_daily_data=MagicMock(return_value=(None, "none")))

        with patch("src.storage.get_db", return_value=db), \
             patch("src.services.history_loader._get_fetcher_manager", return_value=manager), \
             patch("src.core.trading_calendar.get_effective_trading_date", return_value=effective):
            result = load_history_snapshot("600519", days=60, force_refresh=True)

        manager.get_daily_data.assert_called_once_with("600519", days=60)
        self.assertEqual(result.source, "db_cache")
        self.assertTrue(result.cache_hit)
        self.assertTrue(result.stale)
        self.assertIn("缓存", result.message)
        self.assertEqual(result.as_of_date, "2026-03-26")
        self.assertEqual(len(result.df), 30)

    def test_network_success_persists_with_normalized_write_code(self) -> None:
        from src.services.history_loader import load_history_snapshot

        effective = date(2026, 3, 27)
        db = _FakeDb()
        network_df = pd.DataFrame(
            [{"date": effective, "open": 10, "high": 11, "low": 9.5, "close": 10.5, "volume": 1000}]
        )
        manager = SimpleNamespace(get_daily_data=MagicMock(return_value=(network_df, "eastmoney")))

        with patch("src.storage.get_db", return_value=db), \
             patch("src.services.history_loader._get_fetcher_manager", return_value=manager), \
             patch("src.core.trading_calendar.get_effective_trading_date", return_value=effective):
            result = load_history_snapshot("000001.SZ", days=30)

        db.save_daily_data.assert_called_once()
        _, write_code, source = db.save_daily_data.call_args.args
        self.assertEqual(write_code, "000001")
        self.assertEqual(source, "eastmoney")
        self.assertEqual(result.source, "eastmoney")
        self.assertFalse(result.cache_hit)
        self.assertFalse(result.stale)

    def test_stock_service_filters_nan_nat_and_invalid_ohlc(self) -> None:
        from src.services.history_loader import HistoryLoadResult
        from src.services.stock_service import StockService

        raw_df = pd.DataFrame(
            [
                {"date": "2026-03-25", "open": 10, "high": 11, "low": 9, "close": 10.5, "volume": 100},
                {"date": "2026-03-26", "open": math.nan, "high": 11, "low": 9, "close": 10.5},
                {"date": pd.NaT, "open": 10, "high": 11, "low": 9, "close": 10.5},
                {"date": "2026-03-27", "open": 12, "high": 11, "low": 9, "close": 10.5},
            ]
        )
        snapshot = HistoryLoadResult(
            df=raw_df,
            source="db_cache",
            cache_hit=True,
            stale=False,
            partial_cache=False,
            as_of_date="2026-03-25",
            requested_days=30,
            effective_days=30,
            actual_records=1,
            message=None,
        )

        with patch("src.services.stock_service.load_history_snapshot", return_value=snapshot), \
             patch("src.services.stock_service.get_index_stock_name", return_value="平安银行"):
            result = StockService().get_history_data("000001.SZ", days=30)

        self.assertEqual(result["stock_name"], "平安银行")
        self.assertEqual(result["source"], "db_cache")
        self.assertTrue(result["cache_hit"])
        self.assertEqual(len(result["data"]), 1)
        self.assertEqual(result["data"][0]["date"], "2026-03-25")

    def test_history_endpoint_exposes_metadata_and_force_refresh(self) -> None:
        auth._auth_enabled = None
        app = create_app()
        client = TestClient(app)

        with patch("api.middlewares.auth.is_auth_enabled", return_value=False), \
             patch("src.auth.is_auth_enabled", return_value=False), \
             patch(
                 "api.v1.endpoints.stocks.StockService.get_history_data",
                 return_value={
                     "stock_code": "000001.SZ",
                     "stock_name": "平安银行",
                     "period": "daily",
                     "source": "db_cache",
                     "cache_hit": True,
                     "stale": True,
                     "partial_cache": True,
                     "as_of_date": "2026-03-26",
                     "actual_records": 30,
                     "requested_days": 60,
                     "effective_days": 60,
                     "message": "实时源失败，正在展示缓存数据",
                     "data": [
                         {"date": "2026-03-26", "open": 10, "high": 11, "low": 9, "close": 10.5}
                     ],
                 },
             ) as get_history:
            response = client.get(
                "/api/v1/stocks/000001.SZ/history?period=daily&days=60&force_refresh=true"
            )

        self.assertEqual(response.status_code, 200)
        get_history.assert_called_once_with(
            stock_code="000001.SZ",
            period="daily",
            days=60,
            force_refresh=True,
        )
        payload = response.json()
        self.assertEqual(payload["source"], "db_cache")
        self.assertTrue(payload["cache_hit"])
        self.assertTrue(payload["stale"])
        self.assertTrue(payload["partial_cache"])
        self.assertEqual(payload["as_of_date"], "2026-03-26")
        self.assertEqual(payload["actual_records"], 30)
        self.assertEqual(payload["message"], "实时源失败，正在展示缓存数据")


if __name__ == "__main__":
    unittest.main()
