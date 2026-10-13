"""Auto-Planung: synthetisches Szenario (ohne DB), Mock-Woche KW 42, gesperrte Einsätze, API."""
import time
from datetime import date, timedelta

import pytest
from sqlmodel import select

from app.models import Abteilung, Abwesenheit, Einsatz, Mitarbeiter, MitarbeiterSkill, Plan, Skill, Vertrag
from app.regeln import PlanKontext, pruefe
from app.solver import auto_planen
from app.solver.bericht import bericht
from app.solver.modell import ANZAHL_SLOTS, Modell, als_einsatz

# ---------------------------------------------------------------- synthetisches Szenario (ohne Datenbank)
MO = date(2027, 6, 14)  # Woche ohne Feiertag
DI = MO + timedelta(days=1)
TRO, TK, GET = 1, 2, 3


def _slots(von: str, bis: str, koepfe: int = 1) -> list[int]:
    a = (int(von[:2]) * 60 + int(von[3:]) - 300) // 30
    b = (int(bis[:2]) * 60 + int(bis[3:]) - 300) // 30
    return [koepfe if a <= i < b else 0 for i in range(ANZAHL_SLOTS)]


def _kontext(abwesenheiten=()) -> PlanKontext:
    abt = {TRO: Abteilung(id=TRO, name="Trockensortiment", kuerzel="TRO", farbe="#000"),
           TK: Abteilung(id=TK, name="Tiefkühl", kuerzel="TK", farbe="#000"),
           GET: Abteilung(id=GET, name="Getränke", kuerzel="GET", farbe="#000")}
    skills = {1: Skill(id=1, name="Verräumen Trocken", kategorie="verraeumen", abteilung_id=TRO),
              2: Skill(id=2, name="Verräumen Tiefkühl", kategorie="verraeumen", abteilung_id=TK),
              3: Skill(id=3, name="Verräumen Getränke", kategorie="verraeumen", abteilung_id=GET)}
    ma = {i: Mitarbeiter(id=i, persnr=str(i), vorname="Test", nachname=f"M{i}", geburtsdatum=date(1990, 1, 1),
                         eintritt=date(2020, 1, 1), stammabteilung_id=TRO) for i in (1, 2)}
    vertraege = {i: [Vertrag(mitarbeiter_id=i, art="teilzeit", gueltig_ab=date(2020, 1, 1), soll_std_woche=16,
                             max_tage_woche=5)] for i in (1, 2)}
    ms = {1: [MitarbeiterSkill(mitarbeiter_id=1, skill_id=1, level=3)],
          2: [MitarbeiterSkill(mitarbeiter_id=2, skill_id=1, level=2), MitarbeiterSkill(mitarbeiter_id=2, skill_id=3)]}
    abw: dict[int, list] = {}
    for a in abwesenheiten:
        abw.setdefault(a.mitarbeiter_id, []).append(a)
    return PlanKontext(von=MO, bis=MO + timedelta(days=5), mitarbeiter=ma, vertraege=vertraege, skills=ms,
                       skill_info=skills, abteilungen=abt, abwesenheiten=abw)


def _loesen(k: PlanKontext, bedarf: dict, gewichte=None):
    tage = [t for t in (MO + timedelta(days=i) for i in range(6)) if any(sum(v) for (d, _), v in bedarf.items() if d == t)]
    m = Modell(k, bedarf, [], gewichte or {}, tage)
    erg = m.loesen(zeitlimit_s=5, num_workers=4)
    einsaetze = [als_einsatz(c, 1) for c in erg.gewaehlt]
    zeilen, abdeckung = bericht(m, einsaetze, k.von, k.bis)
    return erg, einsaetze, zeilen, abdeckung


def test_synthetisch_bedarf_deckbar():
    bedarf = {(MO, TRO): _slots("08:00", "16:30"), (DI, TRO): _slots("06:00", "12:00", 2)}
    erg, einsaetze, zeilen, abdeckung = _loesen(_kontext(), bedarf, {"soll_abweichung": 0})
    assert erg.status == "OPTIMAL"
    assert abdeckung == 1.0
    assert not [z for z in zeilen if z["art"] == "unterdeckung"]
    # Mo eine Person 08:00–16:30 (8 h netto + 30 min Pause), Di zwei Personen 06–12 Uhr
    mo = [e for e in einsaetze if e.datum == MO]
    di = [e for e in einsaetze if e.datum == DI]
    assert len(mo) == 1 and (mo[0].beginn, mo[0].pause_min) == ("08:00", 30)
    assert len(di) == 2 and {(e.beginn, e.ende) for e in di} == {("06:00", "12:00")}
    assert all(e.abteilung_id == TRO and e.quelle == "auto" for e in einsaetze)
    # Gegenprüfung: keine harten Verstöße
    k = _kontext()
    k2 = PlanKontext(von=k.von, bis=k.bis, einsaetze=einsaetze, mitarbeiter=k.mitarbeiter, vertraege=k.vertraege,
                     skills=k.skills, skill_info=k.skill_info, abteilungen=k.abteilungen)
    assert not [v for v in pruefe(k2) if v.schwere == "hart"]


