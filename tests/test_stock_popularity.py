# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
import pandas as pd

from src.services.stock_market_metrics import (
    CACHE_VERSION,
    BatchQuoteResult,
    StockPopularityMetrics,
    apply_popularity_to_index_data,
    cache_key_for_stock,
    compute_popularity_scores,
    fetch_eastmoney_lightweight_batch_quotes,
    get_cache_scores,
    write_index_json_atomic,
)

import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
import generate_stock_index  # noqa: E402
import update_stock_popularity  # noqa: E402


def test_cache_key_uses_market_and_canonical_code():
    assert cache_key_for_stock("CN", "000001.SZ") == "CN:000001.SZ"
    assert cache_key_for_stock("BSE", "832566.BJ") == "BSE:832566.BJ"
    assert cache_key_for_stock("HK", "00700.HK") == "HK:00700.HK"
    assert cache_key_for_stock("US", "aapl") == "US:AAPL"
    assert cache_key_for_stock("US", "AAPL.US") == "US:AAPL"
    assert cache_key_for_stock("US", "BRK.B") == "US:BRK.B"


def test_popularity_scoring_handles_percentile_boundaries():
    now = datetime(2026, 7, 5, tzinfo=timezone.utc)
    metrics = [
        StockPopularityMetrics("000001.SZ", "CN", market_cap=100, amount=10, updated_at=now),
        StockPopularityMetrics("000002.SZ", "CN", market_cap=100, amount=10, updated_at=now),
        StockPopularityMetrics("000003.SZ", "CN", market_cap=None, amount=0, volume=None, updated_at=now),
        StockPopularityMetrics("AAPL", "US", market_cap=1000, avg_volume=None, updated_at=now),
    ]

    scores = compute_popularity_scores(metrics)

    # CN has two equal positive values, so each positive percentile is 0.5.
    assert scores["CN:000001.SZ"] == 55
    assert scores["CN:000002.SZ"] == 55
    # Empty/zero metrics should not get a fake default score.
    assert scores["CN:000003.SZ"] == 0
    # Single positive metric uses 0.5 percentile.
    assert scores["US:AAPL"] == 50


def test_cache_scores_ignore_version_mismatch_and_expired_entries():
    now = datetime(2026, 7, 5, tzinfo=timezone.utc)
    valid_cache = {
        "version": CACHE_VERSION,
        "ttl_hours": 72,
        "max_stale_days": 30,
        "entries": {
            "CN:000001.SZ": {
                "code": "000001.SZ",
                "market": "CN",
                "score": 76,
                "status": "fresh",
                "source": "test",
                "updated_at": (now - timedelta(days=2)).isoformat(),
                "metrics": {"market_cap": 100, "amount": 10},
            },
            "CN:000002.SZ": {
                "code": "000002.SZ",
                "market": "CN",
                "score": 88,
                "status": "fresh",
                "source": "test",
                "updated_at": (now - timedelta(days=31)).isoformat(),
                "metrics": {"market_cap": 100, "amount": 10},
            },
        },
    }

    assert get_cache_scores(valid_cache, now=now) == {"CN:000001.SZ": 76}
    assert get_cache_scores({**valid_cache, "version": 0}, now=now) == {}


def test_apply_popularity_preserves_skipped_market_and_tuple_shape():
    index_data = [
        ["000001.SZ", "000001", "平安银行", None, None, [], "CN", "stock", True, 100, "银行", "tushare"],
        ["00700.HK", "00700", "腾讯控股", None, None, [], "HK", "stock", True, 100, "互联网", "override"],
        ["AAPL", "AAPL", "Apple Inc.", None, None, [], "US", "stock", True, 100],
    ]

    updated, stats = apply_popularity_to_index_data(
        index_data,
        {
            "CN:000001.SZ": 73,
            "US:AAPL": 81,
        },
        skipped_markets={"HK"},
    )

    assert updated[0][9] == 73
    assert updated[1][9] == 100
    assert updated[2][9] == 81
    assert len(updated[0]) == 12
    assert len(updated[2]) == 10
    assert stats["updated"] == 2
    assert stats["skipped"] == 1


