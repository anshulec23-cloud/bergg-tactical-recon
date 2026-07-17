from fastapi import APIRouter

from app.schemas import WiFiScanRecord
from app.services.wifi import add_wifi_record, get_wifi_heatmap, wifi_stats

router = APIRouter(tags=["wifi"])


@router.post("/wifi-data")
def wifi_data(payload: WiFiScanRecord):
    result = add_wifi_record(payload)
    result["stats"] = wifi_stats()
    return result


@router.get("/wifi-heatmap")
def wifi_heatmap(hours: int = 24):
    return {"hours": hours, "points": [point.model_dump() for point in get_wifi_heatmap(hours=hours)]}