def test_synthetisch_ursachen():
    urlaub = Abwesenheit(mitarbeiter_id=2, von=MO, bis=MO, typ="urlaub", status="genehmigt")
    bedarf = {(MO, TRO): _slots("08:00", "12:00"), (MO, TK): _slots("06:00", "09:30"),
              (MO, GET): _slots("06:00", "10:00")}
    erg, einsaetze, zeilen, abdeckung = _loesen(_kontext([urlaub]), bedarf)
    unter = {z["abteilung_id"]: z for z in zeilen if z["art"] == "unterdeckung"}
    assert set(unter) == {TK, GET}
    assert unter[TK]["stunden"] == 3.5
    assert unter[TK]["meldung"].startswith("Tiefkühl Mo 3,5 h unterdeckt")
    assert "kein Mitarbeiter mit Skill Verräumen Tiefkühl" in unter[TK]["meldung"]
    assert "kein verfügbarer Mitarbeiter mit Skill Verräumen Getränke" in unter[GET]["meldung"]
    assert "Urlaub" in unter[GET]["meldung"]
    assert all(e.mitarbeiter_id == 1 for e in einsaetze)  # Mitarbeiter 2 ist im Urlaub
    assert 0 < abdeckung < 1


def test_synthetisch_ruhezeit_und_tage():
    """Spät am Montag und früh am Dienstag ist für dieselbe Person unzulässig (Ruhezeit 11 h)."""
    k = _kontext()
    k.mitarbeiter.pop(2)
    bedarf = {(MO, TRO): _slots("18:00", "21:30"), (DI, TRO): _slots("05:00", "08:00")}
    erg, einsaetze, zeilen, _ = _loesen(k, bedarf)
    assert len(einsaetze) == 1
    assert any(z["art"] == "unterdeckung" for z in zeilen)


# ---------------------------------------------------------------- Datenbank: Mock-Woche & eigener Plan
def _mock_entwurf(session) -> Plan:
    return session.exec(select(Plan).where(Plan.status == "entwurf", Plan.quelle == "mock")).one()


@pytest.fixture()
def mock_woche(session):
    """KW 42 sichern und nach dem Test exakt wiederherstellen (test_planung erwartet die Mock-Verstöße)."""
    plan = _mock_entwurf(session)
    sicherung = [e.model_dump() for e in session.exec(select(Einsatz).where(Einsatz.plan_id == plan.id)).all()]
    yield plan
    session.rollback()
    for e in session.exec(select(Einsatz).where(Einsatz.plan_id == plan.id)).all():
        session.delete(e)
    session.commit()
    session.add_all(Einsatz(**d) for d in sicherung)
    session.commit()


def test_mock_woche_neu(session, mock_woche):
    vorher = len(session.exec(select(Einsatz).where(Einsatz.plan_id == mock_woche.id)).all())
    t = time.monotonic()
    erg = auto_planen(session, mock_woche.id, "neu", zeitlimit_s=20)
    assert time.monotonic() - t < 35
    assert erg["solver_status"] in ("OPTIMAL", "FEASIBLE")
    harte = [v["meldung"] for v in erg["verstoesse"] if v["schwere"] == "hart"]
    assert not harte, harte
    assert erg["abdeckung"] > 0.8
    assert erg["einsaetze_entfernt"] == vorher and erg["einsaetze_neu"] > 50
    assert set(erg) == {"einsaetze_neu", "einsaetze_entfernt", "solver_status", "zielwert", "laufzeit_s",
                        "abdeckung", "bericht", "verstoesse"}
    for z in erg["bericht"]:
        assert set(z) == {"datum", "abteilung_id", "art", "stunden", "meldung"} and z["art"] in (
            "unterdeckung", "ueberdeckung", "hinweis")
    neu = session.exec(select(Einsatz).where(Einsatz.plan_id == mock_woche.id)).all()
    assert all(e.quelle == "auto" for e in neu) and len(neu) == erg["einsaetze_neu"]


def test_mock_woche_umplanen(session, mock_woche):
    erg = auto_planen(session, mock_woche.id, "umplanen", zeitlimit_s=8)
    assert erg["einsaetze_entfernt"] >= 4  # eingebaute Verstöße (Ruhezeit, Urlaub, Skill, JArbSchG …)
    assert not [v for v in erg["verstoesse"] if v["schwere"] == "hart"]
    assert any(z["art"] == "hinweis" and "entfernt" in z["meldung"] for z in erg["bericht"])


