from __future__ import annotations

from typing import Any

import requests

from app.core.config import settings
from app.services.places import geocode_place
from app.services.traffic import estimate_route_traffic
from app.utils.geo import haversine_km


MODE_PROFILE = {"driving": "driving", "walking": "walking", "cycling": "cycling"}
SPEED_KMH = {"driving": 34.0, "walking": 4.8, "cycling": 14.0}


def _parse_point(value: str) -> tuple[float, float, str]:
    if "," in value:
        lat_str, lon_str = value.split(",", 1)
        return float(lat_str.strip()), float(lon_str.strip()), value
    lat, lon, label = geocode_place(value)
    return lat, lon, label


def get_route(source: str, destination: str, mode: str) -> dict[str, Any]:
    src_lat, src_lon, src_label = _parse_point(source)
    dst_lat, dst_lon, dst_label = _parse_point(destination)
    profile = MODE_PROFILE.get(mode, "driving")
def decode_polyline6(encoded: str) -> list[list[float]]:
    coords = []
    index = 0
    length = len(encoded)
    lat = 0
    lng = 0
    factor = 1e6

    while index < length:
        # Latitude
        shift = 0
        result = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if not (b & 0x20):
                break
        dlat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += dlat

        # Longitude
        shift = 0
        result = 0
        while True:
            if index >= length:
                break
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if not (b & 0x20):
                break
        dlng = ~(result >> 1) if (result & 1) else (result >> 1)
        lng += dlng

        # GeoJSON is [longitude, latitude]
        coords.append([lng / factor, lat / factor])
    return coords


def _fetch_valhalla_path(url: str, payload: dict, profile: str) -> dict[str, Any] | None:
    try:
        response = requests.post(url, json=payload, timeout=settings.request_timeout)
        if response.status_code != 200:
            print(f"Valhalla error {response.status_code}: {response.text}")
        response.raise_for_status()
        data = response.json()
        trip = data.get("trip", {})
        legs = trip.get("legs", [])
        if legs:
            best_leg = legs[0]
            shape_str = best_leg.get("shape", "")
            coords = decode_polyline6(shape_str) if shape_str else []
            
            steps = []
            for man in best_leg.get("maneuvers", []):
                steps.append({
                    "instruction": man.get("instruction", ""),
                    "distance_m": man.get("length", 0) * 1000,
                    "duration_s": man.get("time", 0)
                })

            distance_m = trip["summary"]["length"] * 1000
            duration_s = trip["summary"]["time"]

            return {
                "distance_m": distance_m,
                "duration_s": duration_s,
                "geometry": {
                    "type": "LineString",
                    "coordinates": coords
                },
                "steps": steps,
                "summary": trip["summary"].get("status", "Route active"),
                "profile": profile
            }
    except Exception as e:
        print(f"Valhalla sub-route request error: {e}")
    return None


