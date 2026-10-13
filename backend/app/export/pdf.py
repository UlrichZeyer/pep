"""PDF-Aushang „Wochenplan“ (A4 quer, je Kalenderwoche eine Seite)."""
import io
from html import escape as _e
from datetime import date

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import KeepInFrame, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.export.daten import AKZENT, FILIALE, WOCHENTAGE, PlanDaten, kw_text

FELL = colors.HexColor(AKZENT)
FELL_HELL = colors.HexColor("#F6E3D3")
SAND = colors.HexColor("#EFE6DA")
RINDE = colors.HexColor("#2F2620")
STEIN = colors.HexColor("#7D7268")
HASELNUSS = colors.HexColor("#7A4E2D")

TITEL = ParagraphStyle("titel", fontName="Helvetica-Bold", fontSize=16, leading=19, textColor=FELL)
INFO = ParagraphStyle("info", fontName="Helvetica", fontSize=8.5, leading=11, textColor=RINDE)
ZELLE = ParagraphStyle("zelle", fontName="Helvetica", fontSize=7.2, leading=8.4, alignment=1, textColor=RINDE)
ZELLE_ABW = ParagraphStyle("abw", parent=ZELLE, fontName="Helvetica-Oblique", textColor=HASELNUSS)
ZELLE_ZU = ParagraphStyle("zu", parent=ZELLE, fontName="Helvetica-Oblique", textColor=STEIN)
NAME = ParagraphStyle("name", parent=ZELLE, alignment=0)
KOPF = ParagraphStyle("kopf", parent=ZELLE, fontName="Helvetica-Bold", textColor=colors.white)
GRUPPE = ParagraphStyle("gruppe", parent=ZELLE, fontName="Helvetica-Bold", alignment=0)


class _NummernCanvas(Canvas):
    """Canvas mit Fußzeile „Seite x von y“ (zweiter Durchlauf über gemerkte Seiten)."""

    def __init__(self, *args, fusstext: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self._seiten: list[dict] = []
        self._fusstext = fusstext

    def showPage(self):  # noqa: N802 (reportlab-API)
        self._seiten.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        gesamt = len(self._seiten)
        for zustand in self._seiten:
            self.__dict__.update(zustand)
            self._fusszeile(gesamt)
            super().showPage()
        super().save()

    def _fusszeile(self, gesamt: int) -> None:
        breite, _ = self._pagesize
        self.setStrokeColor(FELL)
        self.setLineWidth(0.8)
        self.line(12 * mm, 11 * mm, breite - 12 * mm, 11 * mm)
        self.setFont("Helvetica", 7.5)
        self.setFillColor(STEIN)
        self.drawString(12 * mm, 7 * mm, self._fusstext)
        self.drawCentredString(breite / 2, 7 * mm, "Änderungen vorbehalten")
        self.drawRightString(breite - 12 * mm, 7 * mm, f"Seite {self._pageNumber} von {gesamt}")


def _std(minuten: int) -> str:
    return f"{minuten / 60:.2f}".replace(".", ",")


def _woche(d: PlanDaten, tage: list[date], breite: float, hoehe: float) -> list:
    p = d.plan
    kopf = [
        Paragraph(f"Aushang Wochenplan · {kw_text(tage)}", TITEL),
        Spacer(1, 2 * mm),
        Paragraph(f"<b>{FILIALE}</b> &nbsp;·&nbsp; Plan: <b>{_e(p.name)}</b> &nbsp;·&nbsp; "
                  f"Zeitraum: {tage[0]:%d.%m.%Y} – {tage[-1]:%d.%m.%Y} &nbsp;·&nbsp; Status: {d.status_text}"
                  f" &nbsp;·&nbsp; Plan erstellt: {p.erstellt_am:%d.%m.%Y} &nbsp;·&nbsp; "
                  f"Ausdruck: {d.erstellt:%d.%m.%Y %H:%M}", INFO),
        Spacer(1, 3 * mm),
    ]

    farb_b, name_b, summe_b = 2 * mm, 42 * mm, 16 * mm
    tag_b = (breite - farb_b - name_b - summe_b) / max(len(tage), 1)
    zeilen = [["", Paragraph("Mitarbeiter", KOPF)]
              + [Paragraph(f"{WOCHENTAGE[t.weekday()]} {t:%d.%m.}"
                           + (f"<br/><font size=6>{_e(d.geschlossen[t])}</font>" if t in d.geschlossen else ""), KOPF)
                 for t in tage] + [Paragraph("Std.", KOPF)]]
    stil = [
        ("BACKGROUND", (0, 0), (-1, 0), FELL),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, SAND),
        ("LINEBELOW", (0, -1), (-1, -1), 0.8, FELL),
        ("LEFTPADDING", (0, 0), (0, -1), 0), ("RIGHTPADDING", (0, 0), (0, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1.6), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6),
    ]
    for i, t in enumerate(tage):
        if t in d.geschlossen:
            stil.append(("BACKGROUND", (2 + i, 1), (2 + i, -1), SAND))
    for g in d.gruppen:
        r = len(zeilen)
        zeilen.append(["", Paragraph(_e(g.name), GRUPPE)] + [""] * (len(tage) + 1))
        stil += [("SPAN", (1, r), (-1, r)), ("BACKGROUND", (1, r), (-1, r), FELL_HELL),
                 ("BACKGROUND", (0, r), (0, r), colors.HexColor(g.farbe))]
        for z in g.zeilen:
            r = len(zeilen)
            zellen = []
            for t in tage:
                text = d.zelle(z, t)
                if t in d.geschlossen:
                    stil_z = ZELLE_ZU
                elif text and not z.einsaetze.get(t):
                    stil_z = ZELLE_ABW
                else:
                    stil_z = ZELLE
                zellen.append(Paragraph(_e(text).replace("\n", "<br/>"), stil_z) if text else "")
            minuten = z.minuten(tage)
            zeilen.append(["", Paragraph(_e(z.name), NAME)] + zellen
                          + [Paragraph(f"<b>{_std(minuten)}</b>" if minuten else "–", ZELLE)])
            stil.append(("BACKGROUND", (0, r), (0, r), colors.HexColor(g.farbe)))
    tabelle = Table(zeilen, colWidths=[farb_b, name_b] + [tag_b] * len(tage) + [summe_b], repeatRows=1)
    tabelle.setStyle(TableStyle(stil))
    # Aushang = eine Seite je Woche: bei vielen Mitarbeitern wird die Tabelle verkleinert
    return kopf + [KeepInFrame(breite, hoehe - 22 * mm, [tabelle], mode="shrink")]


def erzeuge_pdf(d: PlanDaten) -> bytes:
    puffer = io.BytesIO()
    seite = landscape(A4)
    doc = SimpleDocTemplate(puffer, pagesize=seite, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=10 * mm,
                            bottomMargin=15 * mm, title=f"Aushang Wochenplan – {d.plan.name}", author="PEP",
                            subject=FILIALE)
    story: list = []
    wochen = d.wochen or [[d.plan.von]]
    for i, tage in enumerate(wochen):
        if i:
            story.append(PageBreak())
        story += _woche(d, tage, doc.width, doc.height)
    fuss = f"PEP · {FILIALE} · {d.plan.name}"
    doc.build(story, canvasmaker=lambda *a, **k: _NummernCanvas(*a, fusstext=fuss, **k))
    return puffer.getvalue()
