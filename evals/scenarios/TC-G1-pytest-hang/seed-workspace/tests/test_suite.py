import time


def test_basic_math():
    assert 1 + 1 == 2


def test_string_ops():
    result = "hello " + "world"
    assert result == "hello world"


def test_slow_io_simulation():
    time.sleep(2)
    assert True
