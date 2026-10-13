"""Deterministischer Mockdaten-Generator (Seed 42). Siehe KONZEPT.md, Kapitel 4.3.

Aufruf: ``python -m app.seed`` oder ``POST /api/admin/demodaten``.
"""
import random
from datetime import date, timedelta

from sqlmodel import Session, SQLModel, delete

from app import seed_frequenz, seed_plaene
from app.db import engine, init_db
from app.kalender import feiertage, hotday_vorschlaege, ist_werktag
from app.models import (
    REGELPARAMETER_STANDARD, Abteilung, Abwesenheit, Aenderungslog, Einsatz, Kalendereintrag,
    Kundenfrequenz, Mitarbeiter, MitarbeiterSkill, Plan, Regelparameter, Schichtmodell, Skill,
    Vertrag, Warengruppe, Wareneingang,
)
from app.util import stichtag_heute

SEED = 42

ABTEILUNGEN = [
    # name, kuerzel, farbe, mindestbesetzung, von, bis, bedarfsart
    ("Trockensortiment", "TRO", "#C08A3E", 1, "05:00", "21:45", "paletten"),
    ("Obst & Gemüse", "OUG", "#6A9A3A", 1, "05:00", "21:45", "paletten"),
    ("Kühlung", "KUE", "#3B82B5", 1, "05:00", "21:45", "paletten"),
    ("Tiefkühl", "TK", "#5BB0C9", 0, "05:00", "21:45", "paletten"),
    ("Getränke", "GET", "#2F6F6A", 0, "05:00", "21:45", "paletten"),
    ("Aktionsware/Non-Food", "NF", "#8E5BA8", 0, "05:00", "21:45", "paletten"),
    ("Backstation", "BAC", "#D9A400", 1, "06:00", "20:00", "fix"),
    ("Kasse", "KAS", "#C2185B", 2, "06:30", "21:30", "frequenz"),
]

SKILLS = [
    # name, kategorie, hat_ablauf, abteilungs-kuerzel
    ("Verräumen Trocken", "verraeumen", False, "TRO"),
    ("Verräumen Obst & Gemüse", "verraeumen", False, "OUG"),
    ("Verräumen Kühlung", "verraeumen", False, "KUE"),
    ("Verräumen Tiefkühl", "verraeumen", False, "TK"),
    ("Verräumen Getränke", "verraeumen", False, "GET"),
    ("Verräumen Non-Food", "verraeumen", False, "NF"),
    ("Backstation", "sonstiges", False, "BAC"),
    ("Kasse", "kasse", False, "KAS"),
    ("Leergut/Flaschenautomat", "sonstiges", False, "GET"),
    ("Ameise/Staplerschein", "zertifikat", True, None),
    ("Hygieneschulung", "zertifikat", True, None),
    ("Schlüsselberechtigung", "sonstiges", False, None),
]

WARENGRUPPEN = [
    # name, abteilung, skill, Pal/h, Basis-Paletten/Tag
    ("Trockensortiment", "TRO", "Verräumen Trocken", 1.5, 9),
    ("Obst & Gemüse", "OUG", "Verräumen Obst & Gemüse", 1.4, 5),
    ("Molkereiprodukte", "KUE", "Verräumen Kühlung", 1.8, 5),
    ("Fleisch & Wurst", "KUE", "Verräumen Kühlung", 1.7, 3),
    ("Tiefkühl", "TK", "Verräumen Tiefkühl", 1.6, 3),
    ("Getränke", "GET", "Verräumen Getränke", 3.0, 7),
    ("Non-Food", "NF", "Verräumen Non-Food", 1.2, 3),
]
# Wochentagsprofil der Anlieferung (Mo … Sa)
WOCHENTAG_FAKTOR = [1.35, 0.95, 1.0, 1.3, 1.05, 0.55]

SCHICHTMODELLE = [
    ("Früh-Verräumung", "05:00", "11:00", 0),
    ("Früh", "06:00", "14:30", 30),
    ("Tag", "07:00", "15:30", 30),
    ("Mittel", "10:00", "18:30", 30),
    ("Spät", "13:30", "21:45", 30),
    ("Kurz Spät", "17:00", "21:15", 0),
]

VORNAMEN_W = ["Anna", "Julia", "Laura", "Sabine", "Petra", "Melanie", "Sandra", "Nicole", "Katrin",
              "Lena", "Sophie", "Marie", "Elif", "Fatma", "Ioana", "Claudia", "Heike", "Jana"]
