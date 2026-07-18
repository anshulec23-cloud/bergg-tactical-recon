from __future__ import annotations

from typing import Any

import requests

from app.core.config import settings


def _fallback_summary(data: dict[str, Any]) -> dict[str, Any]:
    counts = data.get("counts") or data.get("place_counts") or {}
    total = data.get("total_places", sum(counts.values()) if isinstance(counts, dict) else 0)
    transport = counts.get("transport", 0)
    restaurants = counts.get("restaurant", 0)
    services = counts.get("services", 0)
    healthcare = counts.get("healthcare", 0)
    commercial_signal = restaurants + services + transport

    if total >= 35 or commercial_signal >= 18:
        area_type = "commercial"
        activity_level = "high"
    elif healthcare + services + transport >= 8:
        area_type = "mixed-use"
        activity_level = "moderate"
    elif total <= 7:
        area_type = "residential"
        activity_level = "low"
    else:
        area_type = "mixed-use"
        activity_level = "moderate"

    if restaurants >= 10 or commercial_signal >= 16:
        cost_level = "high"
    elif restaurants >= 4:
        cost_level = "medium"
    else:
        cost_level = "low"

    transport_accessibility = "strong" if transport >= 4 else "moderate" if transport >= 1 else "limited"
    if area_type == "commercial":
        recommendation = "Use this area for services, short errands, or transit connections."
    elif area_type == "residential":
        recommendation = "Expect quieter streets and fewer immediate amenities."
    else:
        recommendation = "Good for mixed errands, with moderate foot traffic and service access."

    best_action = (
        "Navigate to the nearest transport hub"
        if transport_accessibility == "strong"
        else "Check for nearby services and continue scanning"
    )

    explanation = (
        f"Observed {total} places with {transport} transport nodes, {restaurants} food venues, and {services} service locations. "
        f"That pattern suggests a {area_type} area with {activity_level} activity and {cost_level} cost pressure."
    )
    return {
        "area_type": area_type,
        "cost_level": cost_level,
        "transport_accessibility": transport_accessibility,
        "activity_level": activity_level,
        "recommendation": recommendation,
        "best_action": best_action,
        "explanation": explanation,
        "structured": {
            "area_type": area_type,
            "cost_level": cost_level,
            "transport_accessibility": transport_accessibility,
            "activity_level": activity_level,
            "recommendation": recommendation,
            "best_action": best_action,
        },
    }


def generate_area_summary(data: dict[str, Any]) -> dict[str, Any]:
    return _fallback_summary(data)
