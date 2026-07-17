from fastapi import APIRouter

from app.schemas import RouteRequest
from app.services.routing import get_route

router = APIRouter(tags=["routes"])


@router.post("/routes")
def routes(payload: RouteRequest):
    return get_route(payload.source, payload.destination, payload.mode)
