// Gemeinsame Bausteine der Personal-Seiten (Cluster C): Formulare für Stammdaten/Verträge, Badges, Level-Punkte.
import { useQuery } from '@tanstack/react-query'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import {
  api, ROLLEN, STATUS, VERTRAGSARTEN, WOCHENTAGE, ABWESENHEITSTYPEN, LEVEL,
  type Abteilung, type Mitarbeiter, type MitarbeiterStamm, type MitarbeiterStatus, type Rolle, type VertragIn, type Vertragsart,
} from '../../api'
import { Badge, Field, StatusBadge, cx, eingabe, fmtDatum, fmtZahl, toISO } from '../ui'

/** Stichtag des Backends (PEP_HEUTE), Fallback: heutiges Browserdatum. */
export function useStichtag(): string {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard, staleTime: 60_000 })
  return q.data?.stichtag ?? toISO(new Date())
}

/** Tage bis zum Datum (negativ = vergangen). */
export const tageBis = (datum: string, stichtag: string) => differenceInCalendarDays(parseISO(datum), parseISO(stichtag))

/** Warnschwelle für ablaufende Zertifikate (wie Dashboard: 60 Tage). */
export const ZERT_WARN_TAGE = 60

export function zertStatus(bis: string | null, stichtag: string): 'ok' | 'warn' | 'verstoss' | null {
  if (!bis) return null
  const t = tageBis(bis, stichtag)
  return t < 0 ? 'verstoss' : t <= ZERT_WARN_TAGE ? 'warn' : 'ok'
}

// ------------------------------------------------------------------ Vertragsart-Vorgaben
type Vorgabe = Pick<VertragIn, 'soll_std_woche' | 'max_std_monat' | 'max_tage_woche' | 'urlaubstage'>
export const VERTRAG_VORGABEN: Record<Vertragsart, Vorgabe> = {
  vollzeit: { soll_std_woche: 40, max_std_monat: null, max_tage_woche: 5, urlaubstage: 28 },
  teilzeit: { soll_std_woche: 25, max_std_monat: null, max_tage_woche: 4, urlaubstage: 22 },
  minijob: { soll_std_woche: 10, max_std_monat: 43, max_tage_woche: 3, urlaubstage: 17 },
  werkstudent: { soll_std_woche: 18, max_std_monat: null, max_tage_woche: 3, urlaubstage: 17 },
  aushilfe: { soll_std_woche: 12, max_std_monat: null, max_tage_woche: 3, urlaubstage: 17 },
  azubi: { soll_std_woche: 40, max_std_monat: null, max_tage_woche: 5, urlaubstage: 30 },
}

export function neuerVertrag(art: Vertragsart, gueltig_ab: string): VertragIn {
  return {
    art, gueltig_ab, gueltig_bis: null, ...VERTRAG_VORGABEN[art],
    erlaubte_tage: '012345', frueheste_zeit: '05:00', spaeteste_zeit: '21:45', stundenlohn: 14,
  }
}

/** Formale Prüfung eines Vertrags; liefert Feldfehler. */
export function vertragFehler(v: VertragIn): Partial<Record<keyof VertragIn, string>> {
  const f: Partial<Record<keyof VertragIn, string>> = {}
  if (!v.gueltig_ab) f.gueltig_ab = 'Pflichtfeld'
  if (v.gueltig_bis && v.gueltig_ab && v.gueltig_bis < v.gueltig_ab) f.gueltig_bis = 'Liegt vor „gültig ab“'
  if (!(v.soll_std_woche >= 0) || v.soll_std_woche > 48) f.soll_std_woche = '0–48 h'
  if (v.max_tage_woche < 1 || v.max_tage_woche > 6) f.max_tage_woche = '1–6 Tage'
  if (!v.erlaubte_tage) f.erlaubte_tage = 'Mindestens einen Tag wählen'
  if (v.frueheste_zeit >= v.spaeteste_zeit) f.spaeteste_zeit = 'Muss nach „frühestens“ liegen'
  return f
}

export const erlaubteTageText = (s: string) => s.split('').map((t) => WOCHENTAGE[Number(t)]).join(' ')

