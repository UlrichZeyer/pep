"""REST-Endpunkte Phase 1/2: Stammdaten, Personal, Abwesenheiten, Kalender, Dashboard, Admin."""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, func, select

from app import seed
from app.db import get_session
from app.kalender import BUNDESLAND, feiertage, hotday_vorschlaege
from app.models import (
    Abteilung, Abwesenheit, Kalendereintrag, Mitarbeiter, MitarbeiterSkill, Regelparameter,
    Schichtmodell, Skill, Vertrag, Warengruppe, Wareneingang,
)
from app.util import aktueller_vertrag, alter, stichtag_heute

router = APIRouter()


# ---------------------------------------------------------------- Eingabemodelle
class AbteilungIn(BaseModel):
    name: Optional[str] = None
    kuerzel: Optional[str] = None
    bedarfsart: Optional[str] = None
    farbe: Optional[str] = None
    mindestbesetzung: Optional[int] = None
    arbeitszeit_von: Optional[str] = None
    arbeitszeit_bis: Optional[str] = None


class WarengruppeIn(BaseModel):
    std_leistung_pal_h: float


class RegelparameterIn(BaseModel):
    wert: float


class VertragIn(BaseModel):
    art: str
    gueltig_ab: date
    gueltig_bis: Optional[date] = None
    soll_std_woche: float
    max_std_monat: Optional[float] = None
    max_tage_woche: int = 5
    erlaubte_tage: str = "012345"
    frueheste_zeit: str = "05:00"
    spaeteste_zeit: str = "21:45"
    urlaubstage: int = 28
    stundenlohn: float = 14.0


class MitarbeiterIn(BaseModel):
    persnr: str
    vorname: str
    nachname: str
    geburtsdatum: date
    eintritt: date
    austritt: Optional[date] = None
    stammabteilung_id: Optional[int] = None
    rolle: str = "verkaeufer"
    status: str = "aktiv"
    stundenkonto: float = 0.0


class MitarbeiterNeuIn(MitarbeiterIn):
    vertrag: VertragIn


class SkillZuordnungIn(BaseModel):
    skill_id: int
    level: int = 2
    leistungsfaktor: float = 1.0
    zertifikat_bis: Optional[date] = None


class AbwesenheitIn(BaseModel):
    mitarbeiter_id: int
    von: date
    bis: date
    typ: str
    status: str = "genehmigt"
    notiz: Optional[str] = None


class KalendereintragIn(BaseModel):
    datum: date
    typ: str
    name: str
    lastfaktor: float = 1.0
    urlaubssperre: bool = False


# ---------------------------------------------------------------- Hilfen / DTOs
def _404(obj, was: str):
    if obj is None:
        raise HTTPException(404, f"{was} nicht gefunden")
    return obj


def mitarbeiter_dto(session: Session, m: Mitarbeiter, stichtag: date, detail: bool = False) -> dict:
    vertraege = session.exec(select(Vertrag).where(Vertrag.mitarbeiter_id == m.id)).all()
    skills = session.exec(select(MitarbeiterSkill).where(MitarbeiterSkill.mitarbeiter_id == m.id)).all()
    abw_heute = session.exec(select(Abwesenheit).where(
        Abwesenheit.mitarbeiter_id == m.id, Abwesenheit.von <= stichtag, Abwesenheit.bis >= stichtag,
        Abwesenheit.status == "genehmigt")).first()
    a = alter(m.geburtsdatum, stichtag)
    dto = {
        **m.model_dump(),
        "name": f"{m.vorname} {m.nachname}",
        "alter": a,
        "minderjaehrig": a < 18,
        "vertrag": aktueller_vertrag(vertraege, stichtag),
        "skills": [s.model_dump() for s in skills],
        "abwesend_heute": abw_heute.model_dump() if abw_heute else None,
    }
    if detail:
        dto["vertraege"] = sorted(vertraege, key=lambda v: v.gueltig_ab, reverse=True)
        dto["abwesenheiten"] = sorted(session.exec(select(Abwesenheit).where(
            Abwesenheit.mitarbeiter_id == m.id)).all(), key=lambda x: x.von, reverse=True)
    return dto


def _abwesenheit_warnungen(session: Session, a: Abwesenheit) -> list[str]:
    warnungen = []
    if a.typ == "urlaub":
        sperren = session.exec(select(Kalendereintrag).where(
            Kalendereintrag.urlaubssperre == True,  # noqa: E712
            Kalendereintrag.datum >= a.von, Kalendereintrag.datum <= a.bis)).all()
        for s in sorted(sperren, key=lambda e: e.datum):
            warnungen.append(f"Urlaubssperre: {s.datum:%d.%m.%Y} ({s.name})")
    ueberschneidung = session.exec(select(Abwesenheit).where(
        Abwesenheit.mitarbeiter_id == a.mitarbeiter_id, Abwesenheit.id != a.id,
        Abwesenheit.von <= a.bis, Abwesenheit.bis >= a.von)).all()
    for u in ueberschneidung:
        warnungen.append(f"Überschneidung mit {u.typ} {u.von:%d.%m.}–{u.bis:%d.%m.%Y}")
    return warnungen


