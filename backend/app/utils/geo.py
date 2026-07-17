from __future__ import annotations

from math import asin, cos, radians, sin, sqrt
from typing import Iterable


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(a))


def cluster_points(points: Iterable[tuple[float, float, float]], precision: int = 3):
    buckets: dict[tuple[float, float], list[float]] = {}
    for lat, lon, strength in points:
        key = (round(lat, precision), round(lon, precision))
        buckets.setdefault(key, []).append(strength)
    return [
        {
            "lat": lat,
            "lon": lon,
            "strength": sum(values) / len(values),
            "sample_count": len(values),
        }
        for (lat, lon), values in buckets.items()
    ]


def bounds_center(bounds: list[float]) -> tuple[float, float]:
    west, south, east, north = bounds
    return (south + north) / 2, (west + east) / 2
