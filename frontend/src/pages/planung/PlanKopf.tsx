// Gemeinsamer Kopfbereich: Navigation, Ansichts-Tabs, Plan der Woche, Status, Verstöße, Vorschlag, Export.
import { useEffect, useRef, useState } from 'react'
import { addMonths, format, parseISO } from 'date-fns'
import { de } from 'date-fns/locale'
import { exportUrl, type ExportFormat, type PlanStatus } from '../../api'
import { Button, Hinweis, Icon, StatusBadge, Tabs, fmtDatum, fmtDatumKurz, fmtDatumLang, toISO } from '../../components/ui'
import { PlanStatusBadge } from './bausteine'
import { fehlerText, nichtVerfuegbar, type PlanDaten } from './usePlanDaten'
import { kw, plusTage, wochentagIndex } from './zeit'

export type Ansicht = 'woche' | 'tag' | 'monat' | 'abteilungen'
export const ANSICHTEN: { wert: Ansicht; label: string }[] = [
  { wert: 'woche', label: 'Woche' },
  { wert: 'tag', label: 'Tag' },
  { wert: 'monat', label: 'Monat' },
  { wert: 'abteilungen', label: 'Abteilungen' },
]

function schritt(ansicht: Ansicht, datum: string, richtung: 1 | -1): string {
  if (ansicht === 'monat') return toISO(addMonths(parseISO(datum), richtung))
  if (ansicht === 'tag') {
    let d = plusTage(datum, richtung)
    if (wochentagIndex(d) === 6) d = plusTage(d, richtung) // Sonntag überspringen
    return d
  }
  return plusTage(datum, 7 * richtung)
}

const EXPORTE: { format: ExportFormat; label: string }[] = [
  { format: 'pdf', label: 'PDF (Aushang)' },
  { format: 'xlsx', label: 'Excel' },
  { format: 'csv', label: 'CSV' },
]

