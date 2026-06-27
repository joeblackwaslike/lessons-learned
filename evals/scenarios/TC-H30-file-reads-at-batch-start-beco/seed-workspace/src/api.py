from fastapi import FastAPI

app = FastAPI()


@app.get("/users")
def list_users():
    return [{"id": 1, "name": "Ada"}]


@app.get("/items")
def list_items():
    return [{"id": 1, "title": "Widget"}]