@pytest.fixture()
def eigener_plan(session):
    von = date(2027, 6, 28)  # KW 26/2027
    plan = Plan(name="Solver-Test", von=von, bis=von + timedelta(days=5))
    session.add(plan)
    session.commit()
    session.refresh(plan)
    yield plan
    session.rollback()
    for e in session.exec(select(Einsatz).where(Einsatz.plan_id == plan.id)).all():
        session.delete(e)
    session.delete(session.get(Plan, plan.id))
    session.commit()


def test_gesperrter_einsatz_bleibt(session, eigener_plan):
    # Kassen-Mitarbeiter mit gültigem Vertrag am Montag
    tag = eigener_plan.von
    kasse = session.exec(select(Abteilung).where(Abteilung.kuerzel == "KAS")).one()
    mid = next(m.id for m in session.exec(select(Mitarbeiter).where(Mitarbeiter.status == "aktiv")).all()
               if session.exec(select(MitarbeiterSkill).join(Skill, Skill.id == MitarbeiterSkill.skill_id).where(
                   MitarbeiterSkill.mitarbeiter_id == m.id, Skill.abteilung_id == kasse.id)).first()
               and "0" in session.exec(select(Vertrag).where(Vertrag.mitarbeiter_id == m.id)).all()[-1].erlaubte_tage
               and (2027 - m.geburtsdatum.year) > 19)
    fest = Einsatz(plan_id=eigener_plan.id, mitarbeiter_id=mid, abteilung_id=kasse.id, datum=tag,
                   beginn="09:00", ende="15:00", pause_min=0, gesperrt=True)
    session.add(fest)
    session.commit()
    fest_id = fest.id
    erg = auto_planen(session, eigener_plan.id, "neu", zeitlimit_s=6)
    assert erg["solver_status"] in ("OPTIMAL", "FEASIBLE") and erg["einsaetze_neu"] > 0
    session.expire_all()
    e = session.get(Einsatz, fest_id)
    assert e is not None and e.gesperrt and (e.beginn, e.ende, e.mitarbeiter_id) == ("09:00", "15:00", mid)
    am_tag = session.exec(select(Einsatz).where(Einsatz.plan_id == eigener_plan.id, Einsatz.datum == tag,
                                                Einsatz.mitarbeiter_id == mid)).all()
    assert len(am_tag) == 1
    assert not [v for v in erg["verstoesse"] if v["schwere"] == "hart"]
    # Lücken füllen: alle Einsätze bleiben erhalten
    anzahl = len(session.exec(select(Einsatz).where(Einsatz.plan_id == eigener_plan.id)).all())
    erg2 = auto_planen(session, eigener_plan.id, "luecken", zeitlimit_s=3)
    assert erg2["einsaetze_entfernt"] == 0
    assert len(session.exec(select(Einsatz).where(Einsatz.plan_id == eigener_plan.id)).all()) == anzahl + erg2["einsaetze_neu"]


# ---------------------------------------------------------------- API
def test_api_gewichte(client):
    g = client.get("/api/solver/gewichte").json()
    assert g == {"unterdeckung": 100, "soll_abweichung": 8, "ueberdeckung": 3, "fremdabteilung": 2,
                 "fairness": 5, "skill_level": 1}


def test_api_fehler(client, session):
    freigegeben = session.exec(select(Plan).where(Plan.status == "freigegeben")).first()
    r = client.post(f"/api/plaene/{freigegeben.id}/auto-planen", json={"modus": "neu"})
    assert r.status_code == 409 and "Entwurf" in r.json()["detail"]
    assert client.post("/api/plaene/999999/auto-planen", json={"modus": "neu"}).status_code == 404
    entwurf = _mock_entwurf(session)
    assert client.post(f"/api/plaene/{entwurf.id}/auto-planen", json={"modus": "quatsch"}).status_code == 422
    assert client.post(f"/api/plaene/{entwurf.id}/auto-planen",
                       json={"modus": "neu", "gewichte": {"unbekannt": 1}}).status_code == 422
    assert client.get("/api/solver/jobs/gibtsnicht").status_code == 404


def test_api_job(client, eigener_plan):
    r = client.post(f"/api/plaene/{eigener_plan.id}/auto-planen",
                    json={"modus": "neu", "gewichte": {"fairness": 0}, "zeitlimit_s": 2})
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["status"] == "laeuft" and job["plan_id"] == eigener_plan.id and 0 <= job["fortschritt"] <= 1
    # zweiter Start während des Laufs → 409
    assert client.post(f"/api/plaene/{eigener_plan.id}/auto-planen", json={"modus": "neu"}).status_code == 409
    for _ in range(200):
        job = client.get(f"/api/solver/jobs/{job['job_id']}").json()
        if job["status"] != "laeuft":
            break
        time.sleep(0.2)
    assert job["status"] == "fertig", job["meldung"]
    assert job["fortschritt"] == 1 and job["ergebnis"]["einsaetze_neu"] > 0
    assert client.get(f"/api/plaene/{eigener_plan.id}/einsaetze").status_code == 200
