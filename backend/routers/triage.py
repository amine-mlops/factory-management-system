"""POST /api/triage/infer — simulated P2: returns the matching preset from frontend/public/mock_data.json."""
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..config import get_settings
from ..permissions import Principal, require
from ..schemas import TriageRequest

router = APIRouter(prefix="/triage", tags=["triage"])
PRESET_NAMES = {"pump_cavitation": "Pump Cavitation", "bearing_degradation": "Bearing Degradation", "healthy_baseline": "Healthy Baseline"}


@router.post("/infer")
def infer(body: TriageRequest, p: Principal = Depends(require("triage", "view"))) -> dict:
    path = get_settings().path(get_settings().triage_mock_path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HTTPException(503, detail="Triage presets unavailable")
    presets = data if isinstance(data, list) else [data]
    wanted = PRESET_NAMES.get(body.preset, body.preset)
    match = next((d for d in presets if d.get("input", {}).get("preset") in (wanted, body.preset)), None)
    if not match:
        raise HTTPException(404, detail=f"Preset '{body.preset}' is not available in the simulated backend")
    match["telemetry"]["request_id"] = f"req_{uuid.uuid4().hex[:8]}-{match['asset']['id'].lower()}"
    match["telemetry"]["timestamp"] = datetime.now(timezone.utc).isoformat()
    source = getattr(body, "source", None)
    if isinstance(source, str) and source.strip():
        match["input"]["source"] = source.strip()
    return match