VORNAMEN_M = ["Thomas", "Michael", "Stefan", "Andreas", "Jonas", "Lukas", "Felix", "Tim", "Marco",
              "Ahmet", "Dennis", "Kevin", "Florian", "Matthias", "Niklas", "Paul", "Sven", "Bernd"]
NACHNAMEN = ["Müller", "Schmid", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker",
             "Schulz", "Hoffmann", "Keller", "Bauer", "Koch", "Richter", "Klein", "Wolf", "Neumann",
             "Schwarz", "Zimmermann", "Braun", "Krüger", "Hofmann", "Hartmann", "Lange", "Werner",
             "Krause", "Lehmann", "Huber", "Kaiser", "Fuchs", "Vogel", "Yılmaz", "Kaya", "Popescu"]

# Belegschaftsprofil: (art, soll_std_woche, max_std_monat, max_tage, rolle, anzahl)
PROFIL = [
    ("vollzeit", 40, None, 5, "filialleitung", 1),
    ("vollzeit", 40, None, 5, "stellvertretung", 2),
    ("vollzeit", 40, None, 5, "verkaeufer", 5),
    ("teilzeit", 30, None, 5, "verkaeufer", 4),
    ("teilzeit", 25, None, 4, "verkaeufer", 4),
    ("teilzeit", 20, None, 4, "verkaeufer", 3),
    ("minijob", 10, 43, 3, "aushilfe", 7),
    ("werkstudent", 18, None, 3, "aushilfe", 1),
    ("azubi", 40, None, 5, "azubi", 3),
]


def _reset(session: Session) -> None:
    for tabelle in reversed(SQLModel.metadata.sorted_tables):
        session.exec(delete(tabelle))  # type: ignore[arg-type]
    session.commit()


def _stammdaten(session: Session) -> tuple[dict[str, Abteilung], dict[str, Skill]]:
    abt: dict[str, Abteilung] = {}
    for i, (name, k, farbe, mind, von, bis, art) in enumerate(ABTEILUNGEN):
        a = Abteilung(name=name, kuerzel=k, farbe=farbe, mindestbesetzung=mind,
                      arbeitszeit_von=von, arbeitszeit_bis=bis, bedarfsart=art, sortierung=i)
        session.add(a)
        abt[k] = a
    session.flush()
    skills: dict[str, Skill] = {}
    for name, kat, ablauf, k in SKILLS:
        s = Skill(name=name, kategorie=kat, hat_ablauf=ablauf,
                  abteilung_id=abt[k].id if k else None)
        session.add(s)
        skills[name] = s
    session.flush()
    for name, k, skill, leistung, _ in WARENGRUPPEN:
        session.add(Warengruppe(name=name, abteilung_id=abt[k].id, skill_id=skills[skill].id,
                                std_leistung_pal_h=leistung))
    for name, b, e, p in SCHICHTMODELLE:
        session.add(Schichtmodell(name=name, beginn=b, ende=e, pause_min=p))
    for k, (wert, beschr) in REGELPARAMETER_STANDARD.items():
        session.add(Regelparameter(schluessel=k, wert=wert, beschreibung=beschr))
    session.flush()
    return abt, skills


def _kalender(session: Session, heute: date) -> None:
    for jahr in (heute.year - 1, heute.year, heute.year + 1):
        for v in hotday_vorschlaege(jahr):
            session.add(Kalendereintrag(typ="hotday", quelle="auto", **v))
        # Inventur: letzter Samstag im Juni – Filiale normal geöffnet, hoher Personalbedarf
        t = date(jahr, 6, 30)
        while t.weekday() != 5:
            t -= timedelta(days=1)
        session.add(Kalendereintrag(datum=t, typ="sondertag", name="Inventur", lastfaktor=1.2,
                                    urlaubssperre=True, quelle="mock"))
    # Aktionswoche (manueller Hotday) in drei Wochen
    start = heute + timedelta(days=21 - heute.weekday())
    for i in range(3):
        session.add(Kalendereintrag(datum=start + timedelta(days=i), typ="hotday",
                                    name="Aktionswoche Grillsaison-Abverkauf", lastfaktor=1.25,
                                    quelle="mock"))


