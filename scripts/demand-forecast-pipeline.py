#!/usr/bin/env python3
"""
여소남 OS — 취소/수요 예측 배치 파이프라인 (Phase 2-2)

동작:
  1. Supabase에서 booking 데이터 로드 (최근 90일)
  2. 목적지/패키지별 수요 추세 계산 (단순 이동 평균)
  3. demand_forecasts 테이블에 저장 (저 + 중앙 + 고 추정치)
  4. cancellation_predictions 테이블에 취소 확률 저장
  5. (향후) Isolation Forest / Prophet 적용

실행:
  pip install -r scripts/requirements.txt
  python scripts/demand-forecast-pipeline.py

crontab (매일 오전 3시 KST):
  CRON_TZ=Asia/Seoul
  0 3 * * * cd /app && python scripts/demand-forecast-pipeline.py >> /var/log/demand-forecast.log 2>&1
"""

import os
import sys
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

try:
    from supabase import create_client, Client
except ImportError:
    print("ERROR: supabase 모듈이 필요합니다. pip install supabase")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ─── Supabase 연결 ────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    log.error("NEXT_PUBLIC_SUPABASE_URL 와 SUPABASE_SERVICE_ROLE_KEY 환경 변수가 필요합니다.")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ─── 데이터 로드 ──────────────────────────────────────────────────────────

MODEL_VERSION = "v1-sma-20260529"

def load_bookings(since_days: int = 90) -> list[dict[str, Any]]:
    """최근 N일간의 booking 데이터를 로드한다."""
    since = (datetime.now(timezone.utc) - timedelta(days=since_days)).isoformat()
    log.info(f"booking 데이터 로드 (since={since})")

    # booking 테이블은 실제 스키마에 맞게 조정 필요
    resp = supabase.table("bookings") \
        .select("id, created_at, status, package_id, total_price, destination, tenant_id") \
        .gte("created_at", since) \
        .execute()

    rows = resp.data
    log.info(f"로드 완료: {len(rows)} 건")
    return rows


def load_packages() -> dict[str, dict[str, Any]]:
    """travel_packages 데이터를 로드한다 (destination 매핑용)."""
    resp = supabase.table("travel_packages") \
        .select("id, title, destination") \
        .execute()

    pkg_map: dict[str, dict[str, Any]] = {}
    for pkg in resp.data or []:
        pkg_map[pkg["id"]] = pkg
    return pkg_map


# ─── 수요 예측 (단순 이동 평균) ───────────────────────────────────────────

def compute_demand_forecast(
    bookings: list[dict[str, Any]],
    target_type: str,
    target_id: str,
) -> dict[str, Any] | None:
    """
    target_type/target_id 기준으로 수요 예측을 계산한다.
    - 지난 7일 평균 → predicted_demand_mid
    - lo/hi 는 ±30% 범위
    - confidence = 데이터 포인트 수 / 30 (최대 0.95)
    """
    recent = [
        b for b in bookings
        if b.get("status") not in ("cancelled", "refunded")
    ]

    daily_counts: dict[str, int] = {}
    for b in recent:
        day = b.get("created_at", "")[:10]
        if day:
            daily_counts[day] = daily_counts.get(day, 0) + 1

    if not daily_counts:
        return None

    values = list(daily_counts.values())
    avg = sum(values) / len(values)
    n = len(daily_counts)
    confidence = min(0.95, n / 30)

    return {
        "target_type": target_type,
        "target_id": target_id,
        "forecast_date": datetime.now(timezone.utc).date().isoformat(),
        "predicted_demand_lo": round(avg * 0.7, 1),
        "predicted_demand_mid": round(avg, 1),
        "predicted_demand_hi": round(avg * 1.3, 1),
        "confidence": round(confidence, 2),
        "model_version": MODEL_VERSION,
        "metadata": {"data_points": n, "daily_counts": daily_counts},
    }