# ---------------------------------------------------------------- Stammdaten
@router.get("/stammdaten")
def stammdaten(session: Session = Depends(get_session)):
    return {
        "abteilungen": session.exec(select(Abteilung).order_by(Abteilung.sortierung)).all(),
        "skills": session.exec(select(Skill)).all(),
        "warengruppen": session.exec(select(Warengruppe)).all(),
        "schichtmodelle": session.exec(select(Schichtmodell)).all(),
        "regelparameter": session.exec(select(Regelparameter)).all(),
    }


@router.put("/abteilungen/{id}")
def abteilung_aendern(id: int, daten: AbteilungIn, session: Session = Depends(get_session)):
    a = _404(session.get(Abteilung, id), "Abteilung")
    for k, v in daten.model_dump(exclude_none=True).items():
        setattr(a, k, v)
    session.add(a)
    session.commit()
    session.refresh(a)
    return a


@router.put("/warengruppen/{id}")
def warengruppe_aendern(id: int, daten: WarengruppeIn, session: Session = Depends(get_session)):
    w = _404(session.get(Warengruppe, id), "Warengruppe")
    if daten.std_leistung_pal_h <= 0:
        raise HTTPException(422, "Leistungswert muss größer als 0 sein")
    w.std_leistung_pal_h = daten.std_leistung_pal_h
    session.add(w)
    session.commit()
    session.refresh(w)
    return w


@router.put("/regelparameter/{schluessel}")
def regelparameter_aendern(schluessel: str, daten: RegelparameterIn, session: Session = Depends(get_session)):
    r = _404(session.get(Regelparameter, schluessel), "Regelparameter")
    r.wert = daten.wert
    session.add(r)
    session.commit()
    session.refresh(r)
    return r


# ---------------------------------------------------------------- Mitarbeiter
@router.get("/mitarbeiter")
def mitarbeiter_liste(stichtag: Optional[date] = None, session: Session = Depends(get_session)):
    tag = stichtag or stichtag_heute()
    alle = session.exec(select(Mitarbeiter).order_by(Mitarbeiter.nachname, Mitarbeiter.vorname)).all()
    return [mitarbeiter_dto(session, m, tag) for m in alle]


@router.get("/mitarbeiter/{id}")
def mitarbeiter_detail(id: int, stichtag: Optional[date] = None, session: Session = Depends(get_session)):
    m = _404(session.get(Mitarbeiter, id), "Mitarbeiter")
    return mitarbeiter_dto(session, m, stichtag or stichtag_heute(), detail=True)


@router.post("/mitarbeiter")
def mitarbeiter_anlegen(daten: MitarbeiterNeuIn, session: Session = Depends(get_session)):
    if session.exec(select(Mitarbeiter).where(Mitarbeiter.persnr == daten.persnr)).first():
        raise HTTPException(409, f"Personalnummer {daten.persnr} ist bereits vergeben")
    m = Mitarbeiter(**daten.model_dump(exclude={"vertrag"}), quelle="manuell")
    session.add(m)
    session.flush()
    session.add(Vertrag(mitarbeiter_id=m.id, **daten.vertrag.model_dump()))
    session.commit()
    session.refresh(m)
    return mitarbeiter_dto(session, m, stichtag_heute(), detail=True)


@router.put("/mitarbeiter/{id}")
def mitarbeiter_aendern(id: int, daten: MitarbeiterIn, session: Session = Depends(get_session)):
    m = _404(session.get(Mitarbeiter, id), "Mitarbeiter")
    doppelt = session.exec(select(Mitarbeiter).where(Mitarbeiter.persnr == daten.persnr, Mitarbeiter.id != id)).first()
    if doppelt:
        raise HTTPException(409, f"Personalnummer {daten.persnr} ist bereits vergeben")
    for k, v in daten.model_dump().items():
        setattr(m, k, v)
    session.add(m)
    session.commit()
    session.refresh(m)
    return mitarbeiter_dto(session, m, stichtag_heute(), detail=True)


@router.post("/mitarbeiter/{id}/vertraege")
def vertrag_anlegen(id: int, daten: VertragIn, session: Session = Depends(get_session)):
    _404(session.get(Mitarbeiter, id), "Mitarbeiter")
    offene = session.exec(select(Vertrag).where(Vertrag.mitarbeiter_id == id, Vertrag.gueltig_bis == None)).all()  # noqa: E711
    for v in offene:
        if v.gueltig_ab >= daten.gueltig_ab:
            raise HTTPException(422, "Neuer Vertrag muss nach dem Beginn des laufenden Vertrags starten")
        v.gueltig_bis = daten.gueltig_ab - timedelta(days=1)
        session.add(v)
    neu = Vertrag(mitarbeiter_id=id, **daten.model_dump())
    session.add(neu)
    session.commit()
    session.refresh(neu)
    return neu


