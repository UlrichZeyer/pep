"""Planungs-API: Durchstich Plan → Einsatz → Verstoß → Validierung → Freigabe; Mock-Pläne."""
from sqlmodel import select

from app.models import Aenderungslog

VON, BIS = "2027-06-07", "2027-06-12"  # Woche ohne Feiertag, weit weg von Mock-/Solver-Plänen


def _mitarbeiter_mit_skill(client):
    """Erwachsene/r, aktive/r Vollzeitkraft mit vollem Zeitfenster und einem Abteilungs-Skill."""
    skills = {s["id"]: s for s in client.get("/api/stammdaten").json()["skills"]}
    for m in client.get("/api/mitarbeiter?stichtag=2027-06-07").json():
        v = m["vertrag"]
        if m["status"] != "aktiv" or m["minderjaehrig"] or not v or v["art"] != "vollzeit":
            continue
        if v["erlaubte_tage"] != "012345" or v["frueheste_zeit"] != "05:00" or v["spaeteste_zeit"] != "21:45":
            continue
        abt = [skills[s["skill_id"]]["abteilung_id"] for s in m["skills"] if skills[s["skill_id"]]["abteilung_id"]]
        if abt:
            return m["id"], abt[0]
    raise AssertionError("kein passender Mitarbeiter")


def test_regelkatalog(client):
    r = client.get("/api/regeln").json()
    assert {"ARBZG_5_RUHEZEIT", "JARBSCHG", "VERTRAG_SOLL", "UEBERSCHNEIDUNG"} <= {x["code"] for x in r}
    assert all(set(x) == {"code", "name", "quelle", "schwere"} for x in r)


def test_mock_plaene(client):
    plaene = client.get("/api/plaene").json()
    mock = [p for p in plaene if p["quelle"] == "mock"]
    assert len(mock) == 5
    freigegeben = [p for p in mock if p["status"] == "freigegeben"]
    entwurf = [p for p in mock if p["status"] == "entwurf"]
    assert len(freigegeben) == 4 and len(entwurf) == 1
    assert entwurf[0]["von"] == "2026-10-12" and entwurf[0]["name"] == "KW 42/2026"
    for p in freigegeben:
        assert p["anzahl_einsaetze"] > 50
        val = client.post(f"/api/plaene/{p['id']}/validieren").json()
        assert val["zusammenfassung"]["hart"] == 0, [v["meldung"] for v in val["verstoesse"] if v["schwere"] == "hart"]
    einsaetze = client.get(f"/api/plaene/{freigegeben[0]['id']}/einsaetze").json()
    assert all(e["stunden"] > 0 for e in einsaetze)
    assert sum(e["ist_paletten"] or 0 for e in einsaetze) > 0
    assert min(e["beginn"] for e in einsaetze) == "05:00"
    val = client.post(f"/api/plaene/{entwurf[0]['id']}/validieren").json()
    harte = {v["regel"] for v in val["verstoesse"] if v["schwere"] == "hart"}
    assert len(harte) >= 4 and {"ARBZG_5_RUHEZEIT", "JARBSCHG", "ABWESENHEIT", "SKILL"} <= harte
    # Mutterschutz wird nie eingeplant
    ms = [m["id"] for m in client.get("/api/mitarbeiter").json() if m["status"] == "mutterschutz"]
    for p in mock:
        assert not [e for e in client.get(f"/api/plaene/{p['id']}/einsaetze").json() if e["mitarbeiter_id"] in ms]
    # Zeitraumfilter
    assert [p["id"] for p in client.get("/api/plaene?von=2026-10-14&bis=2026-10-14").json()] == [entwurf[0]["id"]]
    # Freigabe des Entwurfs scheitert an harten Verstößen
    r = client.put(f"/api/plaene/{entwurf[0]['id']}", json={"status": "freigegeben"})
    assert r.status_code == 409 and "harte Regelverstöße" in r.json()["detail"]


