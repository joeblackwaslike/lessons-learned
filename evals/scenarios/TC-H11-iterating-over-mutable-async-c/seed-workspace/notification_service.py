from __future__ import annotations
import asyncio
from typing import Any


class NotificationService:
    def __init__(self) -> None:
        self.subscribers: set[Any] = set()

    async def subscribe(self, subscriber: Any) -> None:
        self.subscribers.add(subscriber)

    async def unsubscribe(self, subscriber: Any) -> None:
        self.subscribers.discard(subscriber)

    # TODO: add broadcast(message) method
