def test_stammdaten(client):
    d = client.get("/api/stammdaten").json()
    assert len(d["abteilungen"]) == 8
    assert len(d["warengruppen"]) == 7
    assert any(r["schluessel"] == "ruhezeit_std" for r in d["regelparameter"])


def test_mitarbeiter_liste_und_sonderfaelle(client):
    ma = client.get("/api/mitarbeiter").json()
    assert len(ma) == 30
    assert sum(m["minderjaehrig"] for m in ma) == 1
    assert any(m["status"] == "mutterschutz" for m in ma)
    assert all(m["vertrag"] for m in ma)


def test_mitarbeiter_anlegen_und_doppelte_persnr(client):
    neu = {"persnr": "9001", "vorname": "Test", "nachname": "Eichhorn", "geburtsdatum": "1990-05-01",
           "eintritt": "2026-10-01", "vertrag": {"art": "teilzeit", "gueltig_ab": "2026-10-01", "soll_std_woche": 25}}
    r = client.post("/api/mitarbeiter", json=neu)
    assert r.status_code == 200, r.text
    mid = r.json()["id"]
    assert client.post("/api/mitarbeiter", json=neu).status_code == 409
    v = client.post(f"/api/mitarbeiter/{mid}/vertraege",
                    json={"art": "vollzeit", "gueltig_ab": "2026-11-01", "soll_std_woche": 40}).json()
    detail = client.get(f"/api/mitarbeiter/{mid}").json()
    assert len(detail["vertraege"]) == 2
    alt = [x for x in detail["vertraege"] if x["id"] != v["id"]][0]
    assert alt["gueltig_bis"] == "2026-10-31"


def test_urlaubssperre_warnung(client):
    r = client.post("/api/abwesenheiten", json={"mitarbeiter_id": 1, "von": "2026-12-21", "bis": "2026-12-23",
                                                 "typ": "urlaub", "status": "beantragt"})
    assert r.status_code == 200
    assert any("Urlaubssperre" in w for w in r.json()["warnungen"])
    assert client.post("/api/abwesenheiten", json={"mitarbeiter_id": 1, "von": "2026-12-23", "bis": "2026-12-21",
                                                    "typ": "urlaub"}).status_code == 422


def test_kalender_und_dashboard(client):
    k = client.get("/api/kalender?jahr=2026").json()
    assert len(k["feiertage"]) == 12 and k["bundesland"] == "BW"
    d = client.get("/api/dashboard").json()
    assert d["mitarbeiter_aktiv"] >= 25
    assert d["abwesend_heute"]
    assert any(z["skill"] == "Ameise/Staplerschein" for z in d["ablaufende_zertifikate"])
    assert d["paletten_vorwoche"] > 0
