import requests


class ApiClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {api_key}"

    def get(self, path: str) -> dict:
        url = f"{self.base_url}{path}"
        response = self.session.get(url, timeout=10)
        response.raise_for_status()
        return response.json()

    def post(self, path: str, data: dict) -> dict:
        url = f"{self.base_url}{path}"
        response = self.session.post(url, json=data, timeout=10)
        response.raise_for_status()
        return response.json()
