// Gemeinsame Kalender-Hilfen für Abwesenheiten- und Kalenderseite (Cluster D).
import type { AbwesenheitTyp, Kalender, Kalendereintrag } from '../../api'

/** Informationen zu einem Kalendertag (Feiertag BW, Einträge, Urlaubssperre). */
export interface TagInfo {
  feiertag: string | null
  eintraege: Kalendereintrag[]
  hotday: Kalendereintrag | null
  schliesstag: Kalendereintrag | null
  sondertag: Kalendereintrag | null
  urlaubssperre: boolean
  /** höchster Lastfaktor der Einträge (1 = normal) */
  lastfaktor: number
}

/** Kalender-Antwort(en) → Map ISO-Datum → TagInfo. */
export function tagInfos(...kalender: (Kalender | undefined)[]): Map<string, TagInfo> {
  const m = new Map<string, TagInfo>()
  const holen = (d: string) => {
    let t = m.get(d)
    if (!t) {
      t = { feiertag: null, eintraege: [], hotday: null, schliesstag: null, sondertag: null, urlaubssperre: false, lastfaktor: 1 }
      m.set(d, t)
    }
    return t
  }
  for (const k of kalender) {
    if (!k) continue
    for (const f of k.feiertage) holen(f.datum).feiertag = f.name
    for (const e of k.eintraege) {
      const t = holen(e.datum)
      t.eintraege.push(e)
      if (e.typ === 'hotday' && (!t.hotday || e.lastfaktor > t.hotday.lastfaktor)) t.hotday = e
      if (e.typ === 'schliesstag') t.schliesstag = e
      if (e.typ === 'sondertag') t.sondertag = e
      if (e.urlaubssperre) t.urlaubssperre = true
      t.lastfaktor = Math.max(t.lastfaktor, e.lastfaktor)
    }
  }
  return m
}

/** Tooltip-Text eines Tages. */
export function tagTitel(t: TagInfo | undefined): string {
  if (!t) return ''
  const teile: string[] = []
  if (t.feiertag) teile.push(`Feiertag: ${t.feiertag} (geschlossen)`)
  for (const e of t.eintraege) {
    const art = { hotday: 'Hotday', sondertag: 'Sondertag', schliesstag: 'Schließtag' }[e.typ]
    teile.push(`${art}: ${e.name}${e.lastfaktor !== 1 ? ` (Last ×${e.lastfaktor.toLocaleString('de-DE')})` : ''}${e.urlaubssperre ? ' – Urlaubssperre' : ''}`)
  }
  return teile.join('\n')
}

/** Schraffur für geschlossene Tage (Sonntag/Feiertag/Schließtag). */
export const SCHRAFFUR = 'repeating-linear-gradient(135deg, rgba(125,114,104,0.16) 0 2px, transparent 2px 6px)'

/** Ruhige Kategorie-Palette für Abwesenheitstypen – bewusst ohne Grün/Orange/Rot (Statusfarben) und ohne Fell. */
export const ABWESENHEITSFARBEN: Record<AbwesenheitTyp, { voll: string; hell: string }> = {
  urlaub: { voll: '#3F7CAC', hell: '#DCE8F3' },
  krank: { voll: '#7E62A8', hell: '#EAE3F3' },
  schule: { voll: '#2E8582', hell: '#DAEEEC' },
  fortbildung: { voll: '#55658C', hell: '#E1E5EF' },
  wunschfrei: { voll: '#8C8150', hell: '#EFECDD' },
  sonstiges: { voll: '#7D7268', hell: '#ECE8E4' },
}

/** Hotday-Intensität nach Lastfaktor (Fell-Töne). */
export function hotdayStil(lastfaktor: number): { backgroundColor: string; color: string } {
  if (lastfaktor >= 1.6) return { backgroundColor: '#B5541E', color: '#fff' }
  if (lastfaktor >= 1.45) return { backgroundColor: '#CC7A48', color: '#fff' }
  if (lastfaktor >= 1.3) return { backgroundColor: '#E3A77F', color: '#2F2620' }
  return { backgroundColor: '#F6E3D3', color: '#2F2620' }
}

/** Flammen-Symbol (Hotday) als SVG-Pfad – ergänzt die Icons aus ui.tsx. */
export const FLAMME_PFAD = 'M12 3c1 3 4 4.5 4 9a4 4 0 01-8 0c0-2 1-3 1-3 0 1.5 1 2 1 2 0-3 2-5 2-8z'
