from fastapi import APIRouter

router = APIRouter()

@router.get("/health")
@router.head("/health")
async def health():
    return {"status": "ok"}
