# -*- coding: utf-8 -*-
from __future__ import annotations

import csv
import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Iterable, Literal

import pandas as pd

from data_provider.realtime_types import safe_float, safe_int
from data_provider.yfinance_fetcher import YfinanceFetcher
from src.data.stock_index_loader import (
    StockIndexEntry,
    build_stock_index_lookup_keys,
    load_stock_index_entries,
)
from src.services import stock_market_metrics as market_metrics

logger = logging.getLogger(__name__)

UNCATEGORIZED_INDUSTRY = "__uncategorized__"
SUPPORTED_MARKETS = {"CN", "BSE", "HK", "US"}
SUPPORTED_METRICS = {"change_pct", "amount", "volume"}
SUPPORTED_DIRECTIONS = {"asc", "desc"}
BATCH_CACHE_TTL_SECONDS = 300
BATCH_SOURCE_TIMEOUT_SECONDS = 30
NO_BATCH_CACHE_MESSAGE = "批量行情源暂不可用，且没有可用缓存"
US_CORE_POOL_LIMIT = 100
US_CONCURRENCY = 5
US_SYMBOL_TIMEOUT_SECONDS = 12
US_OVERALL_TIMEOUT_SECONDS = 25
RankingStatus = Literal["ok", "partial", "stale", "unsupported", "unavailable"]


@dataclass(frozen=True)
class BatchQuoteResult:
    df: pd.DataFrame
    source: str | None
    updated_at: datetime | None
    status: RankingStatus


@dataclass
class _BatchCache:
    df: pd.DataFrame
    source: str
    updated_at: datetime
    timestamp: float
    status: RankingStatus = "ok"


_BATCH_CACHE: dict[str, _BatchCache] = {}
_BATCH_CACHE_LOCK = RLock()


