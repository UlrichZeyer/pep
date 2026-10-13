// Diagrammfarben im Eichhörnchen-Design (dataviz-Regeln: Farbe folgt der Entität, nie dem Rang).
//
// Kategoriale Palette für Warengruppen – warm, aus den Design-Tokens abgeleitet und geprüft mit
// dataviz/scripts/validate_palette.js (light, Fläche #ffffff, benachbarte Paare):
//   Helligkeitsband 0,43–0,77 ✓ · Chroma ≥ 0,10 ✓ · CVD ΔE min 14,9 ✓ (Ziel ≥ 8)
//   Normalsicht ΔE min 21,9 ✓ (≥ 15) · Kontrast ≥ 3:1 ✓
// Reihenfolge ist fest (Slot = Position der Warengruppe nach id), nie zyklisch.
// Die Abteilungsfarben (abteilung.farbe) bestehen die Prüfung als Satz NICHT (Trocken ↔ O&G ΔE 1,1 protan),
// deshalb nur als Punkt neben Text bzw. in Small Multiples verwenden, nie als alleinige Unterscheidung.
import type { Warengruppe } from '../../api'

export const KATEGORIE_PALETTE = [
  '#B5541E', // fell (Rostrot)
  '#009099', // petrol
  '#BF8314', // eichel (Ocker)
  '#9C4A8C', // pflaume
  '#5E8A2E', // moos
  '#3E6FB0', // gedecktes Blau
  '#B83A4B', // beere
] as const

/** Sammelfarbe für „Sonstige“ (8. Reihe und mehr wird nie generiert). */
export const FARBE_SONSTIGE = '#9C928A'

/** Neutrale Diagramm-Chrome (Gitter, Achsen, Text) – Tokens aus index.css. */
export const CHROME = {
  gitter: '#EFE6DA', // sand
  achse: '#D9CCBB',
  text: '#7D7268', // stein
  textStark: '#2F2620', // rinde
  flaeche: '#FFFFFF',
  hervorhebung: '#B5541E', // fell – Akzent für die „aktuelle“ Reihe
  gesamt: '#7A4E2D', // haselnuss – Einzelreihe „Gesamt“
} as const

/** Statusfarben – ausschließlich für Status (immer mit Icon + Text). */
export const STATUS_FARBE = { ok: '#2E7D32', warn: '#B26A00', verstoss: '#C62828' } as const

/** Sequenzielle Rampe (ein Farbton Petrol, hell → dunkel) für Heatmaps – geprüft (ordinal ✓). 0 = leere Zelle. */
export const SEQ_PETROL = ['#74BDC1', '#3FA0A6', '#16828A', '#0E6268', '#08444A'] as const

/** Divergierend (Stundenkonto): Minus = fell, Plus = gedecktes Blau, Mitte = sand. CVD ΔE 20,8 ✓. */
export const DIVERGIEREND = { negativ: '#B5541E', neutral: '#D9CCBB', positiv: '#3E6FB0' } as const

/** Farbe je Warengruppe – fester Slot nach id-Reihenfolge der Stammdaten. */
export function warengruppenFarben(warengruppen: Warengruppe[]): Record<number, string> {
  const sortiert = [...warengruppen].sort((a, b) => a.id - b.id)
  return Object.fromEntries(sortiert.map((w, i) => [w.id, KATEGORIE_PALETTE[i] ?? FARBE_SONSTIGE]))
}

/** Stufe der sequenziellen Rampe für einen Wert 0..max. */
export function seqFarbe(wert: number, max: number): string | null {
  if (!(max > 0) || !(wert > 0)) return null
  const i = Math.min(SEQ_PETROL.length - 1, Math.floor((wert / max) * SEQ_PETROL.length))
  return SEQ_PETROL[i]
}

/** Text auf farbiger Fläche: weiß oder Tinte je nach Leuchtdichte. */
export function textAuf(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const kanal = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  const l = 0.2126 * kanal((n >> 16) & 255) + 0.7152 * kanal((n >> 8) & 255) + 0.0722 * kanal(n & 255)
  return l > 0.35 ? CHROME.textStark : '#FFFFFF'
}