def test_atomic_index_write_does_not_corrupt_existing_file_on_failure(tmp_path, monkeypatch):
    index_path = tmp_path / "stocks.index.json"
    index_path.write_text("[[\"OLD\"]]\n", encoding="utf-8")

    def fail_replace(src: str | Path, dst: str | Path) -> None:
        raise OSError("simulated replace failure")

    monkeypatch.setattr("src.services.stock_market_metrics.os.replace", fail_replace)

    with pytest.raises(OSError):
        write_index_json_atomic(index_path, [["NEW"]])

    assert index_path.read_text(encoding="utf-8") == "[[\"OLD\"]]\n"


def test_legacy_generate_stock_index_reads_cache_and_defaults_to_zero(monkeypatch):
    monkeypatch.setattr(
        "src.data.stock_mapping.STOCK_NAME_MAP",
        {"000001": "平安银行", "600519": "贵州茅台"},
    )

    index = generate_stock_index.generate_stock_index_from_map(
        popularity_scores={"CN:000001.SZ": 66},
    )

    by_code = {item["canonicalCode"]: item for item in index}
    assert by_code["000001.SZ"]["popularity"] == 66
    assert by_code["600519.SH"]["popularity"] == 0


def test_update_script_skips_market_without_source_or_cache_unless_explicit_zero_write(tmp_path, monkeypatch):
    index_path = tmp_path / "stocks.index.json"
    cache_path = tmp_path / "stock_popularity_cache.json"
    index_path.write_text(
        json.dumps(
            [["000001.SZ", "000001", "平安银行", None, None, [], "CN", "stock", True, 100]],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(update_stock_popularity, "fetch_cn_batch_quotes", lambda: (_ for _ in ()).throw(RuntimeError("source down")))

    base_args = {
        "index_path": str(index_path),
        "cache_path": str(cache_path),
        "markets": "CN",
        "test": False,
        "force_refresh": False,
        "strict_coverage": False,
        "us_scope": "core",
    }

    assert update_stock_popularity.run(SimpleNamespace(**base_args, allow_zero_write=False)) == 0
    assert json.loads(index_path.read_text(encoding="utf-8"))[0][9] == 100

    assert update_stock_popularity.run(SimpleNamespace(**base_args, allow_zero_write=True)) == 0
    assert json.loads(index_path.read_text(encoding="utf-8"))[0][9] == 0


def test_update_script_us_core_scope_preserves_non_core_scores(tmp_path, monkeypatch):
    index_path = tmp_path / "stocks.index.json"
    cache_path = tmp_path / "stock_popularity_cache.json"
    pool_path = tmp_path / "data" / "us_ranking_core_pool.csv"
    pool_path.parent.mkdir(parents=True)
    pool_path.write_text("symbol,name,industry\nAAPL,Apple Inc.,Technology\n", encoding="utf-8")
    index_path.write_text(
        json.dumps(
            [
                ["AAPL", "AAPL", "Apple Inc.", None, None, [], "US", "stock", True, 100],
                ["ZZZZ", "ZZZZ", "Zzz Corp", None, None, [], "US", "stock", True, 88],
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(update_stock_popularity, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(
        update_stock_popularity,
        "fetch_yfinance_popularity_metrics",
        lambda symbols: [StockPopularityMetrics("AAPL", "US", market_cap=1000, avg_volume=10)],
    )

    assert update_stock_popularity.run(
        SimpleNamespace(
            index_path=str(index_path),
            cache_path=str(cache_path),
            markets="US",
            test=False,
            force_refresh=False,
            strict_coverage=False,
            allow_zero_write=False,
            us_scope="core",
        )
    ) == 0

    updated = json.loads(index_path.read_text(encoding="utf-8"))
    assert updated[0][9] != 100
    assert updated[1][9] == 88


def test_update_script_treats_shell_metrics_as_no_fresh_coverage(tmp_path, monkeypatch):
    index_path = tmp_path / "stocks.index.json"
    cache_path = tmp_path / "stock_popularity_cache.json"
    pool_path = tmp_path / "data" / "us_ranking_core_pool.csv"
    pool_path.parent.mkdir(parents=True)
    pool_path.write_text("symbol,name,industry\nAAPL,Apple Inc.,Technology\n", encoding="utf-8")
    index_path.write_text(
        json.dumps(
            [["AAPL", "AAPL", "Apple Inc.", None, None, [], "US", "stock", True, 100]],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(update_stock_popularity, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(
        update_stock_popularity,
        "fetch_yfinance_popularity_metrics",
        lambda symbols: [StockPopularityMetrics("AAPL", "US", market_cap=None, avg_volume=None, volume=0)],
    )

    assert update_stock_popularity.run(
        SimpleNamespace(
            index_path=str(index_path),
            cache_path=str(cache_path),
            markets="US",
            test=False,
            force_refresh=False,
            strict_coverage=False,
            allow_zero_write=False,
            us_scope="core",
        )
    ) == 0
    assert json.loads(index_path.read_text(encoding="utf-8"))[0][9] == 100


def test_update_script_uses_lightweight_cn_fallback_when_primary_batch_fails(tmp_path, monkeypatch):
    index_path = tmp_path / "stocks.index.json"
    cache_path = tmp_path / "stock_popularity_cache.json"
    index_path.write_text(
        json.dumps(
            [["000001.SZ", "000001", "平安银行", None, None, [], "CN", "stock", True, 100]],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(update_stock_popularity, "fetch_cn_batch_quotes", lambda: (_ for _ in ()).throw(RuntimeError("primary down")))
    monkeypatch.setattr(
        update_stock_popularity,
        "fetch_eastmoney_lightweight_batch_quotes",
        lambda market: BatchQuoteResult(
            pd.DataFrame(
                [
                    {
                        "代码": "000001",
                        "名称": "平安银行",
                        "成交量": 1000,
                        "成交额": 5000,
                        "总市值": 100000,
                        "流通市值": 90000,
                    }
                ]
            ),
            "eastmoney_lightweight",
            None,
            "ok",
        ),
    )

    assert update_stock_popularity.run(
        SimpleNamespace(
            index_path=str(index_path),
            cache_path=str(cache_path),
            markets="CN",
            test=False,
            force_refresh=False,
            strict_coverage=False,
            allow_zero_write=False,
            us_scope="core",
        )
    ) == 0

    assert json.loads(index_path.read_text(encoding="utf-8"))[0][9] > 0


def test_lightweight_eastmoney_retries_without_system_proxy(monkeypatch):
    calls: list[bool] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "data": {
                    "total": 1,
                    "diff": [
                        {"f12": "000001", "f14": "平安银行", "f5": 100, "f6": 200, "f20": 300, "f21": 250}
                    ],
                }
            }

    class FakeSession:
        def __init__(self) -> None:
            self.trust_env = True
            self.headers = {}

        def get(self, *args, **kwargs):
            calls.append(self.trust_env)
            if self.trust_env:
                raise RuntimeError("proxy path failed")
            return FakeResponse()

    monkeypatch.setattr("src.services.stock_market_metrics.requests.Session", FakeSession)
    monkeypatch.setattr("src.services.stock_market_metrics.time.sleep", lambda *_args, **_kwargs: None)

    result = fetch_eastmoney_lightweight_batch_quotes("CN", page_size=20)

    assert calls == [True, False]
    assert result.source == "eastmoney_lightweight"
    assert result.df.iloc[0]["代码"] == "000001"


def test_lightweight_eastmoney_reduces_page_size_after_disconnect(monkeypatch):
    page_sizes: list[int] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "data": {
                    "total": 1,
                    "diff": [
                        {"f12": "832566", "f14": "梓橦宫", "f5": 100, "f6": 200, "f20": 300, "f21": 250}
                    ],
                }
            }

    class FakeSession:
        def __init__(self) -> None:
            self.trust_env = True
            self.headers = {}

        def get(self, _url, params, **_kwargs):
            page_sizes.append(params["pz"])
            if params["pz"] > 1:
                raise RuntimeError("large page disconnected")
            return FakeResponse()

    monkeypatch.setattr("src.services.stock_market_metrics.requests.Session", FakeSession)
    monkeypatch.setattr("src.services.stock_market_metrics.time.sleep", lambda *_args, **_kwargs: None)

    result = fetch_eastmoney_lightweight_batch_quotes("BSE", page_size=20)

    assert 20 in page_sizes
    assert 1 in page_sizes
    assert result.df.iloc[0]["代码"] == "832566"
