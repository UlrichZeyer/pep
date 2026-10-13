// Rahmen für eine Diagramm-Karte: Titel, Untertitel, Steuerung, Lade-/Fehler-/Leerzustand
// und eine Fehlergrenze, damit ein defektes Diagramm nicht die ganze Seite abstürzen lässt.
import { Component, type ReactNode } from 'react'
import { ApiFehler } from '../../api'
import { Card, Hinweis, Laden, Leer, cx } from '../ui'

export interface Abfrage {
  isLoading?: boolean
  isFetching?: boolean
  error?: unknown
}

/** Freundliche Fehlermeldung für eine Karte (404 = Auswertung noch nicht verfügbar). */
export function KartenFehler({ fehler }: { fehler: unknown }) {
  if (fehler instanceof ApiFehler && fehler.status === 404)
    return <Hinweis ton="info" titel="Noch keine Daten">Diese Auswertung ist (noch) nicht verfügbar.</Hinweis>
  if (fehler instanceof ApiFehler && fehler.status === 0)
    return <Hinweis ton="warn" titel="Backend nicht erreichbar">{fehler.message}</Hinweis>
  const text = fehler instanceof Error ? fehler.message : String(fehler)
  return <Hinweis ton="warn" titel="Auswertung konnte nicht geladen werden">{text}</Hinweis>
}

class Fehlergrenze extends Component<{ children: ReactNode }, { fehler: unknown }> {
  state: { fehler: unknown } = { fehler: null }
  static getDerivedStateFromError(fehler: unknown) { return { fehler } }
  render() {
    if (this.state.fehler) return <KartenFehler fehler={this.state.fehler} />
    return this.props.children
  }
}

export function ChartKarte({ titel, untertitel, aktionen, abfragen = [], leer, leerText, fuss, className, children }: {
  titel: ReactNode
  untertitel?: ReactNode
  aktionen?: ReactNode
  /** Abfragen, von denen die Karte abhängt – Laden/Fehler wird je Karte angezeigt. */
  abfragen?: Abfrage[]
  /** true → Leerzustand statt Inhalt */
  leer?: boolean
  leerText?: ReactNode
  fuss?: ReactNode
  className?: string
  children?: ReactNode
}) {
  const fehler = abfragen.find((a) => a.error)?.error
  const laedt = abfragen.some((a) => a.isLoading)
  const aktualisiert = !laedt && abfragen.some((a) => a.isFetching)
  return (
    <Card className={className} titel={
      <span className="block">
        <span className="block">{titel}</span>
        {untertitel && <span className="block text-xs font-normal text-stein mt-0.5">{untertitel}</span>}
      </span>
    } aktionen={aktionen}>
      <Fehlergrenze>
        {fehler ? <KartenFehler fehler={fehler} />
          : laedt ? <Laden />
            : leer ? <Leer titel="Keine Daten">{leerText}</Leer>
              : <div className={cx('transition-opacity', aktualisiert && 'opacity-60')}>{children}</div>}
      </Fehlergrenze>
      {fuss && !fehler && !laedt && <div className="mt-3 text-xs text-stein">{fuss}</div>}
    </Card>
  )
}

/** Kleiner Umschalter (Segmente) für Karten-Steuerung. */
export function Umschalter<T extends string | number>({ werte, aktiv, onChange, label }:
  { werte: { wert: T; label: string }[]; aktiv: T; onChange: (w: T) => void; label: string }) {
  return (
    <div className="inline-flex rounded-lg border border-sand bg-white p-0.5" role="radiogroup" aria-label={label}>
      {werte.map((w) => (
        <button key={String(w.wert)} type="button" role="radio" aria-checked={aktiv === w.wert} onClick={() => onChange(w.wert)}
          className={cx('px-2 py-0.5 text-xs font-semibold rounded-md transition-colors',
            aktiv === w.wert ? 'bg-fell text-white' : 'text-haselnuss hover:bg-fell-hell')}>
          {w.label}
        </button>
      ))}
    </div>
  )
}