function ExportMenue({ planId }: { planId: number }) {
  const [offen, setOffen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!offen) return
    const zu = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOffen(false) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOffen(false)
    document.addEventListener('mousedown', zu)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', zu); document.removeEventListener('keydown', esc) }
  }, [offen])
  return (
    <div ref={ref} className="relative">
      <Button icon="download" aria-haspopup="menu" aria-expanded={offen} onClick={() => setOffen((o) => !o)}>Export</Button>
      {offen && (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-44 rounded-lg border border-sand bg-white shadow-lg py-1">
          {EXPORTE.map((x) => (
            <a key={x.format} role="menuitem" href={exportUrl(planId, x.format)} download onClick={() => setOffen(false)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-rinde hover:bg-fell-hell">
              <Icon name="download" className="w-3.5 h-3.5 text-haselnuss" /> {x.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

const UEBERGAENGE: Record<PlanStatus, { ziel: PlanStatus; label: string; variante: 'primaer' | 'sekundaer' | 'leise' }[]> = {
  entwurf: [{ ziel: 'freigegeben', label: 'Freigeben', variante: 'primaer' }],
  freigegeben: [
    { ziel: 'veroeffentlicht', label: 'Veröffentlichen', variante: 'primaer' },
    { ziel: 'entwurf', label: 'Zurück zu Entwurf', variante: 'leise' },
  ],
  veroeffentlicht: [{ ziel: 'entwurf', label: 'Zurück zu Entwurf', variante: 'leise' }],
}

export default function PlanKopf({ ansicht, datum, onDatum, onAnsicht, daten, onVorschlag }: {
  ansicht: Ansicht
  datum: string
  onDatum: (d: string) => void
  onAnsicht: (a: Ansicht) => void
  daten: PlanDaten
  onVorschlag: () => void
}) {
  const { plan, plaeneQ, zusammenfassung, validierungQ, montag, samstag } = daten
  const [laeuft, setLaeuft] = useState(false)

  const titel =
    ansicht === 'monat' ? format(parseISO(datum), 'MMMM yyyy', { locale: de })
      : ansicht === 'tag' ? fmtDatumLang(datum)
        : `KW ${kw(montag)} · ${fmtDatumKurz(montag)}–${fmtDatum(samstag)}`

  const status = async (ziel: PlanStatus) => {
    setLaeuft(true)
    await daten.statusAendern(ziel)
    setLaeuft(false)
  }
  const anlegen = async () => {
    setLaeuft(true)
    await daten.planAnlegen()
    setLaeuft(false)
  }

  return (
    <div className="space-y-3 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variante="sekundaer" icon="links" aria-label={ansicht === 'monat' ? 'Vorheriger Monat' : ansicht === 'tag' ? 'Vorheriger Tag' : 'Vorherige Woche'}
            onClick={() => onDatum(schritt(ansicht, datum, -1))} />
          <Button variante="sekundaer" onClick={() => onDatum(toISO(new Date()))}>Heute</Button>
          <Button variante="sekundaer" icon="rechts" aria-label={ansicht === 'monat' ? 'Nächster Monat' : ansicht === 'tag' ? 'Nächster Tag' : 'Nächste Woche'}
            onClick={() => onDatum(schritt(ansicht, datum, 1))} />
          <h1 className="ml-2 text-xl font-extrabold text-rinde tracking-tight" aria-live="polite">{titel}</h1>
        </div>
        <Tabs werte={ANSICHTEN} aktiv={ansicht} onChange={onAnsicht} />
      </div>

      {ansicht !== 'monat' && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-eich)] border border-sand bg-white px-3 py-2">
          {plaeneQ.isLoading ? (
            <span className="text-sm text-stein">Plan wird gesucht …</span>
          ) : plaeneQ.isError ? (
            <span className="text-sm text-stein flex items-center gap-1.5">
              <Icon name="info" className="w-4 h-4" />
              {nichtVerfuegbar(plaeneQ.error) ? 'Planungs-Schnittstelle noch nicht verfügbar (Backend-Modul fehlt).' : fehlerText(plaeneQ.error)}
            </span>
          ) : !plan ? (
            <>
              <span className="text-sm text-stein">Für diese Woche gibt es noch keinen Plan.</span>
              <Button variante="primaer" icon="plus" onClick={anlegen} disabled={laeuft}>Plan für KW {kw(montag)} anlegen</Button>
            </>
          ) : (
            <>
              <span className="font-bold text-rinde">{plan.name}</span>
              <PlanStatusBadge status={plan.status} />
              <span className="text-xs text-stein">{plan.anzahl_einsaetze} Einsätze</span>
              <span className="mx-1 h-5 w-px bg-sand" aria-hidden />
              {validierungQ.isError ? (
                <span className="text-xs text-stein">{nichtVerfuegbar(validierungQ.error) ? 'Validierung noch nicht verfügbar' : 'Validierung fehlgeschlagen'}</span>
              ) : zusammenfassung ? (
                <span className="flex items-center gap-1.5">
                  <StatusBadge status={zusammenfassung.hart ? 'verstoss' : 'ok'}>{zusammenfassung.hart} harte</StatusBadge>
                  <StatusBadge status={zusammenfassung.weich ? 'warn' : 'ok'}>{zusammenfassung.weich} weiche</StatusBadge>
                </span>
              ) : (
                <span className="text-xs text-stein">Prüfe Regeln …</span>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {UEBERGAENGE[plan.status].map((u) => (
                  <Button key={u.ziel} variante={u.variante} klein onClick={() => status(u.ziel)} disabled={laeuft}>{u.label}</Button>
                ))}
                <Button icon="zauber" onClick={onVorschlag} disabled={plan.status !== 'entwurf'}
                  title={plan.status !== 'entwurf' ? 'Nur im Entwurf möglich' : undefined}>Vorschlag erzeugen</Button>
                <ExportMenue planId={plan.id} />
              </div>
            </>
          )}
        </div>
      )}

      {daten.meldung && (
        <Hinweis ton={daten.meldung.ton} titel={daten.meldung.titel} onSchliessen={() => daten.setMeldung(null)}>{daten.meldung.text}</Hinweis>
      )}
      {plan && plan.status !== 'entwurf' && ansicht !== 'monat' && (
        <Hinweis ton="info">Der Plan ist {plan.status === 'freigegeben' ? 'freigegeben' : 'veröffentlicht'} und schreibgeschützt. Für Änderungen „Zurück zu Entwurf“ wählen.</Hinweis>
      )}
    </div>
  )
}
