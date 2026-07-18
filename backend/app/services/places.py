from __future__ import annotations

from typing import Any

import requests

from app.core.config import settings
from app.schemas import PlaceResult
from app.utils.geo import haversine_km


CATEGORY_MAP = {
    "internet_access": {
        "wlan": "wifi",
        "yes": "wifi",
        "terminal": "wifi",
        "service": "wifi"
    },
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


def reverse_geocode(lat: float, lon: float) -> str:
    params = {"lat": lat, "lon": lon, "format": "jsonv2"}
    headers = {"User-Agent": "ARES/1.0"}
    try:
        response = requests.get(
            settings.nominatim_url.replace("search", "reverse"),
            params=params, headers=headers, timeout=5
        )
        data = response.json()
        if data and "display_name" in data:
            # Extract city or town if possible, otherwise use full name
            addr = data.get("address", {})
            city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("suburb")
            if city:
                return f"{city}, {addr.get('country', '')}".strip(", ")
            return data["display_name"]
    except Exception:
        pass
    return f"{lat},{lon}"

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

    # CLOAKING MECHANISM: Removed as it causes timeout issues with large radii.
    
    query = f"""
    [out:json][timeout:25];
    (
      node(around:{radius_m},{lat},{lon});
      way(around:{radius_m},{lat},{lon});
      relation(around:{radius_m},{lat},{lon});
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
    
    # Priority sorting: always keep critical nodes, then fill the rest with closest nodes
    priority_categories = {"wifi", "surveillance", "hotel", "healthcare"}
    priority_nodes = [r for r in results if r.category in priority_categories]
    other_nodes = [r for r in results if r.category not in priority_categories]
    
    results = priority_nodes + other_nodes
    results = results[:80]
    
    # Save to cache
    cache_places(lat, lon, radius_m, [r.dict() for r in results])
    return results


from app.utils.geo import haversine_km

def summarize_places(places: list[PlaceResult]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for place in places:
        counts[place.category] = counts.get(place.category, 0) + 1
        
    wifi_nodes = [p for p in places if p.category == "wifi"]
    surveillance_nodes = [p for p in places if p.category == "surveillance"]
    
    threat_level = "SAFE"
    if wifi_nodes and surveillance_nodes:
        critical = False
        for w in wifi_nodes:
            for s in surveillance_nodes:
                if haversine_km(w.lat, w.lon, s.lat, s.lon) < 0.1: # within 100m
                    critical = True
                    break
        threat_level = "CRITICAL" if critical else "ELEVATED"
    elif wifi_nodes or surveillance_nodes:
        threat_level = "ELEVATED"
        
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
        
    return {
        "total_places": total, 
        "counts": counts, 
        "density_score": density_score, 
        "density_label": density_label,
        "threat_assessment": {
            "level": threat_level,
            "wifi_count": len(wifi_nodes),
            "camera_count": len(surveillance_nodes)
        }
    }
