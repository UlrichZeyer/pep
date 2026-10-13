// Zeit- und Datumshilfen der Einsatzplanung (15-Minuten-Raster, Minuten, Wochen).
import { addDays, endOfMonth, getISOWeek, getISOWeekYear, parseISO, startOfMonth, startOfISOWeek } from 'date-fns'
import { toISO } from '../../components/ui'

export const TAG_BEGINN = 5 * 60 // 05:00
export const TAG_ENDE = 22 * 60 // 22:00
export const RASTER = 15
export const SLOT = 30

/** "HH:MM" → Minuten seit Mitternacht */
export function zuMin(zeit: string): number {
  const [h, m] = zeit.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Minuten → "HH:MM" */
export function vonMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Alle Zeiten im 15-Minuten-Raster von 05:00 bis 22:00. */
export const RASTER_ZEITEN: string[] = Array.from({ length: (TAG_ENDE - TAG_BEGINN) / RASTER + 1 }, (_, i) => vonMin(TAG_BEGINN + i * RASTER))

/** Auf das 15-Minuten-Raster runden. */
export const aufRaster = (zeit: string) => vonMin(Math.round(zuMin(zeit) / RASTER) * RASTER)

/** Mindestpause nach § 4 ArbZG (gleiche Logik wie backend/app/util.py). */
export function gesetzlichePause(bruttoMin: number): number {
  if (bruttoMin > 9 * 60 + 45) return 45
  if (bruttoMin > 6 * 60 + 30) return 30
  if (bruttoMin > 6 * 60) return bruttoMin - 6 * 60
  return 0
}

/** Netto-Arbeitszeit in Stunden. */
export function nettoStd(beginn: string, ende: string, pauseMin: number): number {
  return Math.max(0, zuMin(ende) - zuMin(beginn) - pauseMin) / 60
}

/** Montag der ISO-Woche als ISO-String. */
export const montagVon = (datum: string) => toISO(startOfISOWeek(parseISO(datum)))

/** Mo–Sa der Woche (ISO-Strings). */
export const wochentage = (montag: string) => Array.from({ length: 6 }, (_, i) => toISO(addDays(parseISO(montag), i)))

export const plusTage = (datum: string, n: number) => toISO(addDays(parseISO(datum), n))

export const kw = (datum: string) => getISOWeek(parseISO(datum))
export const kwJahr = (datum: string) => getISOWeekYear(parseISO(datum))

export const monatsAnfang = (datum: string) => toISO(startOfMonth(parseISO(datum)))
export const monatsEnde = (datum: string) => toISO(endOfMonth(parseISO(datum)))

/** 0 = Mo … 6 = So */
export const wochentagIndex = (datum: string) => (parseISO(datum).getDay() + 6) % 7

/** Schichtkürzel für den Monatsplan: F < 10:00, M 10–13 Uhr, S ≥ 13:00. */
export function schichtKuerzel(beginn: string): 'F' | 'M' | 'S' {
  const m = zuMin(beginn)
  if (m < 10 * 60) return 'F'
  if (m < 13 * 60) return 'M'
  return 'S'
}

/** Prüft, ob ein Datum (ISO) im Bereich [von, bis] liegt. */
export const imBereich = (datum: string, von: string, bis: string) => datum >= von && datum <= bis

/** Hex-Farbe mit Deckkraft (für helle Abteilungsflächen). */
export function farbeHell(hex: string, alpha = 0.16): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
