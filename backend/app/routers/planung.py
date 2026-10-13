"""Planungs-API: Pläne, Einsätze, Validierung, Regelkatalog (Cluster A)."""
import json
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, func, select

from app.db import get_session
from app.models import Abteilung, Aenderungslog, Einsatz, Mitarbeiter, Plan
from app.regeln import REGELKATALOG, plan_pruefen, zusammenfassung
from app.util import arbeitsminuten, gesetzliche_pause, zeit_zu_min

router = APIRouter()

STATUS = ("entwurf", "freigegeben", "veroeffentlicht")
# erlaubte Statuswechsel: vorwärts Schritt für Schritt, zurück immer nur zu „entwurf“
UEBERGAENGE = {("entwurf", "freigegeben"), ("freigegeben", "veroeffentlicht"),
               ("freigegeben", "entwurf"), ("veroeffentlicht", "entwurf")}
STATUS_TEXT = {"entwurf": "Entwurf", "freigegeben": "freigegeben", "veroeffentlicht": "veröffentlicht"}


# ---------------------------------------------------------------- Eingabemodelle
class PlanIn(BaseModel):
    name: Optional[str] = None
    von: date
    bis: date


class PlanAenderungIn(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


class EinsatzIn(BaseModel):
    mitarbeiter_id: int
    abteilung_id: int
    datum: date
    beginn: str
    ende: str
    pause_min: Optional[int] = None
    gesperrt: bool = False


class EinsatzAenderungIn(BaseModel):
    mitarbeiter_id: Optional[int] = None
    abteilung_id: Optional[int] = None
    datum: Optional[date] = None
    beginn: Optional[str] = None
    ende: Optional[str] = None
    pause_min: Optional[int] = None
    gesperrt: Optional[bool] = None


# ---------------------------------------------------------------- Hilfen / DTOs
def _404(obj, was: str):
    if obj is None:
        raise HTTPException(404, f"{was} nicht gefunden")
    return obj


def plan_dto(session: Session, p: Plan) -> dict:
    anzahl = session.exec(select(func.count()).select_from(Einsatz).where(Einsatz.plan_id == p.id)).one()
    return {**p.model_dump(), "anzahl_einsaetze": anzahl}


def einsatz_dto(e: Einsatz) -> dict:
    return {**e.model_dump(), "stunden": round(arbeitsminuten(e.beginn, e.ende, e.pause_min) / 60, 2)}


def mindestpause(beginn: str, ende: str) -> int:
    """Gesetzliche Mindestpause; korrigiert den Bereich 9:30–9:45 h brutto, in dem util.gesetzliche_pause
    nur 30 min liefert, obwohl die Netto-Arbeitszeit dann über 9 h läge (§ 4 ArbZG: 45 min)."""
    brutto = zeit_zu_min(ende) - zeit_zu_min(beginn)
    pause = gesetzliche_pause(brutto)
    if brutto - pause > 9 * 60:
        pause = max(pause, min(45, brutto - 9 * 60))
    return pause


def _zeit_pruefen(wert: str, feld: str) -> int:
    try:
        h, m = wert.split(":")
        if len(h) != 2 or len(m) != 2:
            raise ValueError
        minuten = int(h) * 60 + int(m)
        if not (0 <= int(h) <= 24 and 0 <= int(m) < 60) or minuten > 24 * 60:
            raise ValueError
    except ValueError:
        raise HTTPException(422, f"{feld}: ungültige Uhrzeit „{wert}“ (Format HH:MM)")
    if minuten % 15:
        raise HTTPException(422, f"{feld}: {wert} liegt nicht im 15-Minuten-Raster")
    return minuten


def _einsatz_validieren(session: Session, plan: Plan, e: Einsatz) -> None:
    b = _zeit_pruefen(e.beginn, "Beginn")
    en = _zeit_pruefen(e.ende, "Ende")
    if en <= b:
        raise HTTPException(422, "Das Ende muss nach dem Beginn liegen")
    if not (plan.von <= e.datum <= plan.bis):
        raise HTTPException(422, f"Datum {e.datum.strftime('%d.%m.%Y')} liegt außerhalb des Planzeitraums "
                                 f"{plan.von.strftime('%d.%m.%Y')}–{plan.bis.strftime('%d.%m.%Y')}")
    if e.pause_min < 0 or e.pause_min >= en - b:
        raise HTTPException(422, "Die Pause muss kürzer als der Einsatz sein und darf nicht negativ sein")
    if session.get(Mitarbeiter, e.mitarbeiter_id) is None:
        raise HTTPException(422, "Mitarbeiter nicht gefunden")
    if session.get(Abteilung, e.abteilung_id) is None:
        raise HTTPException(422, "Abteilung nicht gefunden")


def _log(session: Session, entitaet: str, entitaet_id: Optional[int], aktion: str,
         alt: Optional[dict] = None, neu: Optional[dict] = None) -> None:
    dump = lambda d: json.dumps(d, default=str, ensure_ascii=False) if d is not None else None  # noqa: E731
    session.add(Aenderungslog(entitaet=entitaet, entitaet_id=entitaet_id, aktion=aktion, alt=dump(alt), neu=dump(neu)))


def _protokoll(e: Einsatz) -> dict:
    return e.model_dump(exclude={"ist_paletten"})


def _ergebnis(session: Session, e: Einsatz) -> dict:
    verstoesse = plan_pruefen(session, e.plan_id, {e.mitarbeiter_id})
    return {"einsatz": einsatz_dto(e), "verstoesse": [v.als_dict() for v in verstoesse]}


def _plan_name(von: date, bis: date) -> str:
    kw1, j1 = von.isocalendar()[1], von.isocalendar()[0]
    kw2 = bis.isocalendar()[1]
    return f"KW {kw1:02d}/{j1}" if kw1 == kw2 and (bis - von).days < 7 else f"KW {kw1:02d}–{kw2:02d}/{j1}"


# ---------------------------------------------------------------- Pläne
@router.get("/plaene")
def plaene(von: Optional[date] = None, bis: Optional[date] = None, session: Session = Depends(get_session)):
    q = select(Plan)
    if von:
        q = q.where(Plan.bis >= von)
    if bis:
        q = q.where(Plan.von <= bis)
    return [plan_dto(session, p) for p in sorted(session.exec(q).all(), key=lambda p: (p.von, p.id))]


@router.post("/plaene")
def plan_anlegen(daten: PlanIn, session: Session = Depends(get_session)):
    if daten.bis < daten.von:
        raise HTTPException(422, "„Bis“ darf nicht vor „Von“ liegen")
    if (daten.bis - daten.von).days > 62:
        raise HTTPException(422, "Ein Plan darf höchstens zwei Monate umfassen")
    konflikt = session.exec(select(Plan).where(Plan.von <= daten.bis, Plan.bis >= daten.von)).first()
    if konflikt:
        raise HTTPException(409, f"Für den Zeitraum besteht bereits der Plan „{konflikt.name}“ "
                                 f"({konflikt.von.strftime('%d.%m.%Y')}–{konflikt.bis.strftime('%d.%m.%Y')})")
    p = Plan(name=(daten.name or "").strip() or _plan_name(daten.von, daten.bis), von=daten.von, bis=daten.bis)
    session.add(p)
    session.flush()
    _log(session, "plan", p.id, "angelegt", neu={"name": p.name, "von": p.von, "bis": p.bis})
    session.commit()
    session.refresh(p)
    return plan_dto(session, p)


@router.get("/plaene/{id}")
def plan_detail(id: int, session: Session = Depends(get_session)):
    return plan_dto(session, _404(session.get(Plan, id), "Plan"))


@router.put("/plaene/{id}")
def plan_aendern(id: int, daten: PlanAenderungIn, session: Session = Depends(get_session)):
    p = _404(session.get(Plan, id), "Plan")
    alt = {"name": p.name, "status": p.status}
    if daten.name is not None:
        if not daten.name.strip():
            raise HTTPException(422, "Der Planname darf nicht leer sein")
        p.name = daten.name.strip()
    if daten.status is not None and daten.status != p.status:
        if daten.status not in STATUS:
            raise HTTPException(422, f"Unbekannter Status „{daten.status}“")
        if (p.status, daten.status) not in UEBERGAENGE:
            raise HTTPException(409, f"Statuswechsel von „{STATUS_TEXT[p.status]}“ nach "
                                     f"„{STATUS_TEXT[daten.status]}“ ist nicht möglich")
        if daten.status == "freigegeben":
            harte = [v for v in plan_pruefen(session, p.id) if v.schwere == "hart"]
            if harte:
                raise HTTPException(409, f"Freigabe nicht möglich: {len(harte)} harte Regelverstöße "
                                         f"(z. B. {harte[0].meldung})")
        p.status = daten.status
    _log(session, "plan", p.id, "geaendert", alt=alt, neu={"name": p.name, "status": p.status})
    session.add(p)
    session.commit()
    session.refresh(p)
    return plan_dto(session, p)


@router.delete("/plaene/{id}")
def plan_loeschen(id: int, session: Session = Depends(get_session)):
    p = _404(session.get(Plan, id), "Plan")
    for e in session.exec(select(Einsatz).where(Einsatz.plan_id == id)).all():
        session.delete(e)
    _log(session, "plan", id, "geloescht", alt={"name": p.name, "von": p.von, "bis": p.bis, "status": p.status})
    session.delete(p)
    session.commit()
    return {"ok": True}


@router.post("/plaene/{id}/validieren")
def plan_validieren(id: int, session: Session = Depends(get_session)):
    _404(session.get(Plan, id), "Plan")
    verstoesse = plan_pruefen(session, id)
    return {"verstoesse": [v.als_dict() for v in verstoesse], "zusammenfassung": zusammenfassung(verstoesse)}


@router.get("/regeln")
def regeln():
    return REGELKATALOG


# ---------------------------------------------------------------- Einsätze
@router.get("/plaene/{id}/einsaetze")
def einsaetze(id: int, session: Session = Depends(get_session)):
    _404(session.get(Plan, id), "Plan")
    liste = session.exec(select(Einsatz).where(Einsatz.plan_id == id)).all()
    liste = sorted(liste, key=lambda e: (e.datum, zeit_zu_min(e.beginn), e.mitarbeiter_id, e.id))
    return [einsatz_dto(e) for e in liste]


@router.post("/plaene/{id}/einsaetze")
def einsatz_anlegen(id: int, daten: EinsatzIn, session: Session = Depends(get_session)):
    plan = _404(session.get(Plan, id), "Plan")
    _zeit_pruefen(daten.beginn, "Beginn")
    _zeit_pruefen(daten.ende, "Ende")
    pause = daten.pause_min
    if pause is None:
        pause = mindestpause(daten.beginn, daten.ende) if zeit_zu_min(daten.ende) > zeit_zu_min(daten.beginn) else 0
    e = Einsatz(plan_id=id, mitarbeiter_id=daten.mitarbeiter_id, abteilung_id=daten.abteilung_id,
                datum=daten.datum, beginn=daten.beginn, ende=daten.ende, pause_min=pause,
                gesperrt=daten.gesperrt, quelle="manuell")
    _einsatz_validieren(session, plan, e)
    session.add(e)
    session.flush()
    _log(session, "einsatz", e.id, "angelegt", neu=_protokoll(e))
    session.commit()
    session.refresh(e)
    return _ergebnis(session, e)


@router.put("/einsaetze/{id}")
def einsatz_aendern(id: int, daten: EinsatzAenderungIn, session: Session = Depends(get_session)):
    e = _404(session.get(Einsatz, id), "Einsatz")
    plan = session.get(Plan, e.plan_id)
    alt = _protokoll(e)
    werte = daten.model_dump(exclude_unset=True)
    for feld in ("mitarbeiter_id", "abteilung_id", "datum", "beginn", "ende", "gesperrt"):
        if werte.get(feld) is not None:
            setattr(e, feld, werte[feld])
    if werte.get("pause_min") is not None:
        e.pause_min = werte["pause_min"]
    elif "beginn" in werte or "ende" in werte:
        # Zeiten geändert, Pause nicht angegeben → gesetzliche Mindestpause neu bestimmen
        _zeit_pruefen(e.beginn, "Beginn")
        _zeit_pruefen(e.ende, "Ende")
        if zeit_zu_min(e.ende) > zeit_zu_min(e.beginn):
            e.pause_min = mindestpause(e.beginn, e.ende)
    try:
        _einsatz_validieren(session, plan, e)
    except HTTPException:
        session.rollback()
        raise
    _log(session, "einsatz", e.id, "geaendert", alt=alt, neu=_protokoll(e))
    session.add(e)
    session.commit()
    session.refresh(e)
    return _ergebnis(session, e)


@router.delete("/einsaetze/{id}")
def einsatz_loeschen(id: int, session: Session = Depends(get_session)):
    e = _404(session.get(Einsatz, id), "Einsatz")
    plan_id, mid = e.plan_id, e.mitarbeiter_id
    _log(session, "einsatz", e.id, "geloescht", alt=_protokoll(e))
    session.delete(e)
    session.commit()
    return {"ok": True, "verstoesse": [v.als_dict() for v in plan_pruefen(session, plan_id, {mid})]}
