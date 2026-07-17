import React, { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

function featureCollection(items, mapper) {
  return {
    type: "FeatureCollection",
    features: items.map(mapper),
  };
}

function nearestPlace(lngLat, places) {
  let best = null;
  let bestDistance = Infinity;
  for (const place of places) {
    const dx = lngLat.lng - place.lon;
    const dy = lngLat.lat - place.lat;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = place;
    }
  }
  return bestDistance < 0.00005 ? best : null;
}

export default function MapPanel({
  location,
  places,
  heatmap,
  trafficHotspots,
  routeResult,
  routeHotspots,
  routeSelectionMode,
  selectedPlace,
  onSelectPlace,
  onViewportChange,
  onPickRoutePoint,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const userMovedRef = useRef(false);

  const placeFeatures = useMemo(() => featureCollection(places, (place) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [place.lon, place.lat] },
    properties: { id: place.id, name: place.name, category: place.category, distance_m: place.distance_m },
  })), [places]);

  const heatmapFeatures = useMemo(() => featureCollection(heatmap, (point) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    properties: { strength: point.strength ?? 1, sample_count: point.sample_count ?? 1 },
  })), [heatmap]);

  const trafficFeatures = useMemo(() => featureCollection(trafficHotspots || [], (point) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    properties: { severity: point.severity, intensity: point.intensity ?? 0 },
  })), [trafficHotspots]);

  // Dual path GeoJSON bindings
  const routeMainFeature = useMemo(() => ({
    type: "FeatureCollection",
    features: routeResult?.main_route?.geometry ? [{ type: "Feature", geometry: routeResult.main_route.geometry, properties: {} }] : [],
  }), [routeResult]);

  const routeShortestFeature = useMemo(() => ({
    type: "FeatureCollection",
    features: routeResult?.shortest_route?.geometry ? [{ type: "Feature", geometry: routeResult.shortest_route.geometry, properties: {} }] : [],
  }), [routeResult]);

  const routeHotspotFeatures = useMemo(() => featureCollection(routeHotspots || [], (point) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    properties: { intensity: point.intensity ?? 0, severity: point.severity },
  })), [routeHotspots]);

  const routeSelectionModeRef = useRef(routeSelectionMode);
  const placesRef = useRef(places);
  const onSelectPlaceRef = useRef(onSelectPlace);
  const onPickRoutePointRef = useRef(onPickRoutePoint);

  useEffect(() => {
    routeSelectionModeRef.current = routeSelectionMode;
  }, [routeSelectionMode]);

  useEffect(() => {
    placesRef.current = places;
  }, [places]);

  useEffect(() => {
    onSelectPlaceRef.current = onSelectPlace;
  }, [onSelectPlace]);

  useEffect(() => {
    onPickRoutePointRef.current = onPickRoutePoint;
  }, [onPickRoutePoint]);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [location.lon, location.lat],
      zoom: 14,
      antialias: true,
      projection: { type: 'globe' },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("places", { type: "geojson", data: placeFeatures });
      map.addSource("density", { type: "geojson", data: heatmapFeatures });
      map.addSource("traffic", { type: "geojson", data: trafficFeatures });
      map.addSource("route-main", { type: "geojson", data: routeMainFeature });
      map.addSource("route-shortest", { type: "geojson", data: routeShortestFeature });
      map.addSource("route-hotspots", { type: "geojson", data: routeHotspotFeatures });

      map.addLayer({
        id: "density-layer",
        type: "heatmap",
        source: "density",
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "strength"], 0, 0.1, 100, 1],
          "heatmap-radius": 24,
          "heatmap-opacity": 0.55,
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.3, "rgba(101,255,109,0.25)", 0.7, "rgba(255,180,0,0.45)", 1, "rgba(255,90,0,0.8)"],
        },
      });

      // Red line for standard/main roads
      map.addLayer({
        id: "route-main-line",
        type: "line",
        source: "route-main",
        paint: { 
          "line-color": "#ff0055", 
          "line-width": 6, 
          "line-opacity": 0.85 
        },
      });

      // Blue line for shortest distance path (Google Maps style)
      map.addLayer({
        id: "route-shortest-line",
        type: "line",
        source: "route-shortest",
        paint: { 
          "line-color": "#00bcff", 
          "line-width": 4, 
          "line-opacity": 0.9,
          "line-dasharray": [2, 1] 
        },
      });

      map.addLayer({
        id: "traffic-layer",
        type: "circle",
        source: "traffic",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "intensity"], 0, 5, 100, 11],
          "circle-color": ["match", ["get", "severity"], "high", "#ff6b00", "medium", "#f2aa00", "#6ae06e"],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#111",
        },
      });

      map.addLayer({
        id: "route-hotspots-layer",
        type: "circle",
        source: "route-hotspots",
        paint: {
          "circle-radius": 7,
          "circle-color": ["match", ["get", "severity"], "high", "#ff3300", "medium", "#e4c20c", "#4ad66d"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0e0f0e",
        },
      });

      map.addLayer({
        id: "places-layer",
        type: "circle",
        source: "places",
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "id"], selectedPlace?.id || ""], 10,
            ["match", ["get", "category"],
              "healthcare", 10,
              "hotel", 10,
              "fuel", 10,
              "convenience", 9,
              "reserve", 9,
              "surveillance", 7,
              5
            ]
          ],
          "circle-color": [
            "case",
            ["==", ["get", "id"], selectedPlace?.id || ""], "#ffcc00",
            ["match", ["get", "category"],
              "healthcare", "#00e5ff",  // Hospitals: Cyan
              "hotel", "#ffcc00",       // Hotels: Amber/Gold
              "fuel", "#a800ff",        // Fuel: Purple
              "convenience", "#00ff66", // 24/7 Stores: Neon Green
              "reserve", "#00b050",     // Wildlife/Monuments: Emerald Green
              "surveillance", "#ff003c", // Surveillance: Red
              "#8fa7b2"                 // Default: Slate Muted Gray
            ]
          ],
          "circle-stroke-width": [
            "match", ["get", "category"],
            "healthcare", 2.5,
            "hotel", 2.5,
            "fuel", 2.5,
            "convenience", 2,
            "reserve", 2,
            1
          ],
          "circle-stroke-color": [
            "match", ["get", "category"],
            "healthcare", "#ffffff",
            "hotel", "#ffffff",
            "fuel", "#ffffff",
            "convenience", "#ffffff",
            "reserve", "#ffffff",
            "#05080c"
          ]
        },
      });
    });

    map.on("moveend", () => {
      const center = map.getCenter();
      userMovedRef.current = true;
      onViewportChange({ lat: center.lat, lon: center.lng, label: `viewport ${center.lat.toFixed(4)},${center.lng.toFixed(4)}` });
    });

    map.on("click", (event) => {
      const matched = nearestPlace(event.lngLat, placesRef.current);
      if (matched) {
        onSelectPlaceRef.current(matched);
        return;
      }
      if (routeSelectionModeRef.current) {
        onPickRoutePointRef.current({ lat: event.lngLat.lat, lon: event.lngLat.lng, label: `${routeSelectionModeRef.current} point` });
      }
    });

    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!userMovedRef.current) {
      map.jumpTo({ center: [location.lon, location.lat], zoom: 14 });
    }
  }, [location]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("places")) return;
    map.getSource("places")?.setData(placeFeatures);
    map.getSource("density")?.setData(heatmapFeatures);
    map.getSource("traffic")?.setData(trafficFeatures);
    map.getSource("route-main")?.setData(routeMainFeature);
    map.getSource("route-shortest")?.setData(routeShortestFeature);
    map.getSource("route-hotspots")?.setData(routeHotspotFeatures);
    
    if (map.getLayer("places-layer")) {
      map.setPaintProperty("places-layer", "circle-radius", [
        "case",
        ["==", ["get", "id"], selectedPlace?.id || ""], 10,
        ["match", ["get", "category"],
          "healthcare", 10,
          "hotel", 10,
          "fuel", 10,
          "convenience", 9,
          "reserve", 9,
          "surveillance", 7,
          5
        ]
      ]);
      map.setPaintProperty("places-layer", "circle-color", [
        "case",
        ["==", ["get", "id"], selectedPlace?.id || ""], "#ffcc00",
        ["match", ["get", "category"],
          "healthcare", "#00e5ff",
          "hotel", "#ffcc00",
          "fuel", "#a800ff",
          "convenience", "#00ff66",
          "reserve", "#00b050",
          "surveillance", "#ff003c",
          "#8fa7b2"
        ]
      ]);
      map.setPaintProperty("places-layer", "circle-stroke-width", [
        "match", ["get", "category"],
        "healthcare", 2.5,
        "hotel", 2.5,
        "fuel", 2.5,
        "convenience", 2,
        "reserve", 2,
        1
      ]);
      map.setPaintProperty("places-layer", "circle-stroke-color", [
        "match", ["get", "category"],
        "healthcare", "#ffffff",
        "hotel", "#ffffff",
        "fuel", "#ffffff",
        "convenience", "#ffffff",
        "reserve", "#ffffff",
        "#05080c"
      ]);
    }
  }, [placeFeatures, heatmapFeatures, trafficFeatures, routeMainFeature, routeShortestFeature, routeHotspotFeatures, selectedPlace]);

  return (
    <div className={`map-shell ${routeSelectionMode ? "map-armed" : ""}`}>
      <div ref={containerRef} className="map-container" />
      <div className="crosshair" aria-hidden="true" />
      <div className="map-hint">move map to rescan | click marker to inspect | {routeSelectionMode ? `click map to set ${routeSelectionMode}` : "arm start/stop for routing"}</div>
    </div>
  );
}
