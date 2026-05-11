from fastapi import FastAPI
import requests

app = FastAPI()

@app.get("/weather/{city}")
def get_weather(city: str):
    """Fetch weather data from external API."""
    response = requests.get(f"https://api.weather.example.com/v1/{city}")
    response.raise_for_status()
    data = response.json()
    return {"city": city, "temp": data["temperature"], "description": data["description"]}
