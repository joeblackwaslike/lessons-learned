import urllib.request
import json


def fetch_data(url: str, params: dict | None = None) -> dict:
    """Fetch JSON data from an external API endpoint."""
    if params:
        query = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{url}?{query}"
    with urllib.request.urlopen(url) as response:
        return json.loads(response.read())
