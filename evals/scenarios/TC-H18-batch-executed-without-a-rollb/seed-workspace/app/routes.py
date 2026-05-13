from fastapi import APIRouter, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from .models import Base, User

router = APIRouter()
engine = create_engine("sqlite:///app.db")
Base.metadata.create_all(engine)


@router.get("/api/v1/users/{user_id}")
async def get_user(user_id: int):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return {"id": user.id, "email": user.email}