def _fetch_osrm_path(src_lat: float, src_lon: float, dst_lat: float, dst_lon: float, mode: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    profile = "driving"
    if mode == "walking":
        profile = "walking"
    elif mode == "cycling":
        profile = "cycling"
        
    url = f"http://router.project-osrm.org/route/v1/{profile}/{src_lon},{src_lat};{dst_lon},{dst_lat}?overview=full&geometries=geojson&steps=true&alternatives=true"
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            routes = data.get("routes", [])
            if not routes:
                return None, None
                
            def parse_osrm_route(r):
                legs = r.get("legs", [])
                steps = []
                if legs:
                    for step in legs[0].get("steps", []):
                        man = step.get('maneuver', {})
                        name = step.get('name', '')
                        street = f" onto {name}" if name else ""
                        instruction = f"{man.get('type', 'proceed')} {man.get('modifier', '')}{street}".strip().upper()
                        steps.append({
                            "instruction": instruction,
                            "distance_m": step.get("distance", 0),
                            "duration_s": step.get("duration", 0)
                        })
                return {
                    "distance_m": r.get("distance", 0),
                    "duration_s": r.get("duration", 0),
                    "geometry": r.get("geometry", {}),
                    "steps": steps,
                    "summary": r.get("legs", [{}])[0].get("summary", "Online route"),
                    "profile": mode
                }
            
            main = parse_osrm_route(routes[0])
            shortest = parse_osrm_route(routes[1]) if len(routes) > 1 else main
            return main, shortest
    except Exception as e:
        print(f"OSRM fallback routing error: {e}")
    return None, None


def get_route(source: str, destination: str, mode: str) -> dict[str, Any]:
    src_lat, src_lon, src_label = _parse_point(source)
    dst_lat, dst_lon, dst_label = _parse_point(destination)
    profile = MODE_PROFILE.get(mode, "driving")
    
    valhalla_profile = "auto"
    if mode == "walking":
        valhalla_profile = "pedestrian"
    elif mode == "cycling":
        valhalla_profile = "bicycle"

    url = f"{settings.valhalla_url}/route"
    
    # 1. Main Road Route Payload (favors fast major roads)
    payload_main = {
        "locations": [
            {"lat": src_lat, "lon": src_lon},
            {"lat": dst_lat, "lon": dst_lon}
        ],
        "costing": valhalla_profile,
        "directions_options": {"units": "kilometers"}
    }

    # 2. Shortest Route Payload (minimizes absolute distance)
    costing_opts = {}
    if valhalla_profile == "auto":
        costing_opts = {"auto": {"use_distance": 1.0}}
    elif valhalla_profile == "bicycle":
        costing_opts = {"bicycle": {"use_roads": 1.0}}
    elif valhalla_profile == "pedestrian":
        costing_opts = {"pedestrian": {"use_roads": 1.0}}

    payload_shortest = {
        "locations": [
            {"lat": src_lat, "lon": src_lon},
            {"lat": dst_lat, "lon": dst_lon}
        ],
        "costing": valhalla_profile,
        "costing_options": costing_opts,
        "directions_options": {"units": "kilometers"}
    }

    main_route = _fetch_valhalla_path(url, payload_main, profile)
    shortest_route = _fetch_valhalla_path(url, payload_shortest, profile)

    # Fallback to OSRM global online API if offline Valhalla fails
    if not main_route and not shortest_route:
        print("[SYS] Valhalla routing failed/out-of-bounds. Activating global online OSRM fallback...")
        main_route, shortest_route = _fetch_osrm_path(src_lat, src_lon, dst_lat, dst_lon, mode)

    # Fallback to straight line if OSRM also fails
    if not main_route and not shortest_route:
        distance_km = haversine_km(src_lat, src_lon, dst_lat, dst_lon)
        duration_h = distance_km / SPEED_KMH[mode]
        fallback_geom = {
            "type": "LineString",
            "coordinates": [[src_lon, src_lat], [dst_lon, dst_lat]]
        }
        fallback_route = {
            "distance_m": round(distance_km * 1000, 1),
            "duration_s": round(duration_h * 3600, 1),
            "geometry": fallback_geom,
            "steps": [{"instruction": "Head straight toward destination", "distance_m": distance_km * 1000, "duration_s": duration_h * 3600}],
            "summary": "Straight fallback path",
            "profile": profile
        }
        main_route = fallback_route
        shortest_route = fallback_route

    # If only one succeeded, duplicate for completeness
    if not main_route and shortest_route:
        main_route = shortest_route
    elif not shortest_route and main_route:
        shortest_route = main_route

    # Extract threats (WiFi & CCTV) along the route
    route_places = []
    if main_route and "geometry" in main_route and "coordinates" in main_route["geometry"]:
        coords = main_route["geometry"]["coordinates"]
        if coords:
            from app.services.wifi import get_wifi_heatmap
            local_wifi = get_wifi_heatmap(hours=24*365)
            
            # Subsample coordinates to avoid massive loops (e.g. max 50 points)
            step = max(1, len(coords) // 50)
            sampled_coords = coords[::step]
            
            added_wifi = set()
            for w in local_wifi:
                for lon, lat in sampled_coords:
                    if abs(w.lat - lat) < 0.005 and abs(w.lon - lon) < 0.005:
                        if haversine_km(lat, lon, w.lat, w.lon) * 1000 <= 150:
                            wid = f"{w.lat}-{w.lon}"
                            if wid not in added_wifi:
                                route_places.append({
                                    "id": f"wifi-rt-{wid}",
                                    "name": ",".join(w.ssids) if w.ssids else "Unknown Wi-Fi",
                                    "category": "wifi",
                                    "subcategory": "local_db",
                                    "distance_m": 0,
                                    "lat": w.lat,
                                    "lon": w.lon,
                                    "action_url": ""
                                })
                                added_wifi.add(wid)
                            break
            
            # Inject mock CCTV cameras along the route
            cctv_step = max(1, len(coords) // 5)
            cctv_coords = coords[::cctv_step]
            for i, (lon, lat) in enumerate(cctv_coords[:5]):
                route_places.append({
                    "id": f"cctv-rt-{i}",
                    "name": f"Route CCTV-{i+1}",
                    "category": "surveillance",
                    "subcategory": "camera",
                    "distance_m": 0,
                    "lat": lat + 0.0001,
                    "lon": lon + 0.0001,
                    "action_url": ""
                })
                
            # Fetch normal OSM amenities at the route midpoint
            try:
                from app.services.places import fetch_places
                mid_idx = len(coords) // 2
                mid_lon, mid_lat = coords[mid_idx]
                dist_m = main_route.get("distance_m", 3000)
                radius = min(5000, max(1500, int(dist_m / 2)))
                osm_places = fetch_places(mid_lat, mid_lon, radius)
                for p in osm_places:
                    p_dict = p.dict()
                    p_dict["distance_m"] = 0 # It's along the route
                    route_places.append(p_dict)
            except Exception as e:
                print(f"Failed to fetch route OSM places: {e}")

    return {
        "source": {"label": src_label, "lat": src_lat, "lon": src_lon},
        "destination": {"label": dst_label, "lat": dst_lat, "lon": dst_lon},
        "main_route": main_route,
        "shortest_route": shortest_route,
        "places": route_places,
        "traffic": estimate_route_traffic(profile, main_route["distance_m"], main_route["duration_s"], main_route["geometry"]),
    }
