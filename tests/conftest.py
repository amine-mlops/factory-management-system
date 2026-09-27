"""Seed a throw-away DuckDB + docs + rules.json, start the app, and hand out tokens per persona."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="nexus-test-"))
os.environ.update({
    "DB_PATH": str(_TMP / "test.duckdb"), "DOCS_DIR": str(_TMP / "docs"), "UPLOADS_DIR": str(_TMP / "uploads"),
    "RULES_PATH": str(_TMP / "rules.json"), "AUDIT_SCHEDULER": "off", "DEMO_MODE": "true", "LLM_API_KEY": "",
    "DOC_STAGE_DELAY_SECONDS": "0", "JWT_SECRET": "test-secret-0123456789abcdef0123456789",
})
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from backend.config import get_settings  # noqa: E402

get_settings.cache_clear()

from backend.main import app  # noqa: E402
from demo import seed  # noqa: E402


@pytest.fixture(scope="session")
def client():
    seed.seed(reset=True)
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def tokens(client):
    out = {}
    for persona in ("owner", "driver", "procurement", "data_architect"):
        r = client.post("/api/auth/demo-login", json={"persona": persona})
        assert r.status_code == 200, r.text
        out[persona] = r.json()["access_token"]
    return out


@pytest.fixture(scope="session")
def h(tokens):
    """h('driver') → Authorization headers for that persona."""
    return lambda persona: {"Authorization": f"Bearer {tokens[persona]}"}


@pytest.fixture(scope="session")
def rules_path():
    return Path(os.environ["RULES_PATH"])