class StockDiscoveryService:
    """Stock discovery rankings based on static index candidates and batch quotes."""

    def __init__(self, index_entries: Iterable[StockIndexEntry] | None = None):
        self.index_entries = tuple(index_entries) if index_entries is not None else load_stock_index_entries()

    def get_rankings(
        self,
        market: str,
        industry: str | None = None,
        metric: str = "change_pct",
        direction: str = "desc",
        limit: int = 20,
    ) -> dict[str, Any]:
        market = str(market or "").upper()
        metric = str(metric or "change_pct")
        direction = str(direction or "desc")

        if market not in SUPPORTED_MARKETS:
            raise ValueError(f"Unsupported market: {market}")
        if metric not in SUPPORTED_METRICS:
            raise ValueError(f"Unsupported ranking metric: {metric}")
        if direction not in SUPPORTED_DIRECTIONS:
            raise ValueError(f"Unsupported ranking direction: {direction}")
        if limit < 1 or limit > 100:
            raise ValueError("limit must be between 1 and 100")

        if market == "US":
            core_entries = self._load_us_core_pool_entries()
            if not core_entries:
                return self._empty_payload("unsupported")
            candidates = self._filter_entries(core_entries, market, industry)
            if not candidates:
                return self._empty_payload("ok")
            quote_result = self._coerce_batch_result(self._get_us_core_quotes(core_entries))
        else:
            candidates = self._filter_entries(self.index_entries, market, industry)
            if not candidates:
                return self._empty_payload("ok")
            raw_quote_result = self._get_hk_batch_quotes() if market == "HK" else self._get_cn_batch_quotes(market)
            quote_result = self._coerce_batch_result(raw_quote_result)

        if quote_result.df is None or quote_result.df.empty:
            return self._empty_payload(
                quote_result.status,
                source=quote_result.source,
                updated_at=quote_result.updated_at,
                message=NO_BATCH_CACHE_MESSAGE if quote_result.status == "unavailable" else None,
            )

        quote_lookup = self._build_quote_lookup(quote_result.df, market)
        rows: list[dict[str, Any]] = []
        missing_count = 0
        updated_at = self._format_dt(quote_result.updated_at)

        for entry in candidates:
            quote_row = self._find_quote_row(entry, quote_lookup)
            if quote_row is None:
                missing_count += 1
                continue
            item = self._build_ranking_item(
                entry=entry,
                quote_row=quote_row,
                market=market,
                source=quote_row.get("_source") or quote_result.source,
                updated_at=quote_row.get("_updated_at") or updated_at,
            )
            if item.get(metric) is None:
                missing_count += 1
                continue
            rows.append(item)

        reverse = direction == "desc"
        rows.sort(key=lambda item: item.get(metric), reverse=reverse)

        status = quote_result.status
        if status == "ok" and missing_count > 0:
            status = "partial"

        return {
            "status": status,
            "source": quote_result.source,
            "updated_at": updated_at,
            "items": rows[:limit],
        }

    def _filter_entries(
        self,
        entries: Iterable[StockIndexEntry],
        market: str,
        industry: str | None,
    ) -> tuple[StockIndexEntry, ...]:
        expected_industry = str(industry or "").strip()
        filtered: list[StockIndexEntry] = []
        for entry in entries:
            if entry.market.upper() != market:
                continue
            if not entry.active or entry.asset_type != "stock":
                continue
            if expected_industry == UNCATEGORIZED_INDUSTRY:
                if entry.industry:
                    continue
            elif expected_industry:
                if entry.industry != expected_industry:
                    continue
            filtered.append(entry)
        return tuple(filtered)

    @staticmethod
    def _coerce_batch_result(value: Any) -> BatchQuoteResult:
        if isinstance(value, BatchQuoteResult):
            return value
        if isinstance(value, tuple) and len(value) == 4:
            df, source, updated_at, status = value
            return BatchQuoteResult(
                df=df,
                source=source,
                updated_at=updated_at,
                status=status,
            )
        raise TypeError(f"Unexpected batch quote result: {type(value).__name__}")

    def _get_cn_batch_quotes(self, market: str) -> BatchQuoteResult:
        return self._get_cached_batch_quotes(
            cache_key="cn",
            source_name="efinance",
            fetcher=self._fetch_cn_batch_quotes,
        )

    def _get_hk_batch_quotes(self) -> BatchQuoteResult:
        return self._get_cached_batch_quotes(
            cache_key="hk",
            source_name="akshare_hk_em",
            fetcher=self._fetch_hk_batch_quotes,
        )

    def _get_cached_batch_quotes(
        self,
        cache_key: str,
        source_name: str,
        fetcher: Any,
    ) -> BatchQuoteResult:
        now = time.time()
        with _BATCH_CACHE_LOCK:
            cached = _BATCH_CACHE.get(cache_key)
            if cached and now - cached.timestamp <= BATCH_CACHE_TTL_SECONDS:
                return BatchQuoteResult(cached.df, cached.source, cached.updated_at, cached.status)

        try:
            raw_result = fetcher()
            updated_at = datetime.now(timezone.utc)
            fetch_result = self._coerce_fetcher_batch_result(raw_result, source_name, updated_at)
            with _BATCH_CACHE_LOCK:
                _BATCH_CACHE[cache_key] = _BatchCache(
                    df=fetch_result.df,
                    source=fetch_result.source or source_name,
                    updated_at=fetch_result.updated_at or updated_at,
                    timestamp=now,
                    status=fetch_result.status,
                )
            return BatchQuoteResult(
                fetch_result.df,
                fetch_result.source or source_name,
                fetch_result.updated_at or updated_at,
                fetch_result.status,
            )
        except Exception as exc:
            logger.warning("[股票发现] 获取批量行情失败 cache_key=%s: %s", cache_key, exc)
            with _BATCH_CACHE_LOCK:
                cached = _BATCH_CACHE.get(cache_key)
                if cached:
                    return BatchQuoteResult(cached.df, cached.source, cached.updated_at, "stale")
            return BatchQuoteResult(pd.DataFrame(), None, None, "unavailable")

    @staticmethod
    def _coerce_fetcher_batch_result(
        value: Any,
        default_source: str,
        default_updated_at: datetime,
    ) -> BatchQuoteResult:
        if isinstance(value, BatchQuoteResult):
            return value
        if all(hasattr(value, attr) for attr in ("df", "source", "updated_at", "status")):
            return BatchQuoteResult(
                df=value.df,
                source=value.source,
                updated_at=value.updated_at,
                status=value.status,
            )
        if isinstance(value, pd.DataFrame):
            return BatchQuoteResult(value, default_source, default_updated_at, "ok")
        return StockDiscoveryService._coerce_batch_result(value)

    def _fetch_cn_batch_quotes(self) -> BatchQuoteResult:
        try:
            return BatchQuoteResult(self._fetch_efinance_batch_quotes(), "efinance", None, "ok")
        except Exception as efinance_exc:
            logger.debug("[股票发现] efinance 受保护批量行情失败，尝试 akshare: %s", efinance_exc)
            return BatchQuoteResult(self._fetch_akshare_cn_batch_quotes(), "akshare_em", None, "ok")

    def _fetch_efinance_batch_quotes(self) -> pd.DataFrame:
        return market_metrics.fetch_efinance_batch_quotes()

    def _fetch_akshare_cn_batch_quotes(self) -> pd.DataFrame:
        return market_metrics.fetch_akshare_cn_batch_quotes()

    def _fetch_hk_batch_quotes(self) -> BatchQuoteResult:
        result = market_metrics.fetch_hk_batch_quotes()
        return BatchQuoteResult(result.df, result.source, result.updated_at, result.status)

    def _load_us_core_pool_entries(self) -> tuple[StockIndexEntry, ...]:
        pool_path = self._repo_root() / "data" / "us_ranking_core_pool.csv"
        if not pool_path.is_file():
            return ()

        index_by_key: dict[str, StockIndexEntry] = {}
        for entry in self.index_entries:
            if entry.market.upper() != "US":
                continue
            for key in build_stock_index_lookup_keys(entry.canonical_code, entry.display_code):
                index_by_key[key.upper()] = entry

        entries: list[StockIndexEntry] = []
        try:
            with pool_path.open("r", encoding="utf-8-sig", newline="") as fh:
                reader = csv.DictReader(fh)
                for row in reader:
                    symbol = str(row.get("symbol") or "").strip().upper()
                    if not symbol:
                        continue
                    index_entry = index_by_key.get(symbol)
                    csv_name = str(row.get("name") or "").strip()
                    csv_industry = str(row.get("industry") or "").strip()
                    name = csv_name or (index_entry.name_zh if index_entry else symbol)
                    industry = csv_industry or (index_entry.industry if index_entry else None)
                    entries.append(
                        StockIndexEntry(
                            canonical_code=symbol,
                            display_code=symbol,
                            name_zh=name,
                            pinyin=index_entry.pinyin if index_entry else "",
                            acronym=index_entry.acronym if index_entry else "",
                            aliases=index_entry.aliases if index_entry else (),
                            market="US",
                            asset_type="stock",
                            active=True,
                            popularity=index_entry.popularity if index_entry else None,
                            industry=industry,
                            industry_source="override" if csv_industry else (index_entry.industry_source if index_entry else None),
                        )
                    )
                    if len(entries) >= US_CORE_POOL_LIMIT:
                        break
        except OSError as exc:
            logger.warning("[股票发现] 读取美股核心池失败 %s: %s", pool_path, exc)
            return ()
        return tuple(entries)

    def _get_us_core_quotes(self, entries: Iterable[StockIndexEntry]) -> BatchQuoteResult:
        symbols = [entry.canonical_code.upper() for entry in entries][:US_CORE_POOL_LIMIT]
        if not symbols:
            return BatchQuoteResult(pd.DataFrame(), "yfinance", None, "unsupported")

        cache_key = f"us:{','.join(symbols)}"
        now = time.time()
        with _BATCH_CACHE_LOCK:
            cached = _BATCH_CACHE.get(cache_key)
            if cached and now - cached.timestamp <= BATCH_CACHE_TTL_SECONDS:
                return BatchQuoteResult(cached.df, cached.source, cached.updated_at, cached.status)

        result = self._fetch_us_core_quotes(symbols)
        with _BATCH_CACHE_LOCK:
            _BATCH_CACHE[cache_key] = _BatchCache(
                df=result.df,
                source=result.source or "yfinance",
                updated_at=result.updated_at or datetime.now(timezone.utc),
                timestamp=now,
                status=result.status,
            )
        return result

    def _fetch_us_core_quotes(self, symbols: list[str]) -> BatchQuoteResult:
        fetcher = YfinanceFetcher()
        rows: list[dict[str, Any]] = []
        failed = 0
        updated_at = datetime.now(timezone.utc)
        executor = ThreadPoolExecutor(max_workers=US_CONCURRENCY)
        future_to_symbol = {
            executor.submit(fetcher.get_realtime_quote, symbol): symbol for symbol in symbols
        }
        try:
            for future in as_completed(future_to_symbol, timeout=US_OVERALL_TIMEOUT_SECONDS):
                symbol = future_to_symbol[future]
                try:
                    quote = future.result(timeout=US_SYMBOL_TIMEOUT_SECONDS)
                except Exception as exc:
                    logger.debug("[股票发现] 美股核心池行情失败 %s: %s", symbol, exc)
                    failed += 1
                    continue
                if quote is None:
                    failed += 1
                    continue
                rows.append(
                    {
                        "code": symbol,
                        "name": getattr(quote, "name", "") or symbol,
                        "price": getattr(quote, "price", None),
                        "change_pct": getattr(quote, "change_pct", None),
                        "amount": getattr(quote, "amount", None),
                        "volume": getattr(quote, "volume", None),
                        "_source": getattr(getattr(quote, "source", None), "value", None) or "yfinance",
                        "_updated_at": self._format_dt(updated_at),
                    }
                )
        except FuturesTimeout:
            failed += len(symbols) - len(rows)
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

        status: RankingStatus = "ok"
        if failed:
            status = "partial"
        if not rows and failed:
            status = "partial"

        return BatchQuoteResult(pd.DataFrame(rows), "yfinance", updated_at, status)

    @staticmethod
    def _call_with_timeout(func: Any, timeout_seconds: float, task_name: str) -> Any:
        return market_metrics.call_with_timeout(func, timeout_seconds, task_name)

    def _build_quote_lookup(self, df: pd.DataFrame, market: str) -> dict[str, pd.Series]:
        return market_metrics.build_quote_lookup(df, market)

    def _find_quote_row(
        self,
        entry: StockIndexEntry,
        quote_lookup: dict[str, pd.Series],
    ) -> pd.Series | None:
        for key in build_stock_index_lookup_keys(entry.canonical_code, entry.display_code):
            row = quote_lookup.get(key.upper())
            if row is not None:
                return row
        return None

    def _build_ranking_item(
        self,
        entry: StockIndexEntry,
        quote_row: pd.Series,
        market: str,
        source: str | None,
        updated_at: str | None,
    ) -> dict[str, Any]:
        return {
            "code": entry.canonical_code,
            "name": self._first_value(quote_row, ("名称", "股票名称", "name")) or entry.name_zh,
            "market": market,
            "industry": entry.industry,
            "price": safe_float(self._first_value(quote_row, ("最新价", "最新", "price", "last_price", "close"))),
            "change_pct": safe_float(self._first_value(quote_row, ("涨跌幅", "change_pct", "pct_chg", "changePercent"))),
            "amount": safe_float(self._first_value(quote_row, ("成交额", "amount", "turnover"))),
            "volume": safe_int(self._first_value(quote_row, ("成交量", "volume"))),
            "source": source,
            "updated_at": updated_at,
        }

    @staticmethod
    def _first_value(row: pd.Series, columns: Iterable[str]) -> Any:
        return market_metrics.first_value(row, columns)

    @staticmethod
    def _format_dt(value: datetime | str | None) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return value.isoformat()

    @staticmethod
    def _empty_payload(
        status: str,
        source: str | None = None,
        updated_at: datetime | str | None = None,
        message: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "status": status,
            "source": source,
            "updated_at": StockDiscoveryService._format_dt(updated_at),
            "items": [],
        }
        if message:
            payload["message"] = message
        return payload

    @staticmethod
    def _repo_root() -> Path:
        return Path(__file__).resolve().parents[2]
