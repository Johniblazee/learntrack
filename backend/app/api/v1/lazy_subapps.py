"""Lazy-mounted FastAPI sub-apps for expensive route groups."""

from importlib import import_module
from typing import Any, Optional


class LazyRouterSubApp:
    """Delay importing a router module until the first request for its prefix."""

    def __init__(self, module_path: str, router_attr: str = "router"):
        self.module_path = module_path
        self.router_attr = router_attr
        self._app: Optional[Any] = None

    def _load(self):
        if self._app is None:
            from fastapi import FastAPI

            module = import_module(self.module_path)
            router = getattr(module, self.router_attr)
            sub_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
            sub_app.include_router(router)
            self._app = sub_app
        return self._app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        app = self._load()
        await app(scope, receive, send)


def create_lazy_router_subapp(
    module_path: str, router_attr: str = "router"
) -> LazyRouterSubApp:
    return LazyRouterSubApp(module_path=module_path, router_attr=router_attr)
