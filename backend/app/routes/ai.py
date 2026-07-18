from fastapi import APIRouter

from app.schemas import AiSummaryRequest
from app.services.ai import generate_area_summary

router = APIRouter(tags=["ai"])


@router.post("/ai-summary")
def ai_summary(payload: AiSummaryRequest):
    return generate_area_summary(payload.location_data)

