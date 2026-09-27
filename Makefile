# NEXUS — make setup | seed | api | web | dev | test
PY      ?= python3
VENV    ?= .venv
BIN     := $(VENV)/bin
PORT    ?= 8000

.PHONY: setup seed api web dev test clean

setup:
	$(PY) -m venv $(VENV)
	$(BIN)/pip install -q -r requirements.txt
	cd frontend && npm ci
	@test -f .env || cp .env.example .env
	@test -f frontend/.env.local || printf 'VITE_USE_MOCK=false\nVITE_API_URL=/api\n' > frontend/.env.local

seed:
	$(BIN)/python -m demo.seed --reset

api:
	$(BIN)/uvicorn backend.main:app --reload --port $(PORT)

web:
	cd frontend && NEXUS_API_PROXY=http://localhost:$(PORT) npm run dev

dev:
	@trap 'kill 0' INT TERM EXIT; \
	$(BIN)/uvicorn backend.main:app --reload --port $(PORT) & \
	(cd frontend && NEXUS_API_PROXY=http://localhost:$(PORT) npm run dev) & \
	wait

test:
	$(BIN)/python -m pytest -q
	cd frontend && npm run check

clean:
	rm -rf demo/uploads .pytest_cache
