from fastapi import APIRouter

from app.schemas import AiSummaryRequest, ChatRequest
from app.services.ai import generate_area_summary, generate_chat_response

router = APIRouter(tags=["ai"])


@router.post("/ai-summary")
def ai_summary(payload: AiSummaryRequest):
    return generate_area_summary(payload.location_data)

@router.post("/chat")
def chat(payload: ChatRequest):
    return generate_chat_response(payload.message, payload.context.model_dump())