def _mitarbeiter(session: Session, rng: random.Random, heute: date,
                 abt: dict[str, Abteilung], skills: dict[str, Skill]) -> list[Mitarbeiter]:
    namen_benutzt: set[tuple[str, str]] = set()
    alle: list[Mitarbeiter] = []
    stamm_rotation = ["TRO", "KAS", "KUE", "OUG", "GET", "KAS", "TRO", "BAC", "KUE", "NF", "KAS", "OUG"]
    nr = 1001
    for art, soll, max_monat, max_tage, rolle, anzahl in PROFIL:
        for _ in range(anzahl):
            weiblich = rng.random() < 0.6
            while True:
                vn = rng.choice(VORNAMEN_W if weiblich else VORNAMEN_M)
                nn = rng.choice(NACHNAMEN)
                if (vn, nn) not in namen_benutzt:
                    namen_benutzt.add((vn, nn))
                    break
            if art == "azubi":
                alter_j = rng.randint(17, 21)
            elif art == "werkstudent":
                alter_j = rng.randint(21, 27)
            elif art == "minijob":
                alter_j = rng.choice([rng.randint(19, 25), rng.randint(45, 66)])
            else:
                alter_j = rng.randint(24, 60)
            geb = date(heute.year - alter_j, rng.randint(1, 12), rng.randint(1, 28))
            eintritt = heute - timedelta(days=rng.randint(60, 365 * min(15, alter_j - 16)))
            stamm = "TRO" if rolle in ("filialleitung", "stellvertretung") else stamm_rotation[len(alle) % len(stamm_rotation)]
            m = Mitarbeiter(persnr=str(nr), vorname=vn, nachname=nn, geburtsdatum=geb,
                            eintritt=eintritt, stammabteilung_id=abt[stamm].id, rolle=rolle,
                            stundenkonto=round(rng.uniform(-12, 18) * 4) / 4, quelle="mock")
            m._weiblich = weiblich  # type: ignore[attr-defined]
            nr += 1
            session.add(m)
            session.flush()
            erlaubte = "012345"
            frueh, spaet = "05:00", "21:45"
            if art == "minijob":
                tage = rng.sample(range(6), rng.choice([3, 4]))
                erlaubte = "".join(str(t) for t in sorted(tage))
                if rng.random() < 0.4:
                    frueh = "14:00"
            elif art == "werkstudent":
                erlaubte = "2345"
                frueh = "12:00"
            elif art == "teilzeit" and rng.random() < 0.4:
                # wiederkehrende Nichtverfügbarkeit, z. B. "dienstags nie"
                nie = rng.choice("01234")
                erlaubte = erlaubte.replace(nie, "")
                if rng.random() < 0.5:
                    spaet = "14:30"
            lohn = {"vollzeit": 16.5, "teilzeit": 15.0, "minijob": 13.9, "werkstudent": 14.5,
                    "azubi": 7.5}[art]
            if rolle == "filialleitung":
                lohn = 24.0
            elif rolle == "stellvertretung":
                lohn = 19.5
            session.add(Vertrag(
                mitarbeiter_id=m.id, art=art, gueltig_ab=eintritt, soll_std_woche=soll,
                max_std_monat=max_monat, max_tage_woche=max_tage, erlaubte_tage=erlaubte,
                frueheste_zeit=frueh, spaeteste_zeit=spaet,
                urlaubstage={"minijob": 12, "werkstudent": 14}.get(art, 28 if art != "teilzeit" else 26),
                stundenlohn=lohn))
            alle.append(m)
    session.flush()

    # Vertragshistorie für einige Teilzeitkräfte (früher Minijob)
    for m in alle[8:11]:
        v = session.get(Vertrag, m.id)  # erster Vertrag hat dieselbe Reihenfolge
        if v and v.mitarbeiter_id == m.id and (v.gueltig_ab < heute - timedelta(days=400)):
            wechsel = heute - timedelta(days=rng.randint(120, 380))
            session.add(Vertrag(mitarbeiter_id=m.id, art="minijob", gueltig_ab=v.gueltig_ab,
                                gueltig_bis=wechsel - timedelta(days=1), soll_std_woche=10,
                                max_std_monat=43, max_tage_woche=3, urlaubstage=12, stundenlohn=13.0))
            v.gueltig_ab = wechsel

    # Skills
    verraeumen = ["Verräumen Trocken", "Verräumen Obst & Gemüse", "Verräumen Kühlung",
                  "Verräumen Getränke", "Verräumen Non-Food"]
    kuerzel_zu_skill = {s.abteilung_id: s for s in skills.values() if s.kategorie in ("verraeumen", "kasse") or s.name == "Backstation"}
    tk_count = 0
    for i, m in enumerate(alle):
        eigene: dict[str, int] = {}
        stamm_skill = kuerzel_zu_skill.get(m.stammabteilung_id)
        if stamm_skill:
            eigene[stamm_skill.name] = rng.choice([2, 3, 3])
        weitere = rng.randint(1, 3)
        pool = verraeumen + ["Kasse", "Kasse", "Backstation", "Leergut/Flaschenautomat"]
        for name in rng.sample(pool, weitere):
            eigene.setdefault(name, rng.choice([1, 2, 2, 3]))
        if m.rolle in ("filialleitung", "stellvertretung"):
            eigene.update({"Kasse": 3, "Schlüsselberechtigung": 3, "Verräumen Kühlung": 3})
        # Engpass-Skill Tiefkühl: nur 4 Personen
        if i in (0, 4, 13, 20) and tk_count < 4:
            eigene["Verräumen Tiefkühl"] = 3 if i in (0, 4) else 2
            tk_count += 1
        if "Verräumen Getränke" in eigene or m.rolle == "filialleitung" or i % 5 == 0:
            eigene["Ameise/Staplerschein"] = 2
        if "Backstation" in eigene or "Verräumen Kühlung" in eigene or "Verräumen Obst & Gemüse" in eigene:
            eigene["Hygieneschulung"] = 2
        for name, level in eigene.items():
            s = skills[name]
            zert = None
            if s.hat_ablauf:
                zert = heute + timedelta(days=rng.randint(120, 900))
            session.add(MitarbeiterSkill(mitarbeiter_id=m.id, skill_id=s.id, level=level,
                                         leistungsfaktor=round(rng.uniform(0.8, 1.2), 2),
                                         zertifikat_bis=zert))
    session.flush()
    # ablaufender Staplerschein (Grenzfall): erste Person mit Ameise → läuft in 20 Tagen ab
    from sqlmodel import select
    ameise = skills["Ameise/Staplerschein"]
    ms = session.exec(select(MitarbeiterSkill).where(MitarbeiterSkill.skill_id == ameise.id)).first()
    if ms:
        ms.zertifikat_bis = heute + timedelta(days=20)
    return alle


