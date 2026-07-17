@echo off
echo ===================================================
echo             ARES RECON STARTUP CONSOLE
echo ===================================================

:: Ensure custom_files directory exists
if not exist "custom_files" (
    echo [SYS] Creating custom_files folder...
    mkdir custom_files
)

:: Download map extract if not present
if not exist "custom_files\monaco-latest.osm.pbf" (
    echo [SYS] OSM map extract not found. Downloading Monaco map for testing...
    curl.exe -L "http://download.geofabrik.de/europe/monaco-latest.osm.pbf" -o "custom_files\monaco-latest.osm.pbf"
    if %errorlevel% neq 0 (
        echo [ERR] Failed to download OSM data. Please check your internet connection.
        pause
        exit /b %errorlevel%
    )
) else (
    echo [SYS] Monaco OSM map extract found in custom_files.
)

:: Copy environment file if missing
if not exist "backend\.env" (
    echo [SYS] Backend env file missing. Copying default config...
    copy "backend\.env.example" "backend\.env" >nul
)

echo [SYS] Compiling and starting Docker containers...
docker-compose up --build -d

if %errorlevel% neq 0 (
    echo [ERR] Docker Compose failed to launch. Verify Docker is running.
    pause
    exit /b %errorlevel%
)

echo ===================================================
echo [SUCCESS] ARES RECON SYSTEM DEPLOYED SUCCESSFUL
echo ===================================================
echo.
echo - Frontend HUD: http://localhost:3000
echo - Backend Core: http://localhost:8000
echo.
echo Press any key to exit this console...
pause >nul
