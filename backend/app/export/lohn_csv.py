"""CSV für die Lohnbuchhaltung: Semikolon, UTF-8 mit BOM, Dezimalkomma."""
import csv
import io

from app.export.daten import PlanDaten
from app.util import arbeitsminuten

KOPF = ["persnr", "nachname", "vorname", "datum", "beginn", "ende", "pause_min", "netto_std", "abteilung",
        "vertragsart"]


def dezimal(wert: float) -> str:
    return f"{wert:.2f}".replace(".", ",")


def erzeuge_csv(d: PlanDaten) -> bytes:
    puffer = io.StringIO()
    w = csv.writer(puffer, delimiter=";", lineterminator="\r\n")
    w.writerow(KOPF)
    for e in sorted(d.einsaetze, key=lambda e: (d.mitarbeiter[e.mitarbeiter_id].persnr, e.datum, e.beginn)):
        m = d.mitarbeiter[e.mitarbeiter_id]
        w.writerow([m.persnr, m.nachname, m.vorname, e.datum.isoformat(), e.beginn, e.ende, e.pause_min,
                    dezimal(arbeitsminuten(e.beginn, e.ende, e.pause_min) / 60), d.abt_name(e.abteilung_id),
                    d.vertragsart(m.id, e.datum)])
    return puffer.getvalue().encode("utf-8-sig")
