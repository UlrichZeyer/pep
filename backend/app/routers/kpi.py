"""REST-Endpunkte Bedarf & KPIs (Cluster B)."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app import bedarf as bedarf_mod
from app import kpi
from app.db import get_session
from app.models import Plan
from app.util import stichtag_heute

router = APIRouter()

MAX_TAGE = 800


def _zeitraum(von: date, bis: date) -> None:
    if bis < von:
        raise HTTPException(400, "„bis“ liegt vor „von“.")
    if (bis - von).days > MAX_TAGE:
        raise HTTPException(400, f"Zeitraum zu lang (max. {MAX_TAGE} Tage).")


@router.get("/bedarf")
def bedarf(von: date, bis: date, session: Session = Depends(get_session)):
    _zeitraum(von, bis)
    return bedarf_mod.bedarf(session, von, bis)


@router.get("/kpi/prognose")
def prognose(von: date, bis: date, session: Session = Depends(get_session)):
    _zeitraum(von, bis)
    return bedarf_mod.prognose(session, von, bis)


@router.get("/kpi/anlieferung")
def anlieferung(von: date, bis: date, session: Session = Depends(get_session)):
    _zeitraum(von, bis)
    return kpi.anlieferung(session, von, bis)


@router.get("/kpi/abdeckung")
def abdeckung(plan_id: int, session: Session = Depends(get_session)):
    plan = session.get(Plan, plan_id)
    if plan is None:
        raise HTTPException(404, "Plan nicht gefunden.")
    return kpi.abdeckung(session, plan)


@router.get("/kpi/leistung")
def leistung(von: date, bis: date, session: Session = Depends(get_session)):
    _zeitraum(von, bis)
    return kpi.leistung(session, von, bis)


@router.get("/kpi/stunden")
def stunden(von: date, bis: date, session: Session = Depends(get_session)):
    _zeitraum(von, bis)
    return kpi.stunden(session, von, bis)


@router.get("/kpi/personal")
def personal(session: Session = Depends(get_session)):
    return kpi.personal(session, stichtag_heute())
