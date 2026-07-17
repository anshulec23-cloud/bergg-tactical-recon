from __future__ import annotations

from typing import Any


MODE_TRAFFIC_FACTOR = {
    "driving": 1.0,
    "cycling": 0.55,
    "walking": 0.35,
}


def estimate_area_traffic(places: list[dict[str, Any]], heatmap: list[dict[str, Any]]) -> dict[str, Any]:
    hotspots: list[dict[str, Any]] = []
    for point in heatmap[:6]:
        intensity = round(min(100.0, float(point.get("strength", 0)) * float(point.get("sample_count", 1)) / 2.2), 1)
        severity = "high" if intensity >= 70 else "medium" if intensity >= 40 else "low"
        hotspots.append(
            {
                "lat": point["lat"],
                "lon": point["lon"],
                "intensity": intensity,
                "severity": severity,
                "reason": "high amenity density and transport overlap",
            }
        )

    congestion_index = round(min(100.0, len(places) * 1.15 + len(hotspots) * 4.0), 1)
    return {
        "congestion_index": congestion_index,
        "label": "heavy" if congestion_index >= 70 else "active" if congestion_index >= 40 else "light",
        "hotspots": hotspots,
    }


def estimate_route_traffic(mode: str, distance_m: float, duration_s: float, geometry: dict[str, Any] | None) -> dict[str, Any]:
    baseline_speed_kmh = {
        "driving": 34.0,
        "cycling": 14.0,
        "walking": 4.8,
    }.get(mode, 34.0)
    actual_speed_kmh = 0.0
    if duration_s > 0:
        actual_speed_kmh = (distance_m / 1000.0) / (duration_s / 3600.0)

    slowdown_ratio = max(0.0, 1.0 - (actual_speed_kmh / baseline_speed_kmh if baseline_speed_kmh else 1.0))
    traffic_score = round(min(100.0, slowdown_ratio * 100.0 * MODE_TRAFFIC_FACTOR.get(mode, 1.0) + 12.0), 1)
    label = "heavy" if traffic_score >= 70 else "moderate" if traffic_score >= 40 else "light"

    coordinates = (geometry or {}).get("coordinates") or []
    hotspots: list[dict[str, Any]] = []
    if coordinates:
        picks = [coordinates[len(coordinates) // 4], coordinates[len(coordinates) // 2], coordinates[(len(coordinates) * 3) // 4]]
        for index, coord in enumerate(picks):
            if not isinstance(coord, list) or len(coord) < 2:
                continue
            local_score = round(min(100.0, traffic_score + index * 6), 1)
            hotspots.append(
                {
                    "lat": coord[1],
                    "lon": coord[0],
                    "severity": "high" if local_score >= 70 else "medium" if local_score >= 40 else "low",
                    "delay_minutes": round((duration_s / 60.0) * (local_score / 180.0), 1),
                    "intensity": local_score,
                }
            )

    return {
        "traffic_score": traffic_score,
        "traffic_label": label,
        "hotspots": hotspots,
        "recommended_strategy": "prefer walking or cycling" if traffic_score >= 60 and mode == "driving" else "current mode is acceptable",
    }
