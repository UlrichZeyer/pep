// Kleine gemeinsame Bausteine der Einsatzplanung (Verstoß-Marker, Abdeckung, Planstatus).
import { useEffect, useRef, useState } from 'react'
import { PLANSTATUS, type PlanStatus, type Verstoss } from '../../api'
import { Badge, Icon, StatusBadge, cx, fmtStd, fmtZahl } from '../../components/ui'

/** Rotes (hart) bzw. Warn-Badge (weich) mit Popover der Meldungen. */
export function VerstossMarker({ verstoesse, klein }: { verstoesse: Verstoss[]; klein?: boolean }) {
  const [offen, setOffen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!offen) return
    const zu = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOffen(false) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOffen(false)
    document.addEventListener('mousedown', zu)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', zu); document.removeEventListener('keydown', esc) }
  }, [offen])
  if (!verstoesse.length) return null
  const hart = verstoesse.filter((v) => v.schwere === 'hart').length
  const weich = verstoesse.length - hart
  const ton = hart ? 'verstoss' : 'warn'
  const label = hart
    ? `${hart} harte${weich ? ` und ${weich} weiche` : ''} Regelverletzung${hart + weich > 1 ? 'en' : ''}`
    : `${weich} weiche Regelverletzung${weich > 1 ? 'en' : ''}`
  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" aria-label={`${label} anzeigen`} aria-expanded={offen}
        title={verstoesse.map((v) => v.meldung).join('\n')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOffen((o) => !o) }}
        className={cx('inline-flex items-center gap-0.5 rounded-full font-bold leading-none',
          klein ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-xs',
          ton === 'verstoss' ? 'bg-verstoss text-white' : 'bg-warn-hell text-warn border border-warn/40')}>
        <Icon name={ton} className="w-3 h-3" />
        {verstoesse.length}
      </button>
      {offen && (
        <div role="dialog" aria-label="Regelverstöße" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
          className="absolute z-40 top-full left-0 mt-1 w-72 rounded-lg border border-sand bg-white shadow-lg p-2 text-left">
          <ul className="space-y-1.5">
            {verstoesse.map((v, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-rinde">
                <Icon name={v.schwere === 'hart' ? 'verstoss' : 'warn'} className={cx('w-3.5 h-3.5 mt-0.5', v.schwere === 'hart' ? 'text-verstoss' : 'text-warn')} />
                <span><span className="font-bold">{v.schwere === 'hart' ? 'Hart' : 'Weich'}:</span> {v.meldung}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  )
}

export type AbdeckungStatus = 'ok' | 'warn' | 'verstoss'
/** Abdeckungsgrad: rot < 90 %, grün 95–110 %, sonst Warnung. */
export function abdeckungsStatus(geplant: number, bedarf: number | null): { status: AbdeckungStatus; quote: number | null; text: string } {
  if (bedarf === null) return { status: 'warn', quote: null, text: 'Bedarf unbekannt' }
  if (bedarf <= 0) return geplant > 0 ? { status: 'warn', quote: null, text: 'kein Bedarf' } : { status: 'ok', quote: null, text: 'kein Bedarf' }
  const q = geplant / bedarf
  const text = `${fmtZahl(q * 100)} %`
  if (q < 0.9) return { status: 'verstoss', quote: q, text: `${text} unterdeckt` }
  if (q >= 0.95 && q <= 1.1) return { status: 'ok', quote: q, text: `${text} gedeckt` }
  return { status: 'warn', quote: q, text: q > 1.1 ? `${text} überdeckt` : `${text} knapp` }
}

export function AbdeckungsAnzeige({ geplant, bedarf, kompakt }: { geplant: number; bedarf: number | null; kompakt?: boolean }) {
  const a = abdeckungsStatus(geplant, bedarf)
  return (
    <div className={cx('flex flex-col gap-0.5', kompakt ? 'items-start' : 'items-center')}>
      <span className="text-xs tabular-nums text-rinde">
        <span className="font-bold">{fmtStd(Math.round(geplant * 10) / 10)}</span>
        <span className="text-stein"> / {bedarf === null ? '–' : fmtStd(Math.round(bedarf * 10) / 10)}</span>
      </span>
      <StatusBadge status={a.status} titel={`Geplant ${fmtStd(geplant)} gegenüber Bedarf ${bedarf === null ? 'unbekannt' : fmtStd(bedarf)}`}>{a.text}</StatusBadge>
    </div>
  )
}

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  if (status === 'veroeffentlicht') return <Badge ton="moos" icon="ok">{PLANSTATUS[status]}</Badge>
  if (status === 'freigegeben') return <Badge ton="info" icon="schloss">{PLANSTATUS[status]}</Badge>
  return <Badge ton="neutral" icon="stift">{PLANSTATUS[status]}</Badge>
}

/** Abweichung geplanter Stunden vom Soll (Status immer mit Text). */
export function sollAbweichung(geplant: number, soll: number | null): { status: AbdeckungStatus; text: string } {
  if (soll === null || soll <= 0) return { status: 'warn', text: 'kein Soll' }
  const diff = Math.round((geplant - soll) * 10) / 10
  const rel = Math.abs(diff) / soll
  const text = diff === 0 ? '±0 h' : `${diff > 0 ? '+' : '−'}${fmtStd(Math.abs(diff))}`
  if (Math.abs(diff) <= 1 || rel <= 0.1) return { status: 'ok', text }
  if (rel <= 0.25) return { status: 'warn', text }
  return { status: 'verstoss', text }
}
