"""Tests KPI-Endpunkte (eigene Testpläne, unabhängig von seed_plaene)."""
from datetime import date, datetime, timezone

import pytest
from sqlmodel import select

from app.models import Abteilung, Einsatz, Mitarbeiter, Plan, Skill


@pytest.fixture()
def testplan(session):
    """Freigegebener Plan in einer Woche ohne Mock-Pläne mit einigen Einsätzen."""
    abt = {a.kuerzel: a for a in session.exec(select(Abteilung)).all()}
    ma = session.exec(select(Mitarbeiter).where(Mitarbeiter.status == "aktiv")).all()[:4]
    plan = Plan(name="Testplan KPI", von=date(2026, 7, 6), bis=date(2026, 7, 11),
                status="freigegeben", quelle="test",
                erstellt_am=datetime.now(timezone.utc))
    session.add(plan)
    session.flush()
    einsaetze = [
        Einsatz(plan_id=plan.id, mitarbeiter_id=ma[0].id, abteilung_id=abt["TRO"].id,
                datum=date(2026, 7, 6), beginn="05:00", ende="11:00", ist_paletten=9),
        Einsatz(plan_id=plan.id, mitarbeiter_id=ma[1].id, abteilung_id=abt["TRO"].id,
                datum=date(2026, 7, 7), beginn="05:00", ende="13:30", pause_min=30),
        Einsatz(plan_id=plan.id, mitarbeiter_id=ma[2].id, abteilung_id=abt["KAS"].id,
                datum=date(2026, 7, 6), beginn="07:00", ende="15:30", pause_min=30),
        Einsatz(plan_id=plan.id, mitarbeiter_id=ma[3].id, abteilung_id=abt["KAS"].id,
                datum=date(2026, 7, 6), beginn="13:00", ende="21:15", pause_min=30),
    ]
    session.add_all(einsaetze)
    session.commit()
    yield plan, ma, abt
    for e in session.exec(select(Einsatz).where(Einsatz.plan_id == plan.id)).all():
        session.delete(e)
    session.delete(plan)
    session.commit()


def test_bedarf_endpunkt(client):
    r = client.get("/api/bedarf", params={"von": "2026-10-19", "bis": "2026-10-25"})
    assert r.status_code == 200
    d = r.json()
    assert d["slot_min"] == 30 and len(d["tage"]) == 7
    assert client.get("/api/bedarf", params={"von": "2026-10-25", "bis": "2026-10-19"}).status_code == 400
    assert client.get("/api/bedarf", params={"von": "kaputt", "bis": "2026-10-19"}).status_code == 422


def test_prognose_endpunkt(client):
    r = client.get("/api/kpi/prognose", params={"von": "2026-10-19", "bis": "2026-10-24"})
    assert r.status_code == 200
    t = r.json()["tage"][0]
    assert set(t) == {"datum", "geschlossen", "lastfaktor", "hotday", "je_warengruppe", "gesamt"}
    assert t["gesamt"] > 0


def test_anlieferung(client):
    r = client.get("/api/kpi/anlieferung", params={"von": "2026-01-01", "bis": "2026-10-12"})
    assert r.status_code == 200
    d = r.json()
    assert len(d["reihe"]) > 200 and all(z["datum"] >= "2026-01-01" for z in d["reihe"])
    assert [m["monat"] for m in d["monate"]][:2] == ["2026-01", "2026-02"]
    assert sum(m["gesamt"] for m in d["monate"]) == sum(z["gesamt"] for z in d["reihe"])
    assert set(d["wochentagsmittel"]) == {"4", "8", "12"}
    for n in ("4", "8", "12"):
        zeilen = d["wochentagsmittel"][n]
        assert [z["wochentag"] for z in zeilen] == list(range(6))
        assert all(z["gesamt"] > 0 for z in zeilen)
        assert zeilen[5]["gesamt"] < zeilen[0]["gesamt"]  # Samstag < Montag


def test_abdeckung(client, testplan):
    plan, _, abt = testplan
    r = client.get("/api/kpi/abdeckung", params={"plan_id": plan.id})
    assert r.status_code == 200
    d = r.json()
    assert d["plan_id"] == plan.id and len(d["tage"]) == 6
    mo = d["tage"][0]
    tro = next(a for a in mo["abteilungen"] if a["abteilung_id"] == abt["TRO"].id)
    kas = next(a for a in mo["abteilungen"] if a["abteilung_id"] == abt["KAS"].id)
    assert tro["geplant_std"] == 6.0 and kas["geplant_std"] == 15.75
    assert tro["bedarf_std"] > 0 and 0 < tro["abdeckung"] < 1
    assert d["gesamt"]["geplant_std"] == 6.0 + 8.0 + 15.75
    assert abs(d["gesamt"]["bedarf_std"] - sum(t["bedarf_std"] for t in d["tage"])) < 0.1
    assert client.get("/api/kpi/abdeckung", params={"plan_id": 999999}).status_code == 404


def test_leistung(client, testplan):
    _, _, abt = testplan
    r = client.get("/api/kpi/leistung", params={"von": "2026-07-06", "bis": "2026-07-11"})
    assert r.status_code == 200
    zeilen = {z["abteilung_id"]: z for z in r.json()["abteilungen"]}
    tro = zeilen[abt["TRO"].id]
    assert tro["stunden"] == 14.0
    assert tro["paletten"] > 9  # 9 Ist-Paletten Mo + Wareneingang Di
    assert tro["pal_pro_h"] == round(tro["paletten"] / 14.0, 3)
    assert tro["soll_pal_pro_h"] == 1.5
    assert abt["KAS"].id not in zeilen


def test_stunden(client, testplan):
    _, ma, _ = testplan
    r = client.get("/api/kpi/stunden", params={"von": "2026-07-06", "bis": "2026-07-12"})
    assert r.status_code == 200
    zeilen = {z["mitarbeiter_id"]: z for z in r.json()["mitarbeiter"]}
    z = zeilen[ma[0].id]
    assert z["geplant_std"] >= 6.0
    assert z["soll_std"] > 0 and z["differenz"] == round(z["geplant_std"] - z["soll_std"], 2)
    assert z["vertragsart"] is not None


def test_personal(client, session):
    kern = {s.id for s in session.exec(select(Skill)).all() if s.kategorie in ("verraeumen", "kasse")}
    r = client.get("/api/kpi/personal")
    assert r.status_code == 200
    d = r.json()
    assert d["stichtag"] == "2026-10-13"
    assert 0.005 < d["krankenquote"] < 0.15
    assert len(d["urlaub"]) > 20
    for u in d["urlaub"]:
        assert u["rest"] == u["anspruch"] - u["genommen"] - u["geplant"]
    assert len(d["skill_abdeckung"]) == 12
    for s in d["skill_abdeckung"]:
        assert s["engpass"] == (s["anzahl"] <= 4 and s["skill_id"] in kern)
    assert all(s["anzahl_level3"] <= s["anzahl"] for s in d["skill_abdeckung"])
