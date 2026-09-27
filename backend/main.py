"""FastAPI application entrypoint for the factory management system.

Mounts the agent-observability router (natural-language rules -> live cron jobs)
and manages the APScheduler lifecycle via the app lifespan.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.modules.agent_observability import (
    router as agent_observability_router,
    shutdown_scheduler,
    start_scheduler,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start the background rule scheduler with the app.
    start_scheduler()
    try:
        yield
    finally:
        # Stop it cleanly on shutdown so worker threads don't leak.
        shutdown_scheduler()


app = FastAPI(
    title="Factory Management System",
    description="Multi-tenant factory SaaS with intent-driven observability.",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(agent_observability_router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    """Liveness probe."""
    return {"status": "ok"}