def _sonderfaelle(session: Session, heute: date, alle: list[Mitarbeiter]) -> None:
    # minderjähriger Azubi (17 Jahre, JArbSchG)
    azubis = [m for m in alle if m.rolle == "azubi"]
    jung = azubis[0]
    jung.geburtsdatum = date(heute.year - 17, 3, 14)
    # Mutterschutz
    frauen = [m for m in alle if getattr(m, "_weiblich", False) and m.rolle == "verkaeufer"
              and 24 <= heute.year - m.geburtsdatum.year <= 38]
    if frauen:
        frauen[0].status = "mutterschutz"
    # heute krank
    session.add(Abwesenheit(mitarbeiter_id=alle[5].id, von=heute - timedelta(days=1),
                            bis=heute + timedelta(days=2), typ="krank", status="genehmigt"))


def _abwesenheiten(session: Session, rng: random.Random, heute: date, alle: list[Mitarbeiter]) -> None:
    sperren = {e.datum for e in session.new if isinstance(e, Kalendereintrag) and e.urlaubssperre}
    beginn, ende = heute - timedelta(days=365), heute + timedelta(days=180)
    for m in alle:
        if m.status == "mutterschutz":
            continue
        # Urlaub: 2–3 Blöcke, außerhalb der Sperrtage
        for _ in range(rng.randint(1, 2) if m.rolle == "aushilfe" else rng.randint(2, 3)):
            for _versuch in range(20):
                start = beginn + timedelta(days=rng.randint(0, (ende - beginn).days))
                start -= timedelta(days=start.weekday())  # ab Montag
                laenge = rng.choice([5, 5, 12, 12, 19])
                tage = {start + timedelta(days=i) for i in range(laenge)}
                if not tage & sperren:
                    status = "genehmigt" if start < heute + timedelta(days=60) else rng.choice(["beantragt", "genehmigt"])
                    session.add(Abwesenheit(mitarbeiter_id=m.id, von=start, bis=start + timedelta(days=laenge - 1),
                                            typ="urlaub", status=status))
                    break
        # Krankheit ~5 %: mehrere kurze Episoden in der Vergangenheit
        for _ in range(rng.randint(1, 4)):
            start = beginn + timedelta(days=rng.randint(0, 350))
            session.add(Abwesenheit(mitarbeiter_id=m.id, von=start,
                                    bis=start + timedelta(days=rng.choice([1, 2, 3, 4, 9])),
                                    typ="krank", status="genehmigt"))
        # Wunschfrei in den nächsten Wochen
        if rng.random() < 0.5:
            t = heute + timedelta(days=rng.randint(1, 35))
            if ist_werktag(t):
                session.add(Abwesenheit(mitarbeiter_id=m.id, von=t, bis=t, typ="wunschfrei",
                                        status=rng.choice(["beantragt", "genehmigt"]), notiz="Familienfeier"))
        # Berufsschule für Azubis: jeden Dienstag ±10 Wochen
        if m.rolle == "azubi":
            di = heute - timedelta(days=heute.weekday()) + timedelta(days=1) - timedelta(weeks=10)
            for w in range(20):
                t = di + timedelta(weeks=w)
                session.add(Abwesenheit(mitarbeiter_id=m.id, von=t, bis=t, typ="schule", status="genehmigt",
                                        notiz="Berufsschule"))


