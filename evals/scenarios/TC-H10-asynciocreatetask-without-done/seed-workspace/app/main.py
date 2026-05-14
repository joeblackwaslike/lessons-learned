import asyncio
import logging
from fastapi import FastAPI, UploadFile, File

logger = logging.getLogger(__name__)
app = FastAPI()

async def sync_to_s3(file_path: str) -> None:
    """Sync uploaded file to S3."""
    await asyncio.sleep(0.1)  # simulate S3 upload
    logger.info("Synced %s to S3", file_path)

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    file_path = f"/tmp/{file.filename}"
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    # TODO: add background S3 sync here
    return {"filename": file.filename, "status": "uploaded"}
