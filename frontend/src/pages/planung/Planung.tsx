// Einstieg Einsatzplanung: gemeinsamer Kopf + Unterrouten (Woche · Tag · Monat · Abteilungen), Datum in ?datum=.
import { useCallback, useEffect, useState } from 'react'
import { Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router'
import { toISO } from '../../components/ui'
import Abteilungsansicht from './Abteilungsansicht'
import AutoPlanDialog from './AutoPlanDialog'
import EinsatzDialog, { type EinsatzVorgabe } from './EinsatzDialog'
import Monatsplan from './Monatsplan'
import PlanKopf, { type Ansicht } from './PlanKopf'
import Tagesansicht from './Tagesansicht'
import { usePlanDaten } from './usePlanDaten'
import Wochenplan from './Wochenplan'

const PFAD: Record<Ansicht, string> = { woche: '', tag: 'tag', monat: 'monat', abteilungen: 'abteilungen' }

function ansichtAus(pfad: string): Ansicht {
  const teil = pfad.replace(/\/+$/, '').split('/').pop()
  if (teil === 'tag' || teil === 'monat' || teil === 'abteilungen') return teil
  return 'woche'
}

const gueltig = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))

export default function Planung() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const ansicht = ansichtAus(location.pathname)
  const roh = params.get('datum')
  const datum = gueltig(roh) ? roh! : toISO(new Date())

  const daten = usePlanDaten(datum)
  const [vorgabe, setVorgabe] = useState<EinsatzVorgabe | null>(null)
  const [vorschlagOffen, setVorschlagOffen] = useState(false)
  const [markiert, setMarkiert] = useState<number | null>(null)

  const setDatum = useCallback((d: string) => {
    const p = new URLSearchParams(params)
    p.set('datum', d)
    setParams(p)
  }, [params, setParams])
  const setAnsicht = (a: Ansicht) => navigate(`/planung${PFAD[a] ? `/${PFAD[a]}` : ''}?datum=${datum}`)

  // Erfolgsmeldungen nach kurzer Zeit ausblenden
  const { meldung, setMeldung } = daten
  useEffect(() => {
    if (meldung?.ton !== 'ok') return
    const t = setTimeout(() => setMeldung(null), 5000)
    return () => clearTimeout(t)
  }, [meldung, setMeldung])

  // Markierung nach kurzer Zeit lösen
  useEffect(() => {
    if (markiert === null) return
    const t = setTimeout(() => setMarkiert(null), 4000)
    return () => clearTimeout(t)
  }, [markiert])

  return (
    <div>
      <PlanKopf ansicht={ansicht} datum={datum} onDatum={setDatum} onAnsicht={setAnsicht} daten={daten}
        onVorschlag={() => setVorschlagOffen(true)} />
      <Routes>
        <Route index element={<Wochenplan daten={daten} onOeffnen={setVorgabe} markiert={markiert} onMarkieren={setMarkiert} />} />
        <Route path="tag" element={<Tagesansicht daten={daten} datum={datum} onDatum={setDatum} onOeffnen={setVorgabe} />} />
        <Route path="monat" element={<Monatsplan datum={datum} onTag={(d) => navigate(`/planung/tag?datum=${d}`)} />} />
        <Route path="abteilungen" element={<Abteilungsansicht daten={daten} onOeffnen={setVorgabe} />} />
        <Route path="*" element={<Wochenplan daten={daten} onOeffnen={setVorgabe} markiert={markiert} onMarkieren={setMarkiert} />} />
      </Routes>

      {vorgabe && (
        <EinsatzDialog key={vorgabe.einsatz?.id ?? `${vorgabe.mitarbeiter_id}-${vorgabe.datum}-${vorgabe.abteilung_id}`}
          vorgabe={vorgabe} daten={daten} onSchliessen={() => setVorgabe(null)} />
      )}
      {daten.planId !== null && (
        <AutoPlanDialog planId={daten.planId} offen={vorschlagOffen} onSchliessen={() => setVorschlagOffen(false)}
          onFertig={daten.neuLaden} />
      )}
    </div>
  )
}
