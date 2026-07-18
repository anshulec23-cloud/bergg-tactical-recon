from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ScanRequest(BaseModel):
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lon: Optional[float] = Field(default=None, ge=-180, le=180)
    place_name: Optional[str] = None
    radius_m: int = Field(default=1200, ge=100, le=5000)


class RouteRequest(BaseModel):
    source: str
    destination: str
    mode: Literal["driving", "walking", "cycling"] = "driving"


class WiFiScanRecord(BaseModel):
    ssid: str
    rssi: int
    timestamp: Any = Field(default_factory=datetime.utcnow)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    bssid: Optional[str] = None
    channel: Optional[int] = None


class WiFiHeatmapPoint(BaseModel):
    lat: float
    lon: float
    strength: float
    sample_count: int
    ssids: list[str]


class AiSummaryRequest(BaseModel):
    location_data: dict[str, Any]


class PlaceResult(BaseModel):
    id: str
    name: str
    category: str
    subcategory: Optional[str] = None
    rating: Optional[float] = None
    price_level: Optional[str] = None
    distance_m: float
    lat: float
    lon: float
    address: Optional[str] = None
    action_url: Optional[str] = None


class RoutePoint(BaseModel):
    lat: float
    lon: float

