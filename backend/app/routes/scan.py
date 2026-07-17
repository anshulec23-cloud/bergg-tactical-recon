from __future__ import annotations

from collections import Counter
from typing import Any

from fastapi import APIRouter, HTTPException

from app.schemas import ScanRequest
from app.services.ai import generate_area_summary
from app.services.places import fetch_places, geocode_place, summarize_places
from app.services.traffic import estimate_area_traffic
from app.utils.geo import cluster_points

router = APIRouter(tags=["scan"])


def _resolve_location(payload: ScanRequest) -> tuple[float, float, str]:
    if payload.lat is not None and payload.lon is not None:
        return payload.lat, payload.lon, f"{payload.lat},{payload.lon}"
    if payload.place_name:
        return geocode_place(payload.place_name)
    raise HTTPException(status_code=400, detail="Provide lat/lon or place_name")


@router.get("/scan")
def scan_area(lat: float, lon: float, radius_m: int = 1200):
    payload = ScanRequest(lat=lat, lon=lon, radius_m=radius_m)
    return _scan(payload)


@router.post("/scan")
def scan_area_post(payload: ScanRequest):
    return _scan(payload)


def _scan(payload: ScanRequest) -> dict[str, Any]:
    lat, lon, label = _resolve_location(payload)
    places = fetch_places(lat, lon, payload.radius_m)
    summary = summarize_places(places)
    counts = Counter(place.category for place in places)
    density_points = [(place.lat, place.lon, max(1.0, 100 - place.distance_m / 20)) for place in places]
    clusters = cluster_points(density_points) if density_points else []
    ai_input = {
        "location": {"label": label, "lat": lat, "lon": lon, "radius_m": payload.radius_m},
        "total_places": summary["total_places"],
        "counts": dict(counts),
        "density_score": summary["density_score"],
        "density_label": summary["density_label"],
        "sample_places": [place.model_dump() for place in places[:12]],
    }
    ai_summary = generate_area_summary(ai_input)
    traffic = estimate_area_traffic([place.model_dump() for place in places], clusters)
    return {
        "location": {"label": label, "lat": lat, "lon": lon, "radius_m": payload.radius_m},
        "places": [place.model_dump() for place in places],
        "categorized_data": dict(counts),
        "density": summary,
        "heatmap": clusters,
        "traffic": traffic,
        "ai_summary": ai_summary,
    }
