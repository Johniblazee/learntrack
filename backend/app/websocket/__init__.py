"""WebSocket module for real-time chat."""

from importlib import import_module
from typing import Any, Optional


class LazySocketApp:
    """ASGI wrapper that defers Socket.IO initialization until first use."""

    def __init__(self):
        self._app: Optional[Any] = None

    def _load(self):
        if self._app is None:
            module = import_module("app.websocket.socket_manager")
            self._app = module.get_socket_app()
        return self._app

    async def __call__(self, scope, receive, send):
        app = self._load()
        await app(scope, receive, send)


_lazy_socket_app = LazySocketApp()


def get_socket_app():
    """Return the lazy Socket.IO ASGI wrapper."""
    return _lazy_socket_app


def __getattr__(name: str):
    if name == "sio":
        return import_module("app.websocket.socket_manager").sio
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["get_socket_app", "sio"]
