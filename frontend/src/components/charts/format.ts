// Deutsche Formatierer für Achsen, Tooltips und Tabellen.
import { format, parseISO } from 'date-fns'
import { de } from 'date-fns/locale'
import { fmtZahl } from '../ui'

export { fmtZahl }

/** Achsenticks: runde Werte, kompakt ab 1.000 (1 Tsd.). */
export function fmtAchse(n: number): string {
  if (Math.abs(n) >= 1000) return `${fmtZahl(n / 1000, Math.abs(n) >= 10000 ? 0 : 1)} Tsd.`
  return fmtZahl(n, Number.isInteger(n) ? 0 : 1)
}
/** 12,3 Pal. */
export const fmtPal = (n: number | null | undefined, stellen = 1) => (n === null || n === undefined ? '–' : `${fmtZahl(n, stellen)} Pal.`)
/** +4,5 h / −2 h */
export function fmtStdVz(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–'
  const s = fmtZahl(Math.abs(n), Number.isInteger(n) ? 0 : 1)
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${s} h`
}
/** +12 % / −3 % (Veränderung als Anteil, 0.12 → +12 %) */
export function fmtDelta(n: number | null | undefined, stellen = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–'
  const s = fmtZahl(Math.abs(n * 100), stellen)
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${s} %`
}
/** "2026-03" → "Mär 26" */
export const fmtMonat = (m: string) => format(parseISO(`${m}-01`), 'MMM yy', { locale: de })
/** "2026-03" → "März 2026" */
export const fmtMonatLang = (m: string) => format(parseISO(`${m}-01`), 'MMMM yyyy', { locale: de })
/** Faktor ×1,4 */
export const fmtFaktor = (f: number) => `×${fmtZahl(f, f % 1 === 0 ? 0 : 1)}`
