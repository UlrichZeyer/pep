"""FastAPI-Anwendung: bindet die Router ein und liefert optional das gebaute Frontend aus."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from app.db import engine, init_db
from app.routers import export, kpi, personal, planung, solver


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    from app.models import Abteilung

    with Session(engine) as s:
        if s.exec(select(Abteilung)).first() is None:  # erste Inbetriebnahme → Demodaten
            from app import seed

            seed.generate(s)
    yield


app = FastAPI(title="PEP – Personaleinsatzplanung", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

for r in (personal, planung, kpi, solver, export):
    app.include_router(r.router, prefix="/api")

_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{pfad:path}", include_in_schema=False)
    def spa(pfad: str):
        datei = _DIST / pfad
        if pfad and datei.is_file():
            return FileResponse(datei)
        return FileResponse(_DIST / "index.html")
