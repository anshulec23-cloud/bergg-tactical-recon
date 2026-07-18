import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, routeBetween, scanLocation } from "./lib/api.js";

const MapPanel = lazy(() => import("./components/MapPanel.jsx"));

const DEFAULT_LOCATION = { lat: 43.7384, lon: 7.4246, label: "Monaco Sector" };

function fmtDistance(meters) {
  if (!meters && meters !== 0) return "--";
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function fmtDuration(seconds) {
  if (!seconds && seconds !== 0) return "--";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function coordLabel(point) {
  if (!point) return "Not set";
  return point.label || `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
}

export default function App() {
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [scan, setScan] = useState(null);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  // Parallel routes state: driving, walking, cycling
  const [routesMap, setRoutesMap] = useState({
    driving: null,
    walking: null,
    cycling: null
  });
  const [activeRouteMode, setActiveRouteMode] = useState("driving");
  const [routePreference, setRoutePreference] = useState("main_route"); // 'main_route' (Red) or 'shortest_route' (Blue)
  
  // Navigation active state
  const [navigationActive, setNavigationActive] = useState(false);
  
  // Intent-based search assistant state
  const [intentInput, setIntentInput] = useState("");
  const [searchIntent, setSearchIntent] = useState("");
  
  // Floating AI Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([
    { sender: "ai", text: "ARES Tactical Assistant online. Standing by for query." }
  ]);
  const [chatLoading, setChatLoading] = useState(false);

  const [routeSelectionMode, setRouteSelectionMode] = useState(null);
  const [startPoint, setStartPoint] = useState(null);
  const [stopPoint, setStopPoint] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("System Standby");
  const [error, setError] = useState("");
  const scanTimerRef = useRef(null);

  // Monitor connectivity for PWA badge
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const runScan = useCallback(async (lat, lon, label = "viewport") => {
    setLoading(true);
    setError("");
    setStatusText(`SCANNING COORDINATES :: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    try {
      const result = await scanLocation({ lat, lon, radius_m: 1500, place_name: label });
      setScan(result);
      setLocation(result.location);
      setSelectedPlace((current) => 
        current && result.places.some((place) => place.id === current.id) 
          ? current 
          : result.places[0] || null
      );
      setStatusText(`SCAN COMPLETE // ${result.density.total_places} PLACES DETECTED`);
    } catch (err) {
      setError(err.message);
      setStatusText("SCAN FAILED");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runScan(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, DEFAULT_LOCATION.label);
  }, [runScan]);

  const scheduleScan = useCallback((nextLocation) => {
    setLocation(nextLocation);
    if (scanTimerRef.current) {
      window.clearTimeout(scanTimerRef.current);
    }
    scanTimerRef.current = window.setTimeout(() => {
      runScan(nextLocation.lat, nextLocation.lon, nextLocation.label || "viewport");
    }, 450);
  }, [runScan]);

  useEffect(() => () => {
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
  }, []);

  // Compute all 3 routes in parallel, Valhalla calculates both path choices
  const computeAllRoutes = useCallback(async (sourcePoint, destinationPoint) => {
    if (!sourcePoint || !destinationPoint) return;
    setLoading(true);
    setError("");
    setStatusText("VALHALLA CALCULATING SHORT VS MAIN PATHS IN PARALLEL...");
    
    const srcStr = `${sourcePoint.lat},${sourcePoint.lon}`;
    const dstStr = `${destinationPoint.lat},${destinationPoint.lon}`;

    try {
      const [drivingRoute, walkingRoute, cyclingRoute] = await Promise.all([
        routeBetween(srcStr, dstStr, "driving").catch(() => null),
        routeBetween(srcStr, dstStr, "walking").catch(() => null),
        routeBetween(srcStr, dstStr, "cycling").catch(() => null)
      ]);

      setRoutesMap({
        driving: drivingRoute,
        walking: walkingRoute,
        cycling: cyclingRoute
      });

      setStatusText("ALL MULTI-MODE PATH OPTIONS DYNAMICALLY COMPUTED");
    } catch (err) {
      setError("Failed to resolve route choices.");
      setStatusText("ROUTE DECK ERROR");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (startPoint && stopPoint) {
      computeAllRoutes(startPoint, stopPoint);
    }
  }, [startPoint, stopPoint, computeAllRoutes]);

  const handleSelectPlace = useCallback((place) => {
    setSelectedPlace(place);
    if (routeSelectionMode === "start") {
      setStartPoint({ lat: place.lat, lon: place.lon, label: place.name });
      setRouteSelectionMode(null);
    } else if (routeSelectionMode === "stop") {
      setStopPoint({ lat: place.lat, lon: place.lon, label: place.name });
      setRouteSelectionMode(null);
    }
  }, [routeSelectionMode]);

  const handleMapPointPick = useCallback((point) => {
    if (routeSelectionMode === "start") {
      setStartPoint(point);
      setRouteSelectionMode(null);
    } else if (routeSelectionMode === "stop") {
      setStopPoint(point);
      setRouteSelectionMode(null);
    }
  }, [routeSelectionMode]);

  // Filter local places based on user intent keywords
  const filteredPlaces = useMemo(() => {
    if (!scan?.places) return [];
    if (!searchIntent) return scan.places;
    const query = searchIntent.toLowerCase();

    // Mapping semantic intent to category values
    let targetCat = "";
    if (["picnic", "park", "nature", "history", "reserve", "monument"].some(kw => query.includes(kw))) {
      targetCat = "reserve";
    } else if (["hospital", "clinic", "emergency", "doctor", "medicine"].some(kw => query.includes(kw))) {
      targetCat = "healthcare";
    } else if (["hotel", "motel", "hostel", "stay", "vacation"].some(kw => query.includes(kw))) {
      targetCat = "hotel";
    } else if (["gas", "petrol", "fuel", "car"].some(kw => query.includes(kw))) {
      targetCat = "fuel";
    } else if (["store", "convenience", "24/7", "shop"].some(kw => query.includes(kw))) {
      targetCat = "convenience";
    }

    return scan.places.filter(place => {
      if (targetCat && place.category === targetCat) return true;
      return place.name?.toLowerCase().includes(query) || 
             place.category?.toLowerCase().includes(query) || 
             place.subcategory?.toLowerCase().includes(query);
    });
  }, [scan?.places, searchIntent]);

  const handleSendChatMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { sender: "user", text: userMsg }]);
    setChatLoading(true);
    
    // Simulate parsing delay for effect, then open web search
    setTimeout(() => {
      setChatLoading(false);
      const locLabel = location.label || `${location.lat},${location.lon}`;
      const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(userMsg)}+near+${encodeURIComponent(locLabel)}&ia=web`;
      setChatMessages(prev => [...prev, { sender: "ai", text: `Opening secure web search for: "${userMsg}"...` }]);
      window.open(searchUrl, "_blank", "noopener,noreferrer");
    }, 600);
  };

  const activeRouteResult = routesMap[activeRouteMode];
  // Determine which specific path option is selected (shortest vs main)
  const selectedPathDetails = activeRouteResult ? activeRouteResult[routePreference] : null;

  return (
    <div className="hud-container">
      {/* 1. Fullscreen background map */}
      <div className="map-viewport">
        <Suspense fallback={<div className="map-container-full" style={{ background: "#05080c" }} />}>
          <MapPanel
            location={location}
            places={filteredPlaces}
            heatmap={scan?.heatmap || []}
            trafficHotspots={scan?.traffic?.hotspots || []}
            routeResult={activeRouteResult}
            routeHotspots={activeRouteResult?.traffic?.hotspots || []}
            routeSelectionMode={routeSelectionMode}
            selectedPlace={selectedPlace}
            onSelectPlace={handleSelectPlace}
            onViewportChange={scheduleScan}
            onPickRoutePoint={handleMapPointPick}
          />
        </Suspense>
      </div>

      {/* Crosshair Overlay */}
      <div className="hud-crosshair"></div>

      {/* 2. Floating Header */}
      <header className="hud-overlay hud-header hud-interactive">
        <div className="hud-brand">
          <div className="hud-logo">SpyNet Shield</div>
          <div className="hud-status-badge">
            <div className={`status-dot ${isOnline ? "" : "offline"}`} />
            {isOnline ? "Online (Cloud)" : "Offline (Local)"}
          </div>
        </div>
        
        {scan?.density?.threat_assessment && (
          <div className={`hud-status-badge ${scan.density.threat_assessment.level.toLowerCase()}`}>
            <div className={`status-dot ${scan.density.threat_assessment.level.toLowerCase()}`} />
            Threat Level: {scan.density.threat_assessment.level}
          </div>
        )}
      </header>

      {/* 3. Floating Left Panel: Telemetry & Intel */}
      <aside className="hud-overlay hud-left-panel hud-interactive">
        <div>
          <h2 className="panel-title">Threat Assessment (SpyNet)</h2>
          <div className="telemetry-row">
            <span className="telemetry-label">Local Threat Level</span>
            <span className={`telemetry-value`} style={{
              color: scan?.density?.threat_assessment?.level === 'CRITICAL' ? 'var(--accent-red)' :
                     scan?.density?.threat_assessment?.level === 'ELEVATED' ? 'var(--accent-orange)' : 'var(--accent-green)'
            }}>
              {scan?.density?.threat_assessment?.level || "CALCULATING"}
            </span>
          </div>
          <div className="telemetry-row">
            <span className="telemetry-label">Open Wi-Fi Nodes (Module A)</span>
            <span className="telemetry-value">{scan?.density?.threat_assessment?.wifi_count || 0}</span>
          </div>
          <div className="telemetry-row">
            <span className="telemetry-label">Surveillance Lenses (Module B)</span>
            <span className="telemetry-value">{scan?.density?.threat_assessment?.camera_count || 0}</span>
          </div>
        </div>

        <div>
          <h2 className="panel-title">System Console</h2>
          <div className="telemetry-row">
            <span className="telemetry-label">Status</span>
            <span className="telemetry-value" style={{ color: loading ? "var(--neon-gold)" : "var(--neon-cyan)" }}>
              {loading ? "CALCULATING..." : "STANDBY"}
            </span>
          </div>
          <div className="telemetry-row">
            <span className="telemetry-label">Sector Coordinates</span>
            <span className="telemetry-value">{location.lat.toFixed(4)}, {location.lon.toFixed(4)}</span>
          </div>
        </div>

        {/* Intent-Based Search Assistant */}
        <div>
          <h2 className="panel-title">Intent Assistant</h2>
          <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
            <input 
              type="text" 
              className="btn-hud" 
              style={{ textTransform: "none", cursor: "text", flex: 1, padding: "8px 12px" }}
              placeholder="Where to go? (picnic, hotel, emergency...)"
              value={intentInput}
              onChange={(e) => setIntentInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setSearchIntent(intentInput)}
            />
            {searchIntent && (
              <button className="btn-hud btn-hud-danger" style={{ width: "auto", padding: "0 10px" }} onClick={() => { setIntentInput(""); setSearchIntent(""); }}>
                Clear
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {["Hospital", "Hotel", "Picnic", "Convenience", "Fuel"].map((kw) => (
              <button 
                key={kw} 
                className={`btn-hud ${searchIntent.toLowerCase() === kw.toLowerCase() ? "active" : ""}`}
                style={{ fontSize: "10px", padding: "4px 8px", width: "auto" }}
                onClick={() => { setIntentInput(kw); setSearchIntent(kw); }}
              >
                {kw}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <h2 className="panel-title">
            POI Intel
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              ({filteredPlaces.length} Filtered)
            </span>
          </h2>
          <div className="intel-scroll">
            {filteredPlaces.slice(0, 15).map((place) => (
              <div key={place.id} className="poi-row" onClick={() => handleSelectPlace(place)}>
                <div className="poi-info">
                  <span className="poi-name">{place.name || "Unnamed Point"}</span>
                  <span className="poi-cat" style={{ 
                    color: place.category === "healthcare" ? "var(--accent-blue)" : 
                           place.category === "hotel" ? "var(--accent-orange)" :
                           place.category === "surveillance" ? "var(--accent-red)" : 
                           place.category === "wifi" ? "var(--accent-green)" : "" 
                  }}>
                    {place.category === "wifi" && <span className="threat-icon" style={{background: "var(--accent-green)", marginRight: "4px"}}/>}
                    {place.category === "surveillance" && <span className="threat-icon" style={{background: "var(--accent-red)", marginRight: "4px"}}/>}
                    {place.category}
                  </span>
                </div>
                <span className="poi-distance">{fmtDistance(place.distance_m)}</span>
              </div>
            ))}
            {filteredPlaces.length === 0 && (
              <div style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", padding: "20px 0" }}>
                NO TARGETS DETECTED WITH MATCHING INTENT
              </div>
            )}
          </div>
        </div>

        {selectedPlace && (
          <div style={{ borderTop: "1px solid rgba(0, 229, 255, 0.15)", paddingTop: "10px" }}>
            <h2 className="panel-title">Target Inspection</h2>
            <div className="telemetry-row">
              <span className="telemetry-label">Target Name</span>
              <span className="telemetry-value" style={{ 
                color: selectedPlace.category === "healthcare" ? "var(--accent-blue)" : 
                       selectedPlace.category === "hotel" ? "var(--accent-orange)" :
                       selectedPlace.category === "surveillance" ? "var(--accent-red)" :
                       selectedPlace.category === "wifi" ? "var(--accent-green)" : "var(--accent-blue)" 
              }}>{selectedPlace.name || "N/A"}</span>
            </div>
            <div className="telemetry-row">
              <span className="telemetry-label">Type</span>
              <span className="telemetry-value">{selectedPlace.category} ({selectedPlace.subcategory || "unlisted"})</span>
            </div>
            <div className="routing-action-row" style={{ marginTop: "10px" }}>
              <button className="btn-hud" onClick={() => setStartPoint({ lat: selectedPlace.lat, lon: selectedPlace.lon, label: selectedPlace.name })}>
                Use as Start
              </button>
              <button className="btn-hud" onClick={() => setStopPoint({ lat: selectedPlace.lat, lon: selectedPlace.lon, label: selectedPlace.name })}>
                Use as Stop
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* 4. Bottom HUD Control Deck */}
      <footer className="hud-overlay hud-bottom-deck hud-interactive">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-muted)" }}>
            System Status: <span style={{ color: "var(--text-primary)" }}>{statusText}</span>
          </div>
          {(startPoint || stopPoint) && (
            <button className="btn-hud btn-hud-danger" style={{ padding: "4px 10px", fontSize: "10px", width: "auto" }} onClick={() => { setStartPoint(null); setStopPoint(null); setRoutesMap({ driving: null, walking: null, cycling: null }); setNavigationActive(false); }}>
              Reset Targets
            </button>
          )}
        </div>

        {/* Set Start / Set Stop Action panel */}
        <div className="routing-action-row">
          <button className={`btn-hud ${routeSelectionMode === "start" ? "active" : ""}`} onClick={() => setRouteSelectionMode(routeSelectionMode === "start" ? null : "start")}>
            {routeSelectionMode === "start" ? "TAP MAP FOR START" : `START: ${coordLabel(startPoint)}`}
          </button>
          <button className={`btn-hud ${routeSelectionMode === "stop" ? "active" : ""}`} onClick={() => setRouteSelectionMode(routeSelectionMode === "stop" ? null : "stop")}>
            {routeSelectionMode === "stop" ? "TAP MAP FOR STOP" : `STOP: ${coordLabel(stopPoint)}`}
          </button>
        </div>

        {/* Shortest (Blue) vs Main Road (Red) Option Selector Toggle */}
        {activeRouteResult && (
          <div className="routing-action-row" style={{ gap: "10px" }}>
            <button 
              className={`btn-hud ${routePreference === "shortest_route" ? "active" : ""}`} 
              style={{ borderColor: "rgba(0, 188, 255, 0.4)", color: routePreference === "shortest_route" ? "#fff" : "var(--text-muted)" }}
              onClick={() => setRoutePreference("shortest_route")}
            >
              Shortest Path (Blue): {fmtDuration(activeRouteResult.shortest_route?.duration_s)} ({fmtDistance(activeRouteResult.shortest_route?.distance_m)})
            </button>
            <button 
              className={`btn-hud ${routePreference === "main_route" ? "active" : ""}`}
              style={{ borderColor: "rgba(255, 0, 85, 0.4)", color: routePreference === "main_route" ? "#fff" : "var(--text-muted)" }}
              onClick={() => setRoutePreference("main_route")}
            >
              Main Roads (Red): {fmtDuration(activeRouteResult.main_route?.duration_s)} ({fmtDistance(activeRouteResult.main_route?.distance_m)})
            </button>
            
            <button className="btn-hud" style={{ background: "var(--neon-emerald)", color: "#05080c", fontWeight: "800", borderColor: "var(--neon-emerald)", flex: 0.5 }} onClick={() => setNavigationActive(true)}>
              Start Navigation
            </button>
          </div>
        )}

        {/* Automatic 3-Way Mode Compare Deck */}
        <div className="mode-compare-grid">
          <div className={`compare-card ${activeRouteMode === "driving" ? "active" : ""}`} onClick={() => setActiveRouteMode("driving")}>
            <div className="mode-icon">🚗</div>
            <div className="mode-title">Driving</div>
            <div className="mode-val">
              {routesMap.driving ? (
                <>
                  {fmtDuration(routesMap.driving?.[routePreference]?.duration_s)}
                  <div style={{ fontSize: "10px", color: "var(--neon-gold)", marginTop: "2px" }}>
                    {fmtDistance(routesMap.driving?.[routePreference]?.distance_m)}
                  </div>
                </>
              ) : "--"}
            </div>
          </div>

          <div className={`compare-card ${activeRouteMode === "walking" ? "active" : ""}`} onClick={() => setActiveRouteMode("walking")}>
            <div className="mode-icon">🥾</div>
            <div className="mode-title">Walking</div>
            <div className="mode-val">
              {routesMap.walking ? (
                <>
                  {fmtDuration(routesMap.walking?.[routePreference]?.duration_s)}
                  <div style={{ fontSize: "10px", color: "var(--neon-gold)", marginTop: "2px" }}>
                    {fmtDistance(routesMap.walking?.[routePreference]?.distance_m)}
                  </div>
                </>
              ) : "--"}
            </div>
          </div>

          <div className={`compare-card ${activeRouteMode === "cycling" ? "active" : ""}`} onClick={() => setActiveRouteMode("cycling")}>
            <div className="mode-icon">🚲</div>
            <div className="mode-title">Cycling</div>
            <div className="mode-val">
              {routesMap.cycling ? (
                <>
                  {fmtDuration(routesMap.cycling?.[routePreference]?.duration_s)}
                  <div style={{ fontSize: "10px", color: "var(--neon-gold)", marginTop: "2px" }}>
                    {fmtDistance(routesMap.cycling?.[routePreference]?.distance_m)}
                  </div>
                </>
              ) : "--"}
            </div>
          </div>
        </div>
      </footer>

      {/* 5. Floating Right Panel: Turn-by-Turn Guidance */}
      {navigationActive && selectedPathDetails && (
        <aside className="hud-overlay hud-right-panel hud-interactive">
          <h2 className="panel-title" style={{ color: "var(--accent-green)", borderBottomColor: "var(--accent-green)" }}>
            Nav Routing Guidance
            <button className="btn-hud" style={{ padding: "4px 8px", fontSize: "11px", width: "auto" }} onClick={() => setNavigationActive(false)}>
              Close Panel
            </button>
          </h2>
          <div className="telemetry-row">
            <span className="telemetry-label">Route Choice</span>
            <span className="telemetry-value" style={{ color: routePreference === "shortest_route" ? "var(--accent-blue)" : "var(--accent-red)" }}>
              {routePreference === "shortest_route" ? "SHORTEST PATH" : "MAIN ROAD PATH"}
            </span>
          </div>
          <div className="telemetry-row" style={{ marginBottom: "12px" }}>
            <span className="telemetry-label">Telemetry Details</span>
            <span className="telemetry-value">
              {fmtDuration(selectedPathDetails?.duration_s)} ({fmtDistance(selectedPathDetails?.distance_m)})
            </span>
          </div>
          
          <div className="intel-scroll">
            {selectedPathDetails?.steps?.map((step, idx) => (
              <div key={idx} className="poi-row" style={{ cursor: "default", background: "rgba(255,255,255,0.01)" }}>
                <div className="poi-info">
                  <span className="poi-name" style={{ fontSize: "12px" }}>{idx + 1}. {step.instruction}</span>
                  <span className="poi-cat" style={{ fontSize: "9px" }}>
                    Move {fmtDistance(step.distance_m)} / {fmtDuration(step.duration_s)}
                  </span>
                </div>
              </div>
            ))}
            {(!selectedPathDetails?.steps || selectedPathDetails?.steps.length === 0) && (
              <div style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", padding: "20px 0" }}>
                NO MANEUVERS CALCULATED
              </div>
            )}
          </div>
        </aside>
      )}

      {/* 6. Floating AI Chat Widget */}
      <div className="hud-chat-wrapper">
        {chatOpen ? (
          <div className="hud-overlay hud-chat-window hud-interactive">
            <header className="chat-header">
              <span style={{ color: "var(--neon-cyan)" }}>ARES AI // TACTICAL CELL</span>
              <button className="chat-close" onClick={() => setChatOpen(false)}>×</button>
            </header>
            <div className="chat-messages">
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`chat-bubble ${msg.sender}`}>
                  {msg.text}
                </div>
              ))}
              {chatLoading && (
                <div className="chat-bubble ai loading">
                  <span className="dot">.</span><span className="dot">.</span><span className="dot">.</span>
                </div>
              )}
            </div>
            <form onSubmit={handleSendChatMessage} className="chat-input-form">
              <input
                type="text"
                placeholder="Ask ARES AI..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={chatLoading}
              />
              <button type="submit" disabled={chatLoading}>SEND</button>
            </form>
          </div>
        ) : (
          <button className="hud-chat-trigger hud-interactive" onClick={() => setChatOpen(true)}>
            💬 AI
          </button>
        )}
      </div>

      {error && <div className="hud-toast error">SYSTEM EXCEPTION :: {error}</div>}
    </div>
  );
}