def _wareneingang(session: Session, rng: random.Random, heute: date) -> None:
    wgs = session.exec(__import__("sqlmodel").select(Warengruppe)).all()
    basis = {w[0]: w[4] for w in WARENGRUPPEN}
    hot = {e.datum: e.lastfaktor for e in session.new if isinstance(e, Kalendereintrag) and e.typ == "hotday"}
    ft = {**feiertage(heute.year - 1), **feiertage(heute.year)}
    t = heute - timedelta(days=365)
    nachhol = 1.0
    while t <= heute:
        if t.weekday() == 6 or t in ft:
            nachhol = 1.35  # ausgefallene Anlieferung wird am Folgetag nachgeholt
            t += timedelta(days=1)
            continue
        for wg in wgs:
            f = WOCHENTAG_FAKTOR[t.weekday()] * hot.get(t, 1.0) * nachhol
            if wg.name == "Getränke" and t.month in (6, 7, 8):
                f *= 1.3
            if t.month == 12 or (t.month == 11 and t.day >= 1):
                f *= 1.25 if wg.name != "Getränke" else 1.1
            if wg.name == "Obst & Gemüse" and t.month in (5, 6, 7, 8, 9):
                f *= 1.15
            wert = basis[wg.name] * f * rng.gauss(1.0, 0.1)
            if rng.random() < 0.01:
                wert *= rng.uniform(1.6, 2.2)  # Sonderlieferung
            session.add(Wareneingang(datum=t, warengruppe_id=wg.id, paletten=max(0, round(wert)), quelle="mock"))
        nachhol = 1.0
        t += timedelta(days=1)


def generate(session: Session, heute: date | None = None) -> dict:
    heute = heute or stichtag_heute()
    rng = random.Random(SEED)
    _reset(session)
    abt, skills = _stammdaten(session)
    _kalender(session, heute)
    alle = _mitarbeiter(session, rng, heute, abt, skills)
    _sonderfaelle(session, heute, alle)
    _abwesenheiten(session, rng, heute, alle)
    _wareneingang(session, rng, heute)
    session.commit()
    seed_frequenz.generate(session, random.Random(SEED + 1), heute)
    session.commit()
    seed_plaene.generate(session, random.Random(SEED + 2), heute)
    session.commit()
    from sqlmodel import func, select
    zaehle = lambda model: session.exec(select(func.count()).select_from(model)).one()  # noqa: E731
    return {
        "abteilungen": zaehle(Abteilung), "skills": zaehle(Skill), "warengruppen": zaehle(Warengruppe),
        "mitarbeiter": zaehle(Mitarbeiter), "vertraege": zaehle(Vertrag),
        "abwesenheiten": zaehle(Abwesenheit), "kalendereintraege": zaehle(Kalendereintrag),
        "wareneingaenge": zaehle(Wareneingang), "kundenfrequenz": zaehle(Kundenfrequenz),
        "plaene": zaehle(Plan), "einsaetze": zaehle(Einsatz), "stichtag": heute.isoformat(),
    }


if __name__ == "__main__":
    init_db()
    with Session(engine) as s:
        print(generate(s))
