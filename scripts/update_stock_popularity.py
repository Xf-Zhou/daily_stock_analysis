#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Refresh offline stock popularity scores for stocks.index.json."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data.stock_index_loader import StockIndexEntry, _parse_stock_index_item
from src.services.stock_market_metrics import (
    DEFAULT_MAX_STALE_DAYS,
    apply_popularity_to_index_data,
    build_popularity_cache,
    cache_key_for_stock,
    compute_popularity_scores,
    dataframe_to_popularity_metrics,
    fetch_cn_batch_quotes,
    fetch_eastmoney_lightweight_batch_quotes,
    fetch_hk_batch_quotes,
    fetch_yfinance_popularity_metrics,
    get_cache_scores,
    load_popularity_cache,
    write_index_json_atomic,
    write_popularity_cache_atomic,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INDEX_PATH = REPO_ROOT / "apps" / "dsa-web" / "public" / "stocks.index.json"
DEFAULT_CACHE_PATH = REPO_ROOT / "data" / "stock_popularity_cache.json"
DEFAULT_MARKETS = ("CN", "BSE", "HK", "US")
STRICT_THRESHOLDS = {
    "CN": 0.05,
    "BSE": 0.0,
    "HK": 0.05,
    "US_CORE": 0.50,
    "US_ALL": 0.05,
}


@dataclass
class MarketUpdate:
    market: str
    fresh_scores: dict[str, int]
    fresh_metrics: list[Any]
    failed: bool = False
    message: str | None = None


def _load_index_data(index_path: Path) -> list[Any]:
    with index_path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if not isinstance(payload, list):
        raise ValueError(f"stock index must be a JSON array: {index_path}")
    return payload


def _load_index_entries(index_data: Iterable[Any]) -> tuple[StockIndexEntry, ...]:
    entries: list[StockIndexEntry] = []
    for item in index_data:
        entry = _parse_stock_index_item(item)
        if entry is not None and entry.active and entry.asset_type == "stock":
            entries.append(entry)
    return tuple(entries)


def _parse_markets(raw: str) -> tuple[str, ...]:
    markets = tuple(
        market.strip().upper()
        for market in str(raw or "").split(",")
        if market.strip()
    )
    unsupported = sorted(set(markets) - set(DEFAULT_MARKETS))
    if unsupported:
        raise ValueError(f"unsupported market(s): {', '.join(unsupported)}")
    return markets or DEFAULT_MARKETS


def _entries_for_market(entries: Iterable[StockIndexEntry], market: str) -> tuple[StockIndexEntry, ...]:
    return tuple(entry for entry in entries if entry.market.upper() == market)


def _load_us_core_symbols(pool_path: Path) -> list[str]:
    if not pool_path.is_file():
        return []
    symbols: list[str] = []
    with pool_path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            symbol = str(row.get("symbol") or "").strip().upper()
            if symbol:
                symbols.append(symbol)
    return symbols[:100]


def _update_from_dataframe(
    market: str,
    entries: tuple[StockIndexEntry, ...],
    quote_result: Any,
) -> MarketUpdate:
    metrics = [
        metric
        for metric in dataframe_to_popularity_metrics(
            entries,
            quote_result.df,
            market,
            quote_result.source,
            quote_result.updated_at or datetime.now(timezone.utc),
        )
        if metric.has_effective_metric
    ]
    scores = compute_popularity_scores(metrics)
    return MarketUpdate(market=market, fresh_scores=scores, fresh_metrics=metrics)


def _fetch_market_update(
    market: str,
    entries_by_market: dict[str, tuple[StockIndexEntry, ...]],
    us_scope: str,
    repo_root: Path,
    shared_cn_result: dict[str, Any],
) -> MarketUpdate:
    try:
        if market in {"CN", "BSE"}:
            try:
                if "result" not in shared_cn_result:
                    shared_cn_result["result"] = fetch_cn_batch_quotes()
                return _update_from_dataframe(market, entries_by_market.get(market, ()), shared_cn_result["result"])
            except Exception as primary_exc:
                quote_result = fetch_eastmoney_lightweight_batch_quotes(market)
                update = _update_from_dataframe(market, entries_by_market.get(market, ()), quote_result)
                if not update.fresh_scores:
                    update.message = f"primary failed: {primary_exc}; lightweight source returned no effective metrics"
                return update

        if market == "HK":
            return _update_from_dataframe(market, entries_by_market.get("HK", ()), fetch_hk_batch_quotes())

        if market == "US":
            if us_scope == "core":
                symbols = _load_us_core_symbols(repo_root / "data" / "us_ranking_core_pool.csv")
            else:
                symbols = [entry.canonical_code.upper() for entry in entries_by_market.get("US", ())]
            if not symbols:
                return MarketUpdate(market="US", fresh_scores={}, fresh_metrics=[], failed=True, message="US symbol pool is empty")
            metrics = [metric for metric in fetch_yfinance_popularity_metrics(symbols) if metric.has_effective_metric]
            scores = compute_popularity_scores(metrics)
            return MarketUpdate(market="US", fresh_scores=scores, fresh_metrics=metrics)
    except Exception as exc:
        return MarketUpdate(market=market, fresh_scores={}, fresh_metrics=[], failed=True, message=str(exc))

    return MarketUpdate(market=market, fresh_scores={}, fresh_metrics=[], failed=True, message="unsupported market")


def _market_denominator(
    market: str,
    entries_by_market: dict[str, tuple[StockIndexEntry, ...]],
    us_scope: str,
    repo_root: Path,
) -> int:
    if market == "US" and us_scope == "core":
        return len(_load_us_core_symbols(repo_root / "data" / "us_ranking_core_pool.csv"))
    return len(entries_by_market.get(market, ()))


def _entry_market_keys(entries: Iterable[StockIndexEntry], market: str) -> set[str]:
    return {
        cache_key_for_stock(market, entry.canonical_code)
        for entry in entries
        if entry.market.upper() == market
    }


def _allowed_keys_for_market(
    market: str,
    entries_by_market: dict[str, tuple[StockIndexEntry, ...]],
    us_scope: str,
    repo_root: Path,
) -> set[str]:
    if market == "US" and us_scope == "core":
        return {
            cache_key_for_stock("US", symbol)
            for symbol in _load_us_core_symbols(repo_root / "data" / "us_ranking_core_pool.csv")
        }
    return _entry_market_keys(entries_by_market.get(market, ()), market)


def _allowed_keys_for_run(
    markets: tuple[str, ...],
    entries_by_market: dict[str, tuple[StockIndexEntry, ...]],
    us_scope: str,
    repo_root: Path,
) -> set[str]:
    allowed: set[str] = set()
    for market in markets:
        allowed.update(_allowed_keys_for_market(market, entries_by_market, us_scope, repo_root))
    return allowed


def _print_summary(
    markets: tuple[str, ...],
    entries_by_market: dict[str, tuple[StockIndexEntry, ...]],
    final_scores: dict[str, int],
    fresh_scores: dict[str, int],
    skipped_markets: set[str],
    us_scope: str,
    repo_root: Path,
) -> dict[str, dict[str, int]]:
    summary: dict[str, dict[str, int]] = {}
    for market in markets:
        denominator = _market_denominator(market, entries_by_market, us_scope, repo_root)
        if market == "US" and us_scope == "core":
            market_keys = {
                cache_key_for_stock("US", symbol)
                for symbol in _load_us_core_symbols(repo_root / "data" / "us_ranking_core_pool.csv")
            }
        else:
            market_keys = _entry_market_keys(entries_by_market.get(market, ()), market)
        fresh = sum(1 for key in market_keys if key in fresh_scores)
        reused = sum(1 for key in market_keys if key in final_scores and key not in fresh_scores)
        skipped = denominator if market in skipped_markets else 0
        missing = max(0, denominator - fresh - reused - skipped)
        summary[market] = {
            "total": denominator,
            "fresh": fresh,
            "reused": reused,
            "missing": missing,
            "skipped": skipped,
        }
        print(
            f"  {market}: total={denominator} fresh={fresh} reused={reused} "
            f"missing={missing} skipped={skipped}"
        )
    return summary


def _strict_threshold_for_market(market: str, us_scope: str) -> float:
    if market == "US":
        return STRICT_THRESHOLDS["US_CORE" if us_scope == "core" else "US_ALL"]
    return STRICT_THRESHOLDS.get(market, 0.0)


def _mark_reused_cache_entries(cache_payload: dict[str, Any], fresh_scores: dict[str, int]) -> None:
    entries = cache_payload.get("entries")
    if not isinstance(entries, dict):
        return
    for key, entry in entries.items():
        if isinstance(entry, dict) and key not in fresh_scores:
            entry["status"] = "reused"


def run(args: argparse.Namespace) -> int:
    index_path = Path(args.index_path)
    cache_path = Path(args.cache_path)
    markets = _parse_markets(args.markets)

    index_data = _load_index_data(index_path)
    entries = _load_index_entries(index_data)
    entries_by_market = {market: _entries_for_market(entries, market) for market in DEFAULT_MARKETS}

    cache_payload = {} if args.force_refresh else load_popularity_cache(cache_path)
    cache_scores = {} if args.force_refresh else get_cache_scores(cache_payload)

    print("Popularity refresh")
    print(f"  index: {index_path}")
    print(f"  cache: {cache_path}")
    print(f"  markets: {','.join(markets)}")
    print(f"  us_scope: {args.us_scope}")
    if args.force_refresh:
        print("  cache: ignored because --force-refresh is set")
    else:
        print(f"  cache: {len(cache_scores)} valid score(s), max_stale_days={DEFAULT_MAX_STALE_DAYS}")

    fresh_scores: dict[str, int] = {}
    fresh_metrics: list[Any] = []
    skipped_markets: set[str] = set()
    shared_cn_result: dict[str, Any] = {}

    for market in markets:
        update = _fetch_market_update(market, entries_by_market, args.us_scope, REPO_ROOT, shared_cn_result)
        market_allowed_keys = _allowed_keys_for_market(market, entries_by_market, args.us_scope, REPO_ROOT)
        valid_cache = any(key in cache_scores for key in market_allowed_keys)
        if update.failed or not update.fresh_scores:
            reason = update.message or "no fresh metrics"
            if market == "BSE" and not args.allow_zero_write:
                skipped_markets.add(market)
                print(f"  [warning] BSE has no fresh data; keeping existing index scores ({reason})")
                continue
            if valid_cache:
                print(f"  [info] {market} fresh data unavailable; reusing valid cache ({reason})")
                continue
            if args.allow_zero_write:
                print(f"  [warning] {market} has no data/cache; --allow-zero-write will write 0 for missing stocks ({reason})")
                continue
            skipped_markets.add(market)
            print(f"  [warning] {market} has no data/cache; keeping existing index scores ({reason})")
            continue

        fresh_scores.update(update.fresh_scores)
        fresh_metrics.extend(update.fresh_metrics)

    final_scores = dict(cache_scores)
    final_scores.update(fresh_scores)
    updated_index, write_stats = apply_popularity_to_index_data(
        index_data,
        final_scores,
        skipped_markets=skipped_markets,
        allowed_keys=_allowed_keys_for_run(markets, entries_by_market, args.us_scope, REPO_ROOT),
    )

    cache_payload = build_popularity_cache(
        fresh_metrics,
        final_scores,
        previous_cache={} if args.force_refresh else load_popularity_cache(cache_path),
    )
    _mark_reused_cache_entries(cache_payload, fresh_scores)

    print("\nCoverage summary:")
    summary = _print_summary(
        markets,
        entries_by_market,
        final_scores,
        fresh_scores,
        skipped_markets,
        args.us_scope,
        REPO_ROOT,
    )
    print(f"\nIndex write stats: {write_stats}")

    if args.strict_coverage:
        failed_markets: list[str] = []
        for market, stats in summary.items():
            total = stats["total"]
            coverage = 1.0 if total == 0 else (stats["fresh"] + stats["reused"]) / total
            threshold = _strict_threshold_for_market(market, args.us_scope)
            if coverage < threshold:
                failed_markets.append(f"{market} {coverage:.1%} < {threshold:.1%}")
        if failed_markets:
            print("[error] strict coverage failed: " + "; ".join(failed_markets))
            return 2

    if args.test:
        sample_scores = list(final_scores.items())[:5]
        print("\n[test] Skip writing files")
        print(f"[test] sample scores: {sample_scores}")
        return 0

    write_popularity_cache_atomic(cache_path, cache_payload)
    write_index_json_atomic(index_path, updated_index)
    print("\nDone.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Update offline stock popularity scores")
    parser.add_argument("--markets", default=",".join(DEFAULT_MARKETS), help="Comma-separated markets: CN,BSE,HK,US")
    parser.add_argument("--test", action="store_true", help="Print coverage and samples without writing files")
    parser.add_argument("--force-refresh", action="store_true", help="Ignore valid cache and refetch sources")
    parser.add_argument("--strict-coverage", action="store_true", help="Fail when market coverage is below configured thresholds")
    parser.add_argument("--allow-zero-write", action="store_true", help="Allow writing 0 for a whole market when no data/cache is available")
    parser.add_argument("--us-scope", choices=("core", "all"), default="core", help="US coverage scope, default: core")
    parser.add_argument("--index-path", default=str(DEFAULT_INDEX_PATH), help="Path to stocks.index.json")
    parser.add_argument("--cache-path", default=str(DEFAULT_CACHE_PATH), help="Path to stock_popularity_cache.json")
    return parser


def main() -> int:
    parser = build_parser()
    try:
        return run(parser.parse_args())
    except Exception as exc:
        print(f"[error] {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
