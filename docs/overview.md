# ARES Overview

ARES combines live map intelligence, local POI clustering, route estimation, and Wi-Fi signal aggregation into a cyber-style environment scan interface.

## Backend Data Flow

1. User scans a location.
2. Backend geocodes if needed.
3. Backend fetches nearby OSM places.
4. Backend clusters density and generates an AI summary.
5. Frontend renders markers, heat, and action hints.

## Wi-Fi Flow

1. ESP32 scans nearby SSIDs.
2. It posts the strongest reading to `/wifi-data`.
3. Backend aggregates positions into `/wifi-heatmap`.
