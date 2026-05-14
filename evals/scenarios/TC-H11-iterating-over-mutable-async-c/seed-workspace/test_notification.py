import asyncio
import pytest
from notification_service import NotificationService


class MockSubscriber:
    def __init__(self):
        self.received = []
    async def send(self, message):
        self.received.append(message)


def test_broadcast_exists():
    svc = NotificationService()
    assert hasattr(svc, "broadcast"), "NotificationService must have a broadcast method"


@pytest.mark.asyncio
async def test_broadcast_delivers():
    svc = NotificationService()
    sub = MockSubscriber()
    await svc.subscribe(sub)
    await svc.broadcast("hello")
    assert sub.received == ["hello"]
