# Hardware

The ESP32 sketch turns the board into a Wi-Fi survey probe.

## What It Does

It scans nearby access points, picks the strongest visible network, and uploads one reading to `POST /wifi-data` every few seconds.

## Arduino IDE Libraries

Install the ESP32 board package first.

The sketch uses:

- `WiFi.h`
- `HTTPClient.h`
- `time.h`

## Upload Flow

1. Connect the ESP32 to your Wi-Fi network.
2. Set `ARES_ENDPOINT` to your backend IP and port.
3. Flash the sketch from Arduino IDE.
4. Open the serial monitor to confirm it boots and scans.

## Expected Payload

Example upload sent to the backend:

```json
{
  "ssid": "Cafe_WiFi",
  "rssi": -61,
  "timestamp": "2026-04-07T12:00:00Z",
  "lat": 37.787994,
  "lon": -122.407437,
  "bssid": "aa:bb:cc:dd:ee:ff",
  "channel": 6
}
```

The backend stores the record and uses it to build the Wi-Fi heatmap view.