// ------------------------------------------------------------------ Eingabebausteine
const zahl = (s: string) => (s === '' ? 0 : Number(s))

/** Sechs Toggle-Chips Mo–Sa für erlaubte Arbeitstage ("012345"). */
export function TageChips({ wert, onChange, fehler }: { wert: string; onChange: (w: string) => void; fehler?: string }) {
  const umschalten = (t: number) => {
    const s = new Set(wert.split('').map(Number))
    if (s.has(t)) s.delete(t)
    else s.add(t)
    onChange([...s].sort().join(''))
  }
  return (
    <div role="group" aria-label="Erlaubte Arbeitstage">
      <span className="block text-xs font-bold text-haselnuss mb-1">Erlaubte Tage</span>
      <div className="flex flex-wrap gap-1">
        {WOCHENTAGE.slice(0, 6).map((tag, i) => {
          const an = wert.includes(String(i))
          return (
            <button key={tag} type="button" aria-pressed={an} onClick={() => umschalten(i)}
              className={cx('w-10 py-1 rounded-full text-xs font-bold border transition-colors',
                an ? 'bg-fell text-white border-fell' : 'bg-white text-stein border-sand hover:border-fell')}>
              {tag}
            </button>
          )
        })}
      </div>
      {fehler && <span className="block text-xs text-verstoss mt-1">{fehler}</span>}
    </div>
  )
}

