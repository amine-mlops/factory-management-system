# NEXUS API — FastAPI + DuckDB. Seeds the demo company on first start (DEMO_MODE=true) and works offline.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DB_PATH=/data/supply_chain.duckdb \
    DOCS_DIR=/data/docs \
    UPLOADS_DIR=/data/uploads \
    RULES_PATH=/data/rules.json \
    TRIAGE_MOCK_PATH=/app/frontend/public/mock_data.json \
    CORS_ORIGINS=http://localhost:8080

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY backend/ backend/
COPY demo/__init__.py demo/seed.py demo/
COPY frontend/public/mock_data.json frontend/public/mock_data.json

RUN useradd --create-home --uid 10001 nexus && mkdir -p /data && chown nexus:nexus /data
USER nexus
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
