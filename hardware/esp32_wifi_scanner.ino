#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* ARES_ENDPOINT = "http://192.168.1.10:8000/wifi-data";

float DEVICE_LAT = 37.787994;
float DEVICE_LON = -122.407437;

String escapeJson(const String& input) {
  String out;
  out.reserve(input.length() + 8);
  for (size_t i = 0; i < input.length(); ++i) {
    char c = input[i];
    if (c == '"' || c == '\\') {
      out += '\\';
    }
    out += c;
  }
  return out;
}

String timestampIso() {
  time_t now = time(nullptr);
  if (now < 100000) {
    return String(millis());
  }
  struct tm timeinfo;
  gmtime_r(&now, &timeinfo);
  char buffer[32];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buffer);
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
}

void postReading(const String& ssid, int rssi, const String& bssid, int channel) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(ARES_ENDPOINT);
  http.addHeader("Content-Type", "application/json");

  String payload = "{";
  payload += "\"ssid\":\"" + escapeJson(ssid) + "\",";
  payload += "\"rssi\":" + String(rssi) + ",";
  payload += "\"timestamp\":\"" + timestampIso() + "\",";
  payload += "\"lat\":" + String(DEVICE_LAT, 6) + ",";
  payload += "\"lon\":" + String(DEVICE_LON, 6);
  if (bssid.length() > 0) {
    payload += ",\"bssid\":\"" + escapeJson(bssid) + "\"";
  }
  if (channel > 0) {
    payload += ",\"channel\":" + String(channel);
  }
  payload += "}";

  http.POST(payload);
  http.end();
}

void setup() {
  Serial.begin(115200);
  connectWifi();
}

void loop() {
  int count = WiFi.scanNetworks(false, true);
  int bestIndex = -1;
  int bestRssi = -1000;

  for (int i = 0; i < count; ++i) {
    int rssi = WiFi.RSSI(i);
    if (rssi > bestRssi) {
      bestRssi = rssi;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0) {
    postReading(
      WiFi.SSID(bestIndex),
      WiFi.RSSI(bestIndex),
      WiFi.BSSIDstr(bestIndex),
      WiFi.channel(bestIndex)
    );
  }

  WiFi.scanDelete();
  delay(5000);
}
