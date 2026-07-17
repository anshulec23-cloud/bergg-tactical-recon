import sqlite3
import json
import os
from pathlib import Path

CACHE_DB_PATH = os.getenv("POI_CACHE_DB_PATH", "./data/poi_cache.db")

def init_cache():
    Path(CACHE_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(CACHE_DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS poi_cache (
                lat REAL,
                lon REAL,
                radius_m INTEGER,
                data JSON,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (lat, lon, radius_m)
            )
        """)

def get_cached_places(lat: float, lon: float, radius_m: int):
    # Round coordinates slightly to allow fuzzy cache hits (e.g., 0.001 deg is ~111m)
    r_lat = round(lat, 3)
    r_lon = round(lon, 3)
    with sqlite3.connect(CACHE_DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT data FROM poi_cache WHERE lat = ? AND lon = ? AND radius_m = ?", (r_lat, r_lon, radius_m))
        row = cursor.fetchone()
        if row:
            return json.loads(row[0])
    return None

def cache_places(lat: float, lon: float, radius_m: int, data: list):
    r_lat = round(lat, 3)
    r_lon = round(lon, 3)
    with sqlite3.connect(CACHE_DB_PATH) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO poi_cache (lat, lon, radius_m, data) VALUES (?, ?, ?, ?)",
            (r_lat, r_lon, radius_m, json.dumps(data))
        )
