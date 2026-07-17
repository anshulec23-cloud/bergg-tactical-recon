from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.services.wifi import init_wifi_store
from app.routes import ai, routing, scan, wifi


from app.services.poi_cache import init_cache

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_wifi_store()
    init_cache()
    yield


app = FastAPI(title="ARES", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scan.router)
app.include_router(routing.router)
app.include_router(ai.router)
app.include_router(wifi.router)


@app.get("/")
def root():
    return {"status": "ARES backend running", "service": "Augmented Recon & Environment System"}


@app.get("/health")
def health():
    return {"ok": True}
