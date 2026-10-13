"""Auto-Planung (Cluster G): Gewichte, Start als Hintergrund-Job, Fortschritt per Polling."""
import threading
import traceback
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from app import db
from app.db import get_session
from app.solver import GEWICHTE_STANDARD, AutoPlanFehler, Fortschritt, auto_planen, gewichte_pruefen
from app.solver import plan_pruefen_fuer_lauf

router = APIRouter()


class AutoPlanAnfrage(BaseModel):
    modus: Literal["neu", "luecken", "umplanen"] = "neu"
    gewichte: Optional[dict[str, Optional[float]]] = None
    zeitlimit_s: Optional[float] = None


class _Job:
    def __init__(self, plan_id: int):
        self.job_id = uuid.uuid4().hex[:12]
        self.plan_id = plan_id
        self.status = "laeuft"
        self.fortschritt = Fortschritt()
        self.ergebnis: Optional[dict] = None
        self.fehler: Optional[str] = None

    def dto(self) -> dict:
        if self.status == "laeuft":
            anteil, meldung = self.fortschritt.wert(), self.fortschritt.meldung
        elif self.status == "fertig":
            anteil, meldung = 1.0, "Fertig"
        else:
            anteil, meldung = 1.0, self.fehler or "Fehler"
        return {"job_id": self.job_id, "plan_id": self.plan_id, "status": self.status,
                "fortschritt": anteil, "meldung": meldung, "ergebnis": self.ergebnis}


_JOBS: dict[str, _Job] = {}
_LOCK = threading.Lock()
_MAX_JOBS = 50  # ältere, abgeschlossene Jobs werden verworfen


def _ausfuehren(job: _Job, modus: str, gewichte: dict, zeitlimit_s: Optional[float]) -> None:
    try:
        with Session(db.engine) as s:
            job.ergebnis = auto_planen(s, job.plan_id, modus, gewichte, zeitlimit_s, job.fortschritt)
        job.status = "fertig"
    except AutoPlanFehler as f:
        job.fehler, job.status = f.meldung, "fehler"
    except Exception as f:  # noqa: BLE001 – Fehler gehören in den Job, nicht in den Thread
        traceback.print_exc()
        job.fehler, job.status = f"Auto-Planung fehlgeschlagen: {f}", "fehler"


@router.get("/solver/gewichte")
def solver_gewichte():
    return dict(GEWICHTE_STANDARD)


@router.post("/plaene/{id}/auto-planen")
def auto_planen_starten(id: int, daten: AutoPlanAnfrage, session: Session = Depends(get_session)):
    try:
        plan_pruefen_fuer_lauf(session, id, daten.modus)
        gewichte = gewichte_pruefen(daten.gewichte)
    except AutoPlanFehler as f:
        raise HTTPException(f.status_code, f.meldung)
    if daten.zeitlimit_s is not None and not (1 <= daten.zeitlimit_s <= 120):
        raise HTTPException(422, "Das Zeitlimit muss zwischen 1 und 120 Sekunden liegen")
    with _LOCK:
        if any(j.plan_id == id and j.status == "laeuft" for j in _JOBS.values()):
            raise HTTPException(409, "Für diesen Plan läuft bereits eine Auto-Planung")
        job = _Job(id)
        _JOBS[job.job_id] = job
        fertig = [j for j in _JOBS.values() if j.status != "laeuft"]
        for alt in fertig[:max(0, len(_JOBS) - _MAX_JOBS)]:
            _JOBS.pop(alt.job_id, None)
    threading.Thread(target=_ausfuehren, args=(job, daten.modus, gewichte, daten.zeitlimit_s),
                     name=f"auto-planen-{id}", daemon=True).start()
    return job.dto()


@router.get("/solver/jobs/{job_id}")
def solver_job(job_id: str):
    job = _JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "Job nicht gefunden")
    return job.dto()
