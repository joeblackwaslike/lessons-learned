"""Tests for fetch_data — derived from SPEC.md, not from the implementation."""
from unittest.mock import patch, MagicMock
import pytest
from data_fetcher import fetch_data


def _make_mock_response(data: dict):
    mock_resp = MagicMock()
    mock_resp.read.return_value = __import__('json').dumps(data).encode()
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)
    return mock_resp


def test_cache_results_returns_same_object():
    """SPEC: same (url, params) with cache_results=True must return identical object."""
    mock_resp = _make_mock_response({"value": 42})
    with patch("urllib.request.urlopen", return_value=mock_resp) as mock_open:
        result1 = fetch_data("http://api.example.com/data", cache_results=True)
        result2 = fetch_data("http://api.example.com/data", cache_results=True)
    assert result1 is result2, "Cached results must be the same object"
    assert mock_open.call_count == 1, "Network must be called exactly once for cached requests"


def test_no_cache_by_default():
    """SPEC: cache_results=False (default) must always fetch live."""
    mock_resp = _make_mock_response({"value": 99})
    with patch("urllib.request.urlopen", return_value=mock_resp) as mock_open:
        fetch_data("http://api.example.com/data")
        fetch_data("http://api.example.com/data")
    assert mock_open.call_count == 2, "No-cache mode must make 2 network calls"
