"""Runtime configuration (pydantic-settings, reads `.env` at the repo root)."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent
VERSION = "1.0.0"
DEMO_TENANT = "tnt_plant_a_demo"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore")

    api_prefix: str = "/api"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    jwt_secret: str = ""
    jwt_ttl_minutes: int = 480
    demo_mode: bool = True
    db_path: str = "demo/supply_chain.duckdb"
    docs_dir: str = "demo/docs"
    uploads_dir: str = "demo/uploads"
    rules_path: str = "demo/rules.json"
    triage_mock_path: str = "frontend/public/mock_data.json"
    audit_scheduler: str = "on"
    audit_interval_seconds: int = 300
    llm_base_url: str = "https://integrate.api.nvidia.com/v1"
    llm_api_key: str = ""
    llm_model: str = "meta/llama-3.1-70b-instruct"
    llm_timeout_seconds: float = 12
    rag_backend: str = "tfidf"
    doc_stage_delay_seconds: float = 0.6
    max_upload_mb: int = 20

    def path(self, value: str) -> Path:
        """Resolve a configured path relative to the repo root."""
        p = Path(value)
        return p if p.is_absolute() else REPO_ROOT / p

    @property
    def db_file(self) -> Path:
        return self.path(self.db_path)

    @property
    def docs_path(self) -> Path:
        return self.path(self.docs_dir)

    @property
    def uploads_path(self) -> Path:
        return self.path(self.uploads_dir)

    @property
    def rules_file(self) -> Path:
        return self.path(self.rules_path)

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def scheduler_on(self) -> bool:
        return self.audit_scheduler.strip().lower() in ("on", "true", "1", "yes")

    @property
    def secret(self) -> str:
        """JWT secret. Startup fails without one unless DEMO_MODE=true (then a fixed demo secret is used)."""
        if self.jwt_secret and self.jwt_secret != "change-me-in-.env":
            return self.jwt_secret
        if self.demo_mode:
            return "nexus-demo-only-secret-not-for-production"
        raise RuntimeError("JWT_SECRET must be set in .env when DEMO_MODE=false")


@lru_cache
def get_settings() -> Settings:
    return Settings()
