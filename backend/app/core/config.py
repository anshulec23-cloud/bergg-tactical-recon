from dataclasses import dataclass
import os


def _env(name: str, default: str = "") -> str:
    value = os.getenv(name, default)
    return value.strip()


@dataclass(frozen=True)
class Settings:
    openai_api_key: str = _env("OPENAI_API_KEY")
    openai_model: str = _env("OPENAI_MODEL", "gpt-4o-mini")
    overpass_url: str = _env("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
    nominatim_url: str = _env("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")
    valhalla_url: str = _env("VALHALLA_URL", "http://valhalla:8002")
    request_timeout: int = int(_env("REQUEST_TIMEOUT", "18"))
    wifi_history_limit: int = int(_env("WIFI_HISTORY_LIMIT", "2000"))
    wifi_db_path: str = _env("WIFI_DB_PATH", "./data/ares_wifi.db")


settings = Settings()
