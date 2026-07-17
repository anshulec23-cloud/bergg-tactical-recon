#!/bin/bash
# Script to download and prepare OSM data for Valhalla routing

mkdir -p custom_files

# Download Monaco extract as a small test (replace with larger region or planet for production)
echo "Downloading OSM data..."
curl -L http://download.geofabrik.de/europe/monaco-latest.osm.pbf -o custom_files/monaco-latest.osm.pbf

echo "OSM data downloaded to custom_files/"
echo "When you run docker-compose up, the Valhalla container will automatically detect the .pbf file in /custom_files, build the tiles, and start the routing server."
