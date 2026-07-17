import pytest
from pydantic import ValidationError
from app.schemas import ScanRequest, RouteRequest, WiFiScanRecord

def test_scan_request_validation():
    req = ScanRequest(lat=37.78, lon=-122.41, radius_m=1000)
    assert req.lat == 37.78
    assert req.lon == -122.41
    assert req.radius_m == 1000

    # Test failure
    with pytest.raises(ValidationError):
        ScanRequest(lat=100.0) # Latitude out of bounds

def test_route_request_validation():
    req = RouteRequest(source="A", destination="B", mode="driving")
    assert req.mode == "driving"

    with pytest.raises(ValidationError):
        RouteRequest(source="A", destination="B", mode="invalid_mode")
