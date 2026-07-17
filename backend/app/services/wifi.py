from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any

from app.core.config import settings
from app.schemas import WiFiHeatmapPoint, WiFiScanRecord


_wifi_lock = Lock()
_db_initialized = False


def _db_path() -> Path:
    path = Path(settings.wifi_db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def _connect():
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _normalize_timestamp(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, (int, float)):
        numeric = float(value)
        return datetime.utcfromtimestamp(numeric / 1000.0 if numeric > 10_000_000_000 else numeric)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            try:
                return _normalize_timestamp(float(value))
            except ValueError:
                return datetime.utcnow()
    return datetime.utcnow()


def init_wifi_store() -> None:
    global _db_initialized
    if _db_initialized:
        return
    with _wifi_lock, _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS wifi_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ssid TEXT NOT NULL,
                rssi INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                lat REAL NOT NULL,
                lon REAL NOT NULL,
                bssid TEXT,
                channel INTEGER,
                payload TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_wifi_records_timestamp ON wifi_records(timestamp)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_wifi_records_location ON wifi_records(lat, lon)")
    _db_initialized = True


def _serialize(record: WiFiScanRecord) -> tuple[str, int, str, float, float, str | None, int | None, str]:
    ts = _normalize_timestamp(record.timestamp)
    record.timestamp = ts
    payload = record.model_dump(mode="json")
    return (
        record.ssid,
        record.rssi,
        ts.isoformat(),
        record.lat,
        record.lon,
        record.bssid,
        record.channel,
        json.dumps(payload, separators=(",", ":")),
    )


def add_wifi_record(record: WiFiScanRecord) -> dict[str, Any]:
    init_wifi_store()
    ssid, rssi, timestamp, lat, lon, bssid, channel, payload = _serialize(record)
    with _wifi_lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO wifi_records (ssid, rssi, timestamp, lat, lon, bssid, channel, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (ssid, rssi, timestamp, lat, lon, bssid, channel, payload),
        )
        total_records = conn.execute("SELECT COUNT(*) AS count FROM wifi_records").fetchone()["count"]
    return {"stored": True, "total_records": total_records}


def _fetch_records(hours: int) -> list[dict[str, Any]]:
    init_wifi_store()
    cutoff = (datetime.utcnow() - timedelta(hours=hours)).isoformat()
    with _wifi_lock, _connect() as conn:
        rows = conn.execute(
            """
            SELECT ssid, rssi, timestamp, lat, lon, bssid, channel, payload
            FROM wifi_records
            WHERE timestamp >= ?
            ORDER BY timestamp DESC
            """,
            (cutoff,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_wifi_heatmap(hours: int = 24) -> list[WiFiHeatmapPoint]:
    rows = _fetch_records(hours)
    buckets: dict[tuple[float, float], list[dict[str, Any]]] = {}
    for row in rows:
        key = (round(float(row["lat"]), 3), round(float(row["lon"]), 3))
        buckets.setdefault(key, []).append(row)

    points: list[WiFiHeatmapPoint] = []
    for (lat, lon), entries in buckets.items():
        strengths = [max(0, 100 + int(entry["rssi"])) for entry in entries]
        avg_strength = sum(strengths) / len(strengths) if strengths else 0
        points.append(
            WiFiHeatmapPoint(
                lat=lat,
                lon=lon,
                strength=round(avg_strength, 2),
                sample_count=len(entries),
                ssids=sorted({str(entry["ssid"]) for entry in entries}),
            )
        )
    points.sort(key=lambda item: item.sample_count, reverse=True)
    return points


def wifi_stats() -> dict[str, Any]:
    rows = _fetch_records(24 * 365)
    latest_timestamp = _normalize_timestamp(rows[0]["timestamp"]).isoformat() if rows else None
    return {
        "total_records": len(rows),
        "unique_ssids": len({str(row["ssid"]) for row in rows}),
        "latest_timestamp": latest_timestamp,
    }
