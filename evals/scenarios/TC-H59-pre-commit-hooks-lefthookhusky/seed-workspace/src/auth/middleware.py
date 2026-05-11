"""Authentication middleware."""
from fastapi import Request, HTTPException
from fastapi.security import HTTPBearer

security = HTTPBearer()

async def verify_token(request: Request) -> str:
    """Verify JWT token from Authorization header."""
    credentials = await security(request)
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing credentials")
    # TODO: add actual JWT verification
    return credentials.credentials
