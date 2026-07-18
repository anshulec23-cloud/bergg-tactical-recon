from __future__ import annotations

from typing import Any

import requests

from app.core.config import settings
from app.schemas import PlaceResult
from app.utils.geo import haversine_km


CATEGORY_MAP = {
    "amenity": {
        "restaurant": "restaurant",
        "cafe": "restaurant",
        "fast_food": "restaurant",
        "bar": "restaurant",
        "pub": "restaurant",
        "bus_station": "transport",
        "fuel": "fuel",
        "bank": "services",
        "atm": "services",
        "pharmacy": "healthcare",
        "clinic": "healthcare",
        "hospital": "healthcare",
        "school": "education",
        "college": "education",
        "university": "education",
        "parking": "transport",
        "library": "civic",
        "marketplace": "retail",
    },
    "shop": {
        "convenience": "convenience",
    },
    "tourism": {
        "hotel": "hotel",
        "motel": "hotel",
        "hostel": "hotel",
        "guest_house": "hotel",
        "museum": "reserve",
        "gallery": "reserve",
        "attraction": "reserve",
        "theme_park": "reserve",
    },
    "historic": {
        "monument": "reserve",
        "castle": "reserve",
        "memorial": "reserve",
    },
    "boundary": {
        "national_park": "reserve",
    },
    "leisure": {
        "nature_reserve": "reserve",
        "park": "reserve",
        "garden": "reserve",
        "wildlife_park": "reserve",
    },
    "public_transport": {"station": "transport"},
    "office": {"*": "services"},
    "man_made": {
        "surveillance": "surveillance",
        "mast": "surveillance", # Cell towers
        "tower": "surveillance",
    },
    "highway": {
        "speed_camera": "surveillance"
    }
}


def geocode_place(place_name: str) -> tuple[float, float, str]:
    params = {"q": place_name, "format": "jsonv2", "limit": 1}
    headers = {"User-Agent": "ARES/1.0"}
    response = requests.get(settings.nominatim_url, params=params, headers=headers, timeout=settings.request_timeout)
    response.raise_for_status()
    data = response.json()
    if not data:
        raise ValueError(f"No geocoding result for {place_name}")
    item = data[0]
    return float(item["lat"]), float(item["lon"]), item.get("display_name", place_name)


def _category_from_tags(tags: dict[str, Any]) -> tuple[str, str | None]:
    for key, mapping in CATEGORY_MAP.items():
        value = tags.get(key)
        if value is None:
            continue
        mapped = mapping.get(value) or mapping.get("*")
        if mapped:
            return mapped, value
        # Fallbacks for generic tags not explicitly mapped in dictionaries
        if key == "shop":
            return "retail", value
        if key in {"tourism", "leisure", "historic", "boundary"}:
            return "reserve", value
            
    if tags.get("highway") in {"bus_stop", "platform"}:
        return "transport", tags.get("highway")
    if tags.get("building") in {"commercial", "retail"}:
        return "commercial", tags.get("building")
    return "other", None


def _price_level_from_tags(tags: dict[str, Any]) -> str | None:
    if tags.get("level"):
        return str(tags["level"])
    if tags.get("shop") in {"convenience", "supermarket"}:
        return "$"
    if tags.get("amenity") in {"restaurant", "bar", "cafe", "pub"}:
        return "$$"
    if tags.get("tourism") in {"hotel", "hostel"}:
        return "$$$"
    return None


from app.services.poi_cache import get_cached_places, cache_places

def fetch_places(lat: float, lon: float, radius_m: int) -> list[PlaceResult]:
    # Check cache first
    cached = get_cached_places(lat, lon, radius_m)
    if cached is not None:
        return [PlaceResult(**item) for item in cached]

    # CLOAKING MECHANISM: We ask the server for everything in a 20km radius 
    # (or up to 20,000m) rather than the precise requested radius (e.g. 500m), 
    # so the API provider doesn't know exactly where we are within that 20km zone.
    cloak_radius_m = max(radius_m, 20000)

    query = f"""
    [out:json][timeout:25];
    (
      node(around:{cloak_radius_m},{lat},{lon});
      way(around:{cloak_radius_m},{lat},{lon});
      relation(around:{cloak_radius_m},{lat},{lon});
    );
    out center tags;
    """
    try:
        response = requests.post(settings.overpass_url, data=query, timeout=settings.request_timeout)
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        # If offline or failed, return empty list (or could return stale cache if we changed cache logic)
        return []

    elements = data.get("elements", [])
    results: list[PlaceResult] = []

    for element in elements:
        tags = element.get("tags", {})
        if not tags:
            continue
        name = tags.get("name")
        if not name:
            continue
        place_category, subcategory = _category_from_tags(tags)
        if place_category == "other":
            continue
        el_lat = element.get("lat") or element.get("center", {}).get("lat")
        el_lon = element.get("lon") or element.get("center", {}).get("lon")
        if el_lat is None or el_lon is None:
            continue
        distance_m = haversine_km(lat, lon, float(el_lat), float(el_lon)) * 1000
        if distance_m > radius_m * 1.05:
            continue
        address_parts = [tags.get("addr:housenumber"), tags.get("addr:street"), tags.get("addr:city")]
        address = ", ".join([part for part in address_parts if part]) or None
        results.append(
            PlaceResult(
                id=f"osm:{element.get('type')}:{element.get('id')}",
                name=name,
                category=place_category,
                subcategory=subcategory,
                rating=None,
                price_level=_price_level_from_tags(tags),
                distance_m=round(distance_m, 1),
                lat=float(el_lat),
                lon=float(el_lon),
                address=address,
                action_url=f"https://www.openstreetmap.org/{element.get('type')}/{element.get('id')}",
            )
        )

    results.sort(key=lambda item: item.distance_m)
    results = results[:80]
    
    # Save to cache
    cache_places(lat, lon, radius_m, [r.dict() for r in results])
    return results


def summarize_places(places: list[PlaceResult]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for place in places:
        counts[place.category] = counts.get(place.category, 0) + 1
    total = len(places)
    density_score = min(100, int((total / 40) * 100))
    if total >= 40:
        density_label = "very dense"
    elif total >= 20:
        density_label = "dense"
    elif total >= 8:
        density_label = "moderate"
    else:
        density_label = "sparse"
    return {"total_places": total, "counts": counts, "density_score": density_score, "density_label": density_label}
