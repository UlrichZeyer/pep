"""Export eines Plans als PDF-Aushang, Excel-Arbeitsmappe oder CSV für die Lohnbuchhaltung (M9)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlmodel import Session

from app.db import get_session
from app.export import erzeuge_csv, erzeuge_pdf, erzeuge_xlsx, lade_plan_daten
from app.export.daten import dateiname

router = APIRouter(tags=["Export"])

FORMATE = {
    "pdf": (erzeuge_pdf, "application/pdf"),
    "xlsx": (erzeuge_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "csv": (erzeuge_csv, "text/csv; charset=utf-8"),
}


@router.get("/plaene/{plan_id}/export")
def plan_exportieren(plan_id: int, format: str = Query("pdf"), session: Session = Depends(get_session)):
    fmt = format.lower()
    if fmt not in FORMATE:
        raise HTTPException(422, f"Unbekanntes Exportformat „{format}“ – erlaubt sind pdf, xlsx und csv.")
    daten = lade_plan_daten(session, plan_id)
    if daten is None:
        raise HTTPException(404, "Plan nicht gefunden.")
    erzeuger, medientyp = FORMATE[fmt]
    name = dateiname(daten.plan, fmt)
    return Response(content=erzeuger(daten), media_type=medientyp,
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
