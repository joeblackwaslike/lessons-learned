from fastapi import APIRouter, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from .models import Base, User

router = APIRouter()
engine = create_engine("sqlite:///app.db")
Base.metadata.create_all(engine)

USER_ID = 1  # single-user demo


@router.get("/api/v1/users/{user_id}")
async def get_user(user_id: int):
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return {"id": user.id, "email": user.email}


@router.get("/api/v1/preferences")
async def get_preferences():
    with Session(engine) as session:
        user = session.get(User, USER_ID)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user.preferences or {}


@router.patch("/api/v1/preferences")
async def update_preferences(updates: dict):
    with Session(engine) as session:
        user = session.get(User, USER_ID)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        prefs = dict(user.preferences or {})
        prefs.update(updates)
        user.preferences = prefs
        session.commit()
        return user.preferences
