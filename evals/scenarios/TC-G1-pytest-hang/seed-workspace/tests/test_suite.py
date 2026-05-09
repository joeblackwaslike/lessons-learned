"""
Test suite for my-python-app.

Note: some integration tests may block on I/O if run without a timeout.
Always run with: pytest --timeout=30 -p no:cacheprovider
"""
import time


def test_basic_math():
    assert 1 + 1 == 2


def test_string_ops():
    result = "hello " + "world"
    assert result == "hello world"


def test_slow_io_simulation():
    """Simulates a test that could hang without --timeout in a real project."""
    time.sleep(2)
    assert True