@router.put("/vertraege/{id}")
def vertrag_aendern(id: int, daten: VertragIn, session: Session = Depends(get_session)):
    v = _404(session.get(Vertrag, id), "Vertrag")
    if daten.gueltig_bis and daten.gueltig_bis < daten.gueltig_ab:
        raise HTTPException(422, "Gültig bis liegt vor Gültig ab")
    for k, wert in daten.model_dump().items():
        setattr(v, k, wert)
    session.add(v)
    session.commit()
    session.refresh(v)
    return v


@router.put("/mitarbeiter/{id}/skills")
def skills_setzen(id: int, daten: list[SkillZuordnungIn], session: Session = Depends(get_session)):
    _404(session.get(Mitarbeiter, id), "Mitarbeiter")
    for alt in session.exec(select(MitarbeiterSkill).where(MitarbeiterSkill.mitarbeiter_id == id)).all():
        session.delete(alt)
    for s in daten:
        if not 1 <= s.level <= 3:
            raise HTTPException(422, "Level muss zwischen 1 und 3 liegen")
        _404(session.get(Skill, s.skill_id), "Skill")
        session.add(MitarbeiterSkill(mitarbeiter_id=id, **s.model_dump()))
    session.commit()
    return session.exec(select(MitarbeiterSkill).where(MitarbeiterSkill.mitarbeiter_id == id)).all()


# ---------------------------------------------------------------- Abwesenheiten
@router.get("/abwesenheiten")
def abwesenheiten(von: date, bis: date, mitarbeiter_id: Optional[int] = None,
                  session: Session = Depends(get_session)):
    q = select(Abwesenheit).where(Abwesenheit.von <= bis, Abwesenheit.bis >= von)
    if mitarbeiter_id:
        q = q.where(Abwesenheit.mitarbeiter_id == mitarbeiter_id)
    return session.exec(q.order_by(Abwesenheit.von)).all()


def _abwesenheit_pruefen(daten: AbwesenheitIn, session: Session) -> None:
    if daten.bis < daten.von:
        raise HTTPException(422, "Bis-Datum liegt vor dem Von-Datum")
    _404(session.get(Mitarbeiter, daten.mitarbeiter_id), "Mitarbeiter")


@router.post("/abwesenheiten")
def abwesenheit_anlegen(daten: AbwesenheitIn, session: Session = Depends(get_session)):
    _abwesenheit_pruefen(daten, session)
    a = Abwesenheit(**daten.model_dump())
    session.add(a)
    session.flush()
    warnungen = _abwesenheit_warnungen(session, a)
    session.commit()
    session.refresh(a)
    return {"abwesenheit": a, "warnungen": warnungen}


@router.put("/abwesenheiten/{id}")
def abwesenheit_aendern(id: int, daten: AbwesenheitIn, session: Session = Depends(get_session)):
    a = _404(session.get(Abwesenheit, id), "Abwesenheit")
    _abwesenheit_pruefen(daten, session)
    for k, v in daten.model_dump().items():
        setattr(a, k, v)
    session.add(a)
    session.flush()
    warnungen = _abwesenheit_warnungen(session, a)
    session.commit()
    session.refresh(a)
    return {"abwesenheit": a, "warnungen": warnungen}


@router.delete("/abwesenheiten/{id}")
def abwesenheit_loeschen(id: int, session: Session = Depends(get_session)):
    session.delete(_404(session.get(Abwesenheit, id), "Abwesenheit"))
    session.commit()
    return {"ok": True}


# ---------------------------------------------------------------- Kalender
@router.get("/kalender")
def kalender(jahr: int, session: Session = Depends(get_session)):
    eintraege = session.exec(select(Kalendereintrag).where(
        Kalendereintrag.datum >= date(jahr, 1, 1), Kalendereintrag.datum <= date(jahr, 12, 31)
    ).order_by(Kalendereintrag.datum)).all()
    return {
        "jahr": jahr, "bundesland": BUNDESLAND,
        "feiertage": [{"datum": d, "name": n} for d, n in feiertage(jahr).items()],
        "eintraege": eintraege,
    }


@router.post("/kalender/eintraege")
def kalendereintrag_anlegen(daten: KalendereintragIn, session: Session = Depends(get_session)):
    e = Kalendereintrag(**daten.model_dump(), quelle="manuell")
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


