// Legende, Tooltip-Inhalt und gemeinsame Achsen-Props für Recharts.
import type { ReactNode } from 'react'
import { CHROME } from './farben'
import { fmtAchse } from './format'

export interface LegendenEintrag {
  name: string
  farbe: string
  /** Form spiegelt die Marke: Fläche für Säulen/Flächen, Linie für Linien, Punkt für Marker. */
  form?: 'flaeche' | 'linie' | 'punkt'
}

export function Legende({ eintraege, className }: { eintraege: LegendenEintrag[]; className?: string }) {
  if (eintraege.length < 2 && !eintraege.some((e) => e.form === 'punkt')) return null
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-stein ${className ?? 'mb-2'}`} aria-label="Legende">
      {eintraege.map((e) => (
        <li key={e.name} className="inline-flex items-center gap-1.5">
          <Schluessel farbe={e.farbe} form={e.form} />
          <span className="text-rinde">{e.name}</span>
        </li>
      ))}
    </ul>
  )
}

export function Schluessel({ farbe, form = 'flaeche' }: { farbe: string; form?: LegendenEintrag['form'] }) {
  if (form === 'linie') return <span className="inline-block w-3.5 h-0.5 rounded-full" style={{ backgroundColor: farbe }} aria-hidden />
  if (form === 'punkt') return <span className="inline-block w-2.5 h-2.5 rounded-full ring-2 ring-white" style={{ backgroundColor: farbe }} aria-hidden />
  return <span className="inline-block w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: farbe }} aria-hidden />
}

interface TooltipZeile {
  name?: string | number
  value?: unknown
  color?: string
  fill?: string
  stroke?: string
  dataKey?: unknown
  payload?: unknown
}

/** Tooltip: Wert fett vorn, Reihenname dahinter, Linien-Schlüssel. */
export function TooltipInhalt({ active, payload, label, titel, wert, summe, zusatz, umgekehrt }: {
  active?: boolean
  payload?: readonly TooltipZeile[]
  label?: string | number
  titel?: (label: string | number | undefined, zeile: unknown) => ReactNode
  wert?: (v: number, name: string) => string
  /** Summenzeile (z. B. bei gestapelten Säulen) */
  summe?: (v: number) => string
  zusatz?: (zeile: unknown) => ReactNode
  /** Reihenfolge umkehren (Stapel von oben nach unten lesen) */
  umgekehrt?: boolean
}) {
  if (!active || !payload?.length) return null
  const zeilen = payload.filter((p) => typeof p.value === 'number')
  const liste = umgekehrt ? [...zeilen].reverse() : zeilen
  const roh = payload[0]?.payload
  const f = wert ?? ((v: number) => fmtAchse(v))
  const gesamt = zeilen.reduce((s, p) => s + (p.value as number), 0)
  return (
    <div className="rounded-lg border border-sand bg-white px-3 py-2 text-xs shadow-md min-w-36">
      <div className="font-bold text-rinde mb-1">{titel ? titel(label, roh) : label}</div>
      <ul className="space-y-0.5">
        {liste.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
            <span className="inline-block w-3 h-0.5 rounded-full shrink-0" style={{ backgroundColor: p.color ?? p.stroke ?? p.fill }} aria-hidden />
            <span className="font-bold tabular-nums text-rinde">{f(p.value as number, String(p.name))}</span>
            <span className="text-stein">{p.name}</span>
          </li>
        ))}
      </ul>
      {summe && zeilen.length > 1 && (
        <div className="mt-1 pt-1 border-t border-sand flex gap-2"><span className="font-bold tabular-nums">{summe(gesamt)}</span><span className="text-stein">gesamt</span></div>
      )}
      {zusatz && <div className="mt-1 text-stein">{zusatz(roh)}</div>}
    </div>
  )
}

/** Gemeinsame Achsen-/Gitter-Props: zurückhaltend, Haarlinien, ohne Ticklinien. */
export const ACHSE = {
  tick: { fill: CHROME.text, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: CHROME.achse },
} as const
export const Y_ACHSE = {
  tick: { fill: CHROME.text, fontSize: 11 },
  tickLine: false,
  axisLine: false,
  tickFormatter: (v: number) => fmtAchse(v),
  width: 44,
} as const
export const GITTER = { stroke: CHROME.gitter, vertical: false } as const
export const TOOLTIP_CURSOR = { fill: 'rgba(47,38,32,0.05)' } as const
export const CROSSHAIR = { stroke: CHROME.achse, strokeWidth: 1 } as const
/** Säulen: max. 24 px, 4 px gerundetes Datenende, 2 px Flächenfuge. */
export const SAEULE = { maxBarSize: 24, stroke: CHROME.flaeche, strokeWidth: 1 } as const
export const RADIUS_OBEN: [number, number, number, number] = [4, 4, 0, 0]
export const RADIUS_RECHTS: [number, number, number, number] = [0, 4, 4, 0]
