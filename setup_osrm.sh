#!/bin/bash
# Script to download and prepare OSM data for offline OSRM routing

REGION="monaco-latest.osm.pbf"
URL="http://download.geofabrik.de/europe/$REGION"

mkdir -p osrm-data
cd osrm-data

echo "Downloading OSM data..."
curl -L $URL -o data.osm.pbf

echo "Processing OSRM graph (this might take a while for larger regions)..."
docker run -t -v $(pwd):/data ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/data.osm.pbf
docker run -t -v $(pwd):/data ghcr.io/project-osrm/osrm-backend osrm-partition /data/data.osrm
docker run -t -v $(pwd):/data ghcr.io/project-osrm/osrm-backend osrm-customize /data/data.osrm

echo "OSRM data is ready. You can now start docker-compose up."
