"""Datenmodell (SQLModel-Tabellen). Siehe docs/TECHNISCHES_KONZEPT.md, Kapitel 5.

Zeiten werden als "HH:MM"-Strings gespeichert (15-Minuten-Raster),
Wochentage als Ziffernfolge mit 0 = Montag … 5 = Samstag (z. B. "012345").
"""
from datetime import date, datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class Abteilung(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    kuerzel: str
    farbe: str  # Hex, Kategoriefarbe
    mindestbesetzung: int = 1
    arbeitszeit_von: str = "05:00"
    arbeitszeit_bis: str = "21:45"
    bedarfsart: str = "paletten"  # paletten | frequenz | fix
    sortierung: int = 0


class Skill(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    kategorie: str  # verraeumen | kasse | zertifikat | sonstiges
    hat_ablauf: bool = False
    abteilung_id: Optional[int] = Field(default=None, foreign_key="abteilung.id")


class Warengruppe(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    abteilung_id: int = Field(foreign_key="abteilung.id")
    skill_id: int = Field(foreign_key="skill.id")
    std_leistung_pal_h: float


class Mitarbeiter(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    persnr: str = Field(index=True, unique=True)
    vorname: str
    nachname: str
    geburtsdatum: date
    eintritt: date
    austritt: Optional[date] = None
    stammabteilung_id: Optional[int] = Field(default=None, foreign_key="abteilung.id")
    rolle: str = "verkaeufer"  # filialleitung | stellvertretung | verkaeufer | aushilfe | azubi
    status: str = "aktiv"  # aktiv | inaktiv | mutterschutz | elternzeit
    stundenkonto: float = 0.0
    quelle: str = "manuell"  # mock | manuell


class Vertrag(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    mitarbeiter_id: int = Field(foreign_key="mitarbeiter.id", index=True)
    art: str  # vollzeit | teilzeit | minijob | werkstudent | aushilfe | azubi
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


class MitarbeiterSkill(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    mitarbeiter_id: int = Field(foreign_key="mitarbeiter.id", index=True)
    skill_id: int = Field(foreign_key="skill.id")
    level: int = 2  # 1 Einarbeitung, 2 selbstständig, 3 Experte
    leistungsfaktor: float = 1.0
    zertifikat_bis: Optional[date] = None


class Abwesenheit(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    mitarbeiter_id: int = Field(foreign_key="mitarbeiter.id", index=True)
    von: date
    bis: date
    typ: str  # urlaub | krank | schule | fortbildung | wunschfrei | sonstiges
    status: str = "genehmigt"  # beantragt | genehmigt | abgelehnt
    notiz: Optional[str] = None


class Kalendereintrag(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    datum: date = Field(index=True)
    typ: str  # hotday | sondertag | schliesstag
    name: str
    lastfaktor: float = 1.0
    urlaubssperre: bool = False
    quelle: str = "manuell"  # auto | manuell | mock


class Wareneingang(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    datum: date = Field(index=True)
    warengruppe_id: int = Field(foreign_key="warengruppe.id")
    paletten: int
    quelle: str = "mock"


class Kundenfrequenz(SQLModel, table=True):
    """Kunden pro Stunde (Basis für den Kassenbedarf)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    datum: date = Field(index=True)
    stunde: int  # 7 … 20 (Stunde ab HH:00)
    kunden: int
    quelle: str = "mock"


class Schichtmodell(SQLModel, table=True):
    """Arbeitszeitvorlage (nur Schnellauswahl, Zeiten bleiben frei editierbar)."""

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    beginn: str
    ende: str
    pause_min: int = 0


class Plan(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    von: date
    bis: date
    status: str = "entwurf"  # entwurf | freigegeben | veroeffentlicht
    erstellt_am: datetime = Field(default_factory=datetime.now)
    quelle: str = "manuell"


class Einsatz(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    plan_id: int = Field(foreign_key="plan.id", index=True)
    mitarbeiter_id: int = Field(foreign_key="mitarbeiter.id", index=True)
    abteilung_id: int = Field(foreign_key="abteilung.id")
    datum: date = Field(index=True)
    beginn: str  # HH:MM
    ende: str  # HH:MM
    pause_min: int = 0
    gesperrt: bool = False
    quelle: str = "manuell"  # manuell | auto | mock
    ist_paletten: Optional[float] = None  # Ist-Leistung (nur freigegebene Mock-Pläne)


class Regelparameter(SQLModel, table=True):
    schluessel: str = Field(primary_key=True)
    wert: float
    beschreibung: str = ""


class Aenderungslog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    zeit: datetime = Field(default_factory=datetime.now)
    entitaet: str
    entitaet_id: Optional[int] = None
    aktion: str  # angelegt | geaendert | geloescht
    alt: Optional[str] = None
    neu: Optional[str] = None


# Standardwerte für das Regelwerk (Kapitel 8.2). seed.py schreibt sie in die DB.
REGELPARAMETER_STANDARD: dict[str, tuple[float, str]] = {
    "max_std_tag": (10.0, "ArbZG § 3: max. Arbeitszeit pro Tag (h)"),
    "regel_std_tag": (8.0, "ArbZG § 3: Regelarbeitszeit pro Werktag (h)"),
    "schnitt_wochen": (24.0, "ArbZG § 3: Ausgleichszeitraum (Wochen)"),
    "schnitt_warnung_std": (7.5, "Warnschwelle Ø-Arbeitszeit pro Werktag (h)"),
    "max_std_woche": (48.0, "ArbZG § 3: max. Wochenarbeitszeit (h)"),
    "pause_ab_6h_min": (30.0, "ArbZG § 4: Pause bei > 6 h (min)"),
    "pause_ab_9h_min": (45.0, "ArbZG § 4: Pause bei > 9 h (min)"),
    "ruhezeit_std": (11.0, "ArbZG § 5: Ruhezeit (h)"),
    "jugend_max_std_tag": (8.0, "JArbSchG § 8: max. h/Tag"),
    "jugend_max_std_woche": (40.0, "JArbSchG § 8: max. h/Woche"),
    "jugend_max_tage_woche": (5.0, "JArbSchG § 15: max. Tage/Woche"),
    "jugend_ruhezeit_std": (12.0, "JArbSchG § 13: Ruhezeit (h)"),
    "jugend_frueheste_std": (6.0, "JArbSchG § 14: frühester Beginn (Uhr)"),
    "jugend_spaeteste_std": (20.0, "JArbSchG § 14: spätestes Ende (Uhr)"),
    "muschg_max_std_tag": (8.5, "MuSchG § 4: max. h/Tag"),
    "minijob_max_std_monat": (43.0, "Minijob: max. Stunden pro Monat"),
    "soll_toleranz_prozent": (10.0, "Toleranz Soll-Wochenstunden (%)"),
}