def compute_all_forecasts(
    bookings: list[dict[str, Any]],
    pkg_map: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """전체 목적지/패키지에 대한 예측을 계산한다."""
    forecasts: list[dict[str, Any]] = []

    # 1. 목적지별 수요 예측
    destinations = set()
    for b in bookings:
        dest = b.get("destination") or pkg_map.get(b.get("package_id", ""), {}).get("destination")
        if dest:
            destinations.add(dest)

    for dest in destinations:
        dest_bookings = [b for b in bookings if
            b.get("destination") == dest or
            pkg_map.get(b.get("package_id", ""), {}).get("destination") == dest]

        fc = compute_demand_forecast(dest_bookings, "destination", dest)
        if fc:
            forecasts.append(fc)

    # 2. 패키지별 수요 예측
    package_ids = set()
    for b in bookings:
        pid = b.get("package_id")
        if pid:
            package_ids.add(pid)

    for pid in package_ids:
        pkg_bookings = [b for b in bookings if b.get("package_id") == pid]
        fc = compute_demand_forecast(pkg_bookings, "package", pid)
        if fc:
            fc["metadata"]["package_title"] = pkg_map.get(pid, {}).get("title")
            forecasts.append(fc)

    return forecasts


def compute_cancellation_predictions(
    bookings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """취소율 예측 — 단순 통계 기반 (Phase 2-2 1차).
    향후: Isolation Forest 또는 Prophet 모델로 대체.
    """
    predictions: list[dict[str, Any]] = []

    total = len(bookings)
    cancelled = [b for b in bookings if b.get("status") == "cancelled"]
    cancel_rate = len(cancelled) / total if total > 0 else 0

    for b in bookings:
        bid = b.get("id")
        status = b.get("status")
        if not bid:
            continue

        if status == "cancelled":
            prob = 1.0
            risk = "high" if b.get("total_price", 0) > 1000000 else "medium"
        elif status in ("pending", "deposit_paid"):
            # 입금 전 예약은 취소 확률 높음
            prob = min(0.4, cancel_rate * 1.5)
            risk = "medium" if prob > 0.3 else "low"
        else:
            prob = cancel_rate * 0.5
            risk = "low"

        predictions.append({
            "booking_id": bid,
            "cancellation_probability": round(prob, 2),
            "risk_level": risk,
            "top_reason": _top_reason(b, cancel_rate),
            "model_version": MODEL_VERSION,
            "feature_snapshot": {
                "status": status,
                "price": b.get("total_price"),
                "days_since_created": (datetime.now(timezone.utc) - datetime.fromisoformat(b["created_at"].replace("Z", "+00:00"))).days if b.get("created_at") else None,
            },
        })

    return predictions


def _top_reason(booking: dict[str, Any], cancel_rate: float) -> str:
    """취소 이유 추정 (rule-based)."""
    status = booking.get("status", "")
    if status == "cancelled":
        if cancel_rate > 0.3:
            return "high_cancel_rate_segment"
        return "customer_request"
    if status in ("pending", "deposit_paid"):
        return "pending_payment"
    return "normal"


# ─── 저장 ─────────────────────────────────────────────────────────────────

def save_forecasts(forecasts: list[dict[str, Any]]) -> int:
    """demand_forecasts 테이블에 저장."""
    if not forecasts:
        log.info("저장할 예측 데이터 없음")
        return 0

    resp = supabase.table("demand_forecasts").upsert(forecasts, on_conflict="target_type,target_id,forecast_date").execute()
    count = len(resp.data) if resp.data else 0
    log.info(f"demand_forecasts 저장 완료: {count} 건")
    return count


def save_predictions(predictions: list[dict[str, Any]]) -> int:
    """cancellation_predictions 테이블에 저장."""
    if not predictions:
        log.info("저장할 취소 예측 데이터 없음")
        return 0

    # 청크 단위 저장 (한 번에 100개)
    chunk_size = 100
    total = 0
    for i in range(0, len(predictions), chunk_size):
        chunk = predictions[i:i + chunk_size]
        resp = supabase.table("cancellation_predictions").upsert(chunk, on_conflict="booking_id").execute()
        total += len(resp.data) if resp.data else 0

    log.info(f"cancellation_predictions 저장 완료: {total} 건")
    return total


# ─── 메인 ──────────────────────────────────────────────────────────────────

def main():
    log.info("=== 수요 예측 배치 파이프라인 시작 ===")

    bookings = load_bookings(since_days=90)
    pkg_map = load_packages()

    forecasts = compute_all_forecasts(bookings, pkg_map)
    save_forecasts(forecasts)

    predictions = compute_cancellation_predictions(bookings)
    save_predictions(predictions)

    log.info("=== 수요 예측 배치 파이프라인 완료 ===")
    log.info(f"  forecasts: {len(forecasts)} 건")
    log.info(f"  predictions: {len(predictions)} 건")

    # 간단한 요약 출력 (stdout → 로그)
    if forecasts:
        top = max(forecasts, key=lambda f: f["predicted_demand_mid"])
        log.info(f"  최고 수요: {top['target_type']}={top['target_id']}, "
                 f"예측={top['predicted_demand_mid']}/일 (conf={top['confidence']})")

    cancel_high = [p for p in predictions if p["risk_level"] == "high"]
    log.info(f"  취소 위험 HIGH: {len(cancel_high)} 건")


if __name__ == "__main__":
    main()