/** Eingabefelder eines Vertrags (kontrolliert). Beim Wechsel der Vertragsart werden die Vorgaben übernommen. */
export function VertragFelder({ wert, onChange, mitEnde = true, fehler = {} }:
  { wert: VertragIn; onChange: (v: VertragIn) => void; mitEnde?: boolean; fehler?: Partial<Record<keyof VertragIn, string>> }) {
  const set = <K extends keyof VertragIn>(k: K, v: VertragIn[K]) => onChange({ ...wert, [k]: v })
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Field label="Vertragsart" className="col-span-2" hinweis="Setzt Soll-Stunden und Tage auf Standardwerte">
        <select className={eingabe} value={wert.art}
          onChange={(e) => { const art = e.target.value as Vertragsart; onChange({ ...wert, art, ...VERTRAG_VORGABEN[art] }) }}>
          {Object.entries(VERTRAGSARTEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="Gültig ab" fehler={fehler.gueltig_ab}>
        <input type="date" className={eingabe} value={wert.gueltig_ab} required onChange={(e) => set('gueltig_ab', e.target.value)} />
      </Field>
      {mitEnde ? (
        <Field label="Gültig bis" fehler={fehler.gueltig_bis} hinweis="leer = unbefristet">
          <input type="date" className={eingabe} value={wert.gueltig_bis ?? ''} onChange={(e) => set('gueltig_bis', e.target.value || null)} />
        </Field>
      ) : <div />}
      <Field label="Soll h/Woche" fehler={fehler.soll_std_woche}>
        <input type="number" min={0} max={48} step={0.5} className={eingabe} value={wert.soll_std_woche}
          onChange={(e) => set('soll_std_woche', zahl(e.target.value))} />
      </Field>
      <Field label="Max. h/Monat" hinweis={wert.art === 'minijob' ? 'Minijob-Grenze' : 'optional'}>
        <input type="number" min={0} step={0.5} className={eingabe} value={wert.max_std_monat ?? ''}
          onChange={(e) => set('max_std_monat', e.target.value === '' ? null : Number(e.target.value))} />
      </Field>
      <Field label="Max. Tage/Woche" fehler={fehler.max_tage_woche}>
        <input type="number" min={1} max={6} className={eingabe} value={wert.max_tage_woche}
          onChange={(e) => set('max_tage_woche', zahl(e.target.value))} />
      </Field>
      <Field label="Urlaubstage/Jahr">
        <input type="number" min={0} max={40} className={eingabe} value={wert.urlaubstage}
          onChange={(e) => set('urlaubstage', zahl(e.target.value))} />
      </Field>
      <div className="col-span-2">
        <TageChips wert={wert.erlaubte_tage} onChange={(v) => set('erlaubte_tage', v)} fehler={fehler.erlaubte_tage} />
      </div>
      <Field label="Frühestens">
        <input type="time" step={900} className={eingabe} value={wert.frueheste_zeit} onChange={(e) => set('frueheste_zeit', e.target.value)} />
      </Field>
      <Field label="Spätestens" fehler={fehler.spaeteste_zeit}>
        <input type="time" step={900} className={eingabe} value={wert.spaeteste_zeit} onChange={(e) => set('spaeteste_zeit', e.target.value)} />
      </Field>
      <Field label="Stundenlohn (€)">
        <input type="number" min={0} step={0.01} className={eingabe} value={wert.stundenlohn}
          onChange={(e) => set('stundenlohn', zahl(e.target.value))} />
      </Field>
      {wert.erlaubte_tage.length > 0 && wert.max_tage_woche > wert.erlaubte_tage.length && (
        <p className="col-span-2 sm:col-span-3 self-end text-xs text-warn">Max. Tage/Woche übersteigt die Zahl erlaubter Tage.</p>
      )}
    </div>
  )
}

export function stammFehler(s: MitarbeiterStamm): Partial<Record<keyof MitarbeiterStamm, string>> {
  const f: Partial<Record<keyof MitarbeiterStamm, string>> = {}
  if (!s.persnr.trim()) f.persnr = 'Pflichtfeld'
  if (!s.vorname.trim()) f.vorname = 'Pflichtfeld'
  if (!s.nachname.trim()) f.nachname = 'Pflichtfeld'
  if (!s.geburtsdatum) f.geburtsdatum = 'Pflichtfeld'
  if (!s.eintritt) f.eintritt = 'Pflichtfeld'
  if (s.austritt && s.eintritt && s.austritt < s.eintritt) f.austritt = 'Liegt vor dem Eintritt'
  return f
}

/** Eingabefelder der Stammdaten (kontrolliert). */
export function StammFelder({ wert, onChange, abteilungen, fehler = {} }:
  { wert: MitarbeiterStamm; onChange: (s: MitarbeiterStamm) => void; abteilungen: Abteilung[]; fehler?: Partial<Record<keyof MitarbeiterStamm, string>> }) {
  const set = <K extends keyof MitarbeiterStamm>(k: K, v: MitarbeiterStamm[K]) => onChange({ ...wert, [k]: v })
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Field label="Personalnummer" fehler={fehler.persnr}>
        <input className={eingabe} value={wert.persnr} required onChange={(e) => set('persnr', e.target.value)} />
      </Field>
      <Field label="Vorname" fehler={fehler.vorname}>
        <input className={eingabe} value={wert.vorname} required onChange={(e) => set('vorname', e.target.value)} />
      </Field>
      <Field label="Nachname" fehler={fehler.nachname} className="col-span-2">
        <input className={eingabe} value={wert.nachname} required onChange={(e) => set('nachname', e.target.value)} />
      </Field>
      <Field label="Geburtsdatum" fehler={fehler.geburtsdatum}>
        <input type="date" className={eingabe} value={wert.geburtsdatum} required onChange={(e) => set('geburtsdatum', e.target.value)} />
      </Field>
      <Field label="Eintritt" fehler={fehler.eintritt}>
        <input type="date" className={eingabe} value={wert.eintritt} required onChange={(e) => set('eintritt', e.target.value)} />
      </Field>
      <Field label="Austritt" fehler={fehler.austritt} hinweis="optional">
        <input type="date" className={eingabe} value={wert.austritt ?? ''} onChange={(e) => set('austritt', e.target.value || null)} />
      </Field>
      <Field label="Stundenkonto (h)" hinweis="+ Überstunden / − Minusstunden">
        <input type="number" step={0.25} className={eingabe} value={wert.stundenkonto}
          onChange={(e) => set('stundenkonto', zahl(e.target.value))} />
      </Field>
      <Field label="Stammabteilung" className="col-span-2">
        <select className={eingabe} value={wert.stammabteilung_id ?? ''}
          onChange={(e) => set('stammabteilung_id', e.target.value ? Number(e.target.value) : null)}>
          <option value="">– keine –</option>
          {abteilungen.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Rolle">
        <select className={eingabe} value={wert.rolle} onChange={(e) => set('rolle', e.target.value as Rolle)}>
          {Object.entries(ROLLEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select className={eingabe} value={wert.status} onChange={(e) => set('status', e.target.value as MitarbeiterStatus)}>
          {Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
    </div>
  )
}

// ------------------------------------------------------------------ Anzeige
/** Stundenkonto mit Vorzeichen, farbig (+ ok, − verstoss) und Textform für Screenreader. */
export function Stundenkonto({ wert }: { wert: number }) {
  const text = `${wert > 0 ? '+' : wert < 0 ? '−' : '±'}${fmtZahl(Math.abs(wert), Number.isInteger(wert) ? 0 : 1)} h`
  return (
    <span className={cx('tabular-nums font-bold', wert > 0 ? 'text-ok' : wert < 0 ? 'text-verstoss' : 'text-stein')}
      title={wert > 0 ? 'Überstunden' : wert < 0 ? 'Minusstunden' : 'ausgeglichen'}>
      {text}
    </span>
  )
}

export function StatusAnzeige({ status }: { status: MitarbeiterStatus }) {
  if (status === 'aktiv') return <Badge ton="ok" icon="ok">aktiv</Badge>
  if (status === 'inaktiv') return <Badge ton="neutral" icon="x">inaktiv</Badge>
  return <Badge ton="info" icon="info">{STATUS[status]}</Badge>
}

/** Hinweis-Badges: Mutterschutz, minderjährig (JArbSchG), heute abwesend. */
export function MitarbeiterHinweise({ m }: { m: Mitarbeiter }) {
  return (
    <div className="flex flex-wrap gap-1">
      {m.status === 'mutterschutz' && <StatusBadge status="warn" titel="Beschäftigungsverbote nach MuSchG beachten">Mutterschutz</StatusBadge>}
      {m.minderjaehrig && <StatusBadge status="warn" titel={`${m.alter} Jahre – Jugendarbeitsschutzgesetz`}>minderjährig (JArbSchG)</StatusBadge>}
      {m.abwesend_heute && (
        <Badge ton="info" icon="kalender" titel={`bis ${fmtDatum(m.abwesend_heute.bis)}`}>
          heute: {ABWESENHEITSTYPEN[m.abwesend_heute.typ]}
        </Badge>
      )}
    </div>
  )
}

/** Level als 1–3 gefüllte Punkte in Fell-Tönen (+ Text für Screenreader). */
export function LevelPunkte({ level, klein }: { level: number; klein?: boolean }) {
  const ton = ['', 'bg-fell-hell border-fell/60', 'bg-eichel border-eichel', 'bg-fell-dunkel border-fell-dunkel'][level]
  return (
    <span className="inline-flex items-center gap-0.5" title={`Level ${level}: ${LEVEL[level]}`}>
      {[1, 2, 3].map((i) => (
        <span key={i} aria-hidden
          className={cx('rounded-full border', klein ? 'w-1.5 h-1.5' : 'w-2 h-2', i <= level ? ton : 'bg-white border-sand')} />
      ))}
      <span className="sr-only">Level {level} ({LEVEL[level]})</span>
    </span>
  )
}

/** Segment-Auswahl Level 1–3. */
export function LevelAuswahl({ wert, onChange, disabled, label }: { wert: number; onChange: (l: 1 | 2 | 3) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-lg border border-sand bg-white p-0.5', disabled && 'opacity-50')}>
      {([1, 2, 3] as const).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={wert === l} disabled={disabled} onClick={() => onChange(l)}
          title={LEVEL[l]}
          className={cx('px-2.5 py-0.5 text-xs font-bold rounded-md transition-colors',
            wert === l ? 'bg-fell text-white' : 'text-haselnuss hover:bg-fell-hell')}>
          {l}
        </button>
      ))}
    </div>
  )
}