def test_durchstich(client, session):
    r = client.post("/api/plaene", json={"von": VON, "bis": BIS})
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["name"] == "KW 23/2027" and plan["status"] == "entwurf" and plan["anzahl_einsaetze"] == 0
    pid = plan["id"]
    assert client.post("/api/plaene", json={"von": "2027-06-10", "bis": "2027-06-20"}).status_code == 409
    assert client.post("/api/plaene", json={"von": BIS, "bis": VON}).status_code == 422

    mid, abt = _mitarbeiter_mit_skill(client)
    basis = {"mitarbeiter_id": mid, "abteilung_id": abt}
    # Eingabevalidierung
    for fehler in ({"datum": "2027-06-07", "beginn": "06:10", "ende": "12:00"},
                   {"datum": "2027-06-07", "beginn": "12:00", "ende": "12:00"},
                   {"datum": "2027-06-13", "beginn": "08:00", "ende": "12:00"},
                   {"datum": "2027-06-07", "beginn": "8:00", "ende": "12:00"}):
        r = client.post(f"/api/plaene/{pid}/einsaetze", json={**basis, **fehler})
        assert r.status_code == 422 and isinstance(r.json()["detail"], str), r.text

    # Spätdienst Mo + Frühdienst Di → Ruhezeitverstoß
    r = client.post(f"/api/plaene/{pid}/einsaetze", json={**basis, "datum": "2027-06-07", "beginn": "13:00", "ende": "21:45"})
    assert r.status_code == 200, r.text
    spaet = r.json()["einsatz"]
    assert spaet["pause_min"] == 30 and spaet["stunden"] == 8.25 and spaet["quelle"] == "manuell"
    r = client.post(f"/api/plaene/{pid}/einsaetze", json={**basis, "datum": "2027-06-08", "beginn": "05:00", "ende": "11:00"})
    frueh = r.json()
    assert frueh["einsatz"]["pause_min"] == 0
    ruhe = [v for v in frueh["verstoesse"] if v["regel"] == "ARBZG_5_RUHEZEIT"]
    assert ruhe and ruhe[0]["schwere"] == "hart" and frueh["einsatz"]["id"] in ruhe[0]["einsatz_ids"]
    assert all(v["mitarbeiter_id"] == mid for v in frueh["verstoesse"])

    val = client.post(f"/api/plaene/{pid}/validieren").json()
    assert val["zusammenfassung"]["hart"] >= 1
    r = client.put(f"/api/plaene/{pid}", json={"status": "freigegeben"})
    assert r.status_code == 409 and "Ruhezeit" in r.json()["detail"]

    # Partielle Änderung: Beginn später → Verstoß behoben, Pause neu bestimmt
    r = client.put(f"/api/einsaetze/{frueh['einsatz']['id']}", json={"beginn": "09:00", "ende": "16:00"})
    assert r.status_code == 200, r.text
    assert r.json()["einsatz"]["pause_min"] == 30
    assert not [v for v in r.json()["verstoesse"] if v["regel"] == "ARBZG_5_RUHEZEIT"]
    assert client.put(f"/api/einsaetze/{frueh['einsatz']['id']}", json={"datum": "2027-06-20"}).status_code == 422
    r = client.put(f"/api/einsaetze/{frueh['einsatz']['id']}", json={"gesperrt": True})
    assert r.json()["einsatz"]["gesperrt"] is True and r.json()["einsatz"]["beginn"] == "09:00"

    # Statusfolge
    assert client.put(f"/api/plaene/{pid}", json={"status": "veroeffentlicht"}).status_code == 409
    assert client.put(f"/api/plaene/{pid}", json={"status": "freigegeben"}).json()["status"] == "freigegeben"
    assert client.put(f"/api/plaene/{pid}", json={"status": "veroeffentlicht"}).json()["status"] == "veroeffentlicht"
    # Änderungen im veröffentlichten Plan sind erlaubt und werden protokolliert
    r = client.delete(f"/api/einsaetze/{spaet['id']}")
    assert r.status_code == 200 and r.json()["ok"] is True
    log = session.exec(select(Aenderungslog).where(Aenderungslog.entitaet == "einsatz",
                                                   Aenderungslog.entitaet_id == spaet["id"])).all()
    assert [x.aktion for x in log] == ["angelegt", "geloescht"]
    assert client.put(f"/api/plaene/{pid}", json={"status": "entwurf", "name": "Juni"}).json()["name"] == "Juni"
    assert client.get(f"/api/plaene/{pid}").json()["anzahl_einsaetze"] == 1

    assert client.delete(f"/api/plaene/{pid}").json() == {"ok": True}
    assert client.get(f"/api/plaene/{pid}").status_code == 404
