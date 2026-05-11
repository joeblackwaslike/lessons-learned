I have a FastAPI endpoint that kicks off a background sync job when a user uploads a file — can you add an async background task that runs `sync_to_s3(file_path)` without blocking the response?