@router.put("/kalender/eintraege/{id}")
def kalendereintrag_aendern(id: int, daten: KalendereintragIn, session: Session = Depends(get_session)):
    e = _404(session.get(Kalendereintrag, id), "Kalendereintrag")
    for k, v in daten.model_dump().items():
        setattr(e, k, v)
    e.quelle = "manuell"
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


@router.delete("/kalender/eintraege/{id}")
def kalendereintrag_loeschen(id: int, session: Session = Depends(get_session)):
    session.delete(_404(session.get(Kalendereintrag, id), "Kalendereintrag"))
    session.commit()
    return {"ok": True}


@router.post("/kalender/hotdays-vorschlagen")
def hotdays_vorschlagen(jahr: int, session: Session = Depends(get_session)):
    alte = session.exec(select(Kalendereintrag).where(
        Kalendereintrag.quelle == "auto", Kalendereintrag.datum >= date(jahr, 1, 1),
        Kalendereintrag.datum <= date(jahr, 12, 31))).all()
    for e in alte:
        session.delete(e)
    manuell = {e.datum for e in session.exec(select(Kalendereintrag).where(
        Kalendereintrag.typ == "hotday", Kalendereintrag.datum >= date(jahr, 1, 1),
        Kalendereintrag.datum <= date(jahr, 12, 31))).all()}
    neu = 0
    for v in hotday_vorschlaege(jahr):
        if v["datum"] not in manuell:
            session.add(Kalendereintrag(typ="hotday", quelle="auto", **v))
            neu += 1
    session.commit()
    return {"jahr": jahr, "erzeugt": neu}


# ---------------------------------------------------------------- Dashboard & Admin
@router.get("/dashboard")
def dashboard(session: Session = Depends(get_session)):
    heute = stichtag_heute()
    mitarbeiter = session.exec(select(Mitarbeiter)).all()
    namen = {m.id: f"{m.vorname} {m.nachname}" for m in mitarbeiter}
    aktiv = [m for m in mitarbeiter if m.status == "aktiv" and (m.austritt is None or m.austritt >= heute)]
    abwesend = session.exec(select(Abwesenheit).where(
        Abwesenheit.von <= heute, Abwesenheit.bis >= heute, Abwesenheit.status == "genehmigt")).all()

    ft = {**feiertage(heute.year), **feiertage(heute.year + 1)}
    naechste_ft = [{"datum": d, "name": n} for d, n in ft.items() if d >= heute][:4]
    hotdays = session.exec(select(Kalendereintrag).where(
        Kalendereintrag.typ == "hotday", Kalendereintrag.datum >= heute
    ).order_by(Kalendereintrag.datum).limit(5)).all()

    skills = {s.id: s for s in session.exec(select(Skill)).all()}
    zert = session.exec(select(MitarbeiterSkill).where(
        MitarbeiterSkill.zertifikat_bis != None,  # noqa: E711
        MitarbeiterSkill.zertifikat_bis <= heute + timedelta(days=60))).all()

    def paletten(von: date, bis: date) -> int:
        return session.exec(select(func.coalesce(func.sum(Wareneingang.paletten), 0)).where(
            Wareneingang.datum >= von, Wareneingang.datum <= bis)).one()

    mo = heute - timedelta(days=heute.weekday())
    vertragsarten: dict[str, int] = {}
    for m in aktiv:
        v = aktueller_vertrag(session.exec(select(Vertrag).where(Vertrag.mitarbeiter_id == m.id)).all(), heute)
        if v:
            vertragsarten[v.art] = vertragsarten.get(v.art, 0) + 1
    return {
        "stichtag": heute,
        "mitarbeiter_gesamt": len(mitarbeiter),
        "mitarbeiter_aktiv": len(aktiv),
        "abwesend_heute": [{"mitarbeiter_id": a.mitarbeiter_id, "name": namen.get(a.mitarbeiter_id, "?"),
                            "typ": a.typ, "bis": a.bis} for a in abwesend],
        "naechste_feiertage": naechste_ft,
        "naechste_hotdays": hotdays,
        "ablaufende_zertifikate": [{"mitarbeiter_id": z.mitarbeiter_id, "name": namen.get(z.mitarbeiter_id, "?"),
                                    "skill": skills[z.skill_id].name, "zertifikat_bis": z.zertifikat_bis,
                                    "abgelaufen": z.zertifikat_bis < heute} for z in zert],
        "offene_urlaubsantraege": session.exec(select(func.count()).select_from(Abwesenheit).where(
            Abwesenheit.status == "beantragt")).one(),
        "paletten_diese_woche": paletten(mo, heute),
        "paletten_vorwoche": paletten(mo - timedelta(days=7), mo - timedelta(days=1)),
        "stundenkonto_summe": round(sum(m.stundenkonto for m in aktiv), 2),
        "vertragsarten": vertragsarten,
    }


@router.post("/admin/demodaten")
def demodaten(session: Session = Depends(get_session)):
    return seed.generate(session)
