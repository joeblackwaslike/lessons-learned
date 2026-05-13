from fastapi import FastAPI

from .routes import router

app = FastAPI(title="User Preferences API")
app.include_router(router)
