// UI-Bausteine im Eichhörnchen-Design (Tokens in index.css).
// Regeln: Primärfarbe "fell" nur für Aktionen/aktive Navigation; Status immer mit Icon + Text, nie nur Farbe.
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { format, parseISO } from 'date-fns'
import { de } from 'date-fns/locale'

export function cx(...klassen: (string | false | null | undefined)[]) {
  return klassen.filter(Boolean).join(' ')
}

// ------------------------------------------------------------------ Formatierung
export const toISO = (d: Date) => format(d, 'yyyy-MM-dd')
export const vonISO = (s: string) => parseISO(s)
/** 13.10.2026 */
export const fmtDatum = (s: string | null | undefined) => (s ? format(parseISO(s), 'dd.MM.yyyy') : '–')
/** 13.10. */
export const fmtDatumKurz = (s: string) => format(parseISO(s), 'dd.MM.')
/** Di, 13.10. */
export const fmtTag = (s: string) => format(parseISO(s), 'EEEEEE, dd.MM.', { locale: de })
/** Dienstag, 13. Oktober 2026 */
export const fmtDatumLang = (s: string) => format(parseISO(s), 'EEEE, d. MMMM yyyy', { locale: de })
export const fmtZahl = (n: number | null | undefined, stellen = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? '–' : n.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen })
/** 7,5 h */
export const fmtStd = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${fmtZahl(n, Number.isInteger(n) ? 0 : 1)} h`)
export const fmtProzent = (n: number | null | undefined, stellen = 0) => (n === null || n === undefined ? '–' : `${fmtZahl(n * 100, stellen)} %`)

// ------------------------------------------------------------------ Icons (inline SVG, stroke = currentColor)
const ICONS = {
  ok: 'M5 12l5 5L20 7',
  warn: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  verstoss: 'M12 8v5m0 3h.01M12 3a9 9 0 100 18 9 9 0 000-18z',
  info: 'M12 16v-5m0-3h.01M12 3a9 9 0 100 18 9 9 0 000-18z',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  stift: 'M4 20h4L19 9l-4-4L4 16v4z',
  muell: 'M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13',
  schloss: 'M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z',
  links: 'M15 6l-6 6 6 6',
  rechts: 'M9 6l6 6-6 6',
  suche: 'M11 4a7 7 0 100 14 7 7 0 000-14zm9 16l-4-4',
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14',
  zauber: 'M5 19L19 5M15 4v3m-1.5-1.5h3M19 9v2m-1-1h2M8 3v2M7 4h2',
  kalender: 'M4 6h16v14H4zM4 10h16M8 3v4m8-4v4',
  person: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0',
  eichel: 'M12 21c-3.5 0-6-3-6-7h12c0 4-2.5 7-6 7zM5 14h14c0-3-3-5-7-5s-7 2-7 5zM12 9V5m0 0c1-1 3-1 4 0',
}
export type IconName = keyof typeof ICONS

export function Icon({ name, className = 'w-4 h-4', titel }: { name: IconName; className?: string; titel?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={cx('inline-block shrink-0', className)} aria-hidden={titel ? undefined : true} role={titel ? 'img' : undefined}>
      {titel && <title>{titel}</title>}
      <path d={ICONS[name]} />
    </svg>
  )
}

/** Eichhörnchen-Wortmarke (Logo). */
export function Eichhoernchen({ className = 'w-9 h-9' }: { className?: string }) {
  return <img src="/eichhoernchen.svg" alt="" className={className} />
}

// ------------------------------------------------------------------ Buttons
type ButtonVariante = 'primaer' | 'sekundaer' | 'leise' | 'gefahr'
export function Button({ variante = 'sekundaer', klein, icon, children, className, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: ButtonVariante; klein?: boolean; icon?: IconName }) {
  const stil: Record<ButtonVariante, string> = {
    primaer: 'bg-fell text-white hover:bg-fell-dunkel shadow-sm',
    sekundaer: 'bg-white text-rinde border border-sand hover:border-fell hover:text-fell-dunkel',
    leise: 'text-haselnuss hover:bg-fell-hell',
    gefahr: 'bg-white text-verstoss border border-verstoss/40 hover:bg-verstoss-hell',
  }
  return (
    <button type="button" {...rest}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none',
        klein ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm', stil[variante], className)}>
      {icon && <Icon name={icon} className={klein ? 'w-3.5 h-3.5' : 'w-4 h-4'} />}
      {children}
    </button>
  )
}

// ------------------------------------------------------------------ Layout
export function SeitenKopf({ titel, untertitel, aktionen }: { titel: string; untertitel?: ReactNode; aktionen?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-extrabold text-rinde tracking-tight">{titel}</h1>
        {untertitel && <p className="text-sm text-stein mt-1">{untertitel}</p>}
      </div>
      {aktionen && <div className="flex flex-wrap items-center gap-2">{aktionen}</div>}
    </div>
  )
}

export function Card({ titel, aktionen, children, className, polster = true }:
  { titel?: ReactNode; aktionen?: ReactNode; children: ReactNode; className?: string; polster?: boolean }) {
  return (
    <section className={cx('bg-white rounded-[var(--radius-eich)] border border-sand shadow-[0_1px_2px_rgba(47,38,32,0.05)]', className)}>
      {(titel || aktionen) && (
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-sand">
          {titel && <h2 className="font-bold text-rinde">{titel}</h2>}
          {aktionen && <div className="flex items-center gap-2">{aktionen}</div>}
        </header>
      )}
      <div className={polster ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

/** Kennzahl-Kachel: Wert groß, Beschriftung klein, optional Trend/Hinweis. */
export function StatKachel({ label, wert, hinweis, ton = 'neutral' }:
  { label: string; wert: ReactNode; hinweis?: ReactNode; ton?: 'neutral' | 'ok' | 'warn' | 'verstoss' }) {
  const farbe = { neutral: 'text-rinde', ok: 'text-ok', warn: 'text-warn', verstoss: 'text-verstoss' }[ton]
  return (
    <div className="bg-white rounded-[var(--radius-eich)] border border-sand px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-wide text-stein">{label}</div>
      <div className={cx('text-2xl font-extrabold mt-1 tabular-nums', farbe)}>{wert}</div>
      {hinweis && <div className="text-xs text-stein mt-0.5">{hinweis}</div>}
    </div>
  )
}

export function Tabs<T extends string>({ werte, aktiv, onChange }: { werte: { wert: T; label: string }[]; aktiv: T; onChange: (w: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-sand bg-white p-0.5" role="tablist">
      {werte.map((w) => (
        <button key={w.wert} type="button" role="tab" aria-selected={aktiv === w.wert} onClick={() => onChange(w.wert)}
          className={cx('px-3 py-1.5 text-sm font-semibold rounded-md transition-colors',
            aktiv === w.wert ? 'bg-fell text-white' : 'text-haselnuss hover:bg-fell-hell')}>
          {w.label}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ Badges & Status
export type Ton = 'neutral' | 'ok' | 'warn' | 'verstoss' | 'fell' | 'moos' | 'info'
export function Badge({ ton = 'neutral', icon, children, titel }: { ton?: Ton; icon?: IconName; children: ReactNode; titel?: string }) {
  const stil: Record<Ton, string> = {
    neutral: 'bg-sand text-rinde',
    ok: 'bg-ok-hell text-ok',
    warn: 'bg-warn-hell text-warn',
    verstoss: 'bg-verstoss-hell text-verstoss',
    fell: 'bg-fell-hell text-fell-dunkel',
    moos: 'bg-moos-hell text-moos',
    info: 'bg-[#E4EEF6] text-[#2A5F8A]',
  }
  return (
    <span title={titel} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap', stil[ton])}>
      {icon && <Icon name={icon} className="w-3 h-3" />}
      {children}
    </span>
  )
}

/** Status-Badge mit festem Icon: ok / warn / verstoss. */
export function StatusBadge({ status, children, titel }: { status: 'ok' | 'warn' | 'verstoss'; children: ReactNode; titel?: string }) {
  return <Badge ton={status} icon={status} titel={titel}>{children}</Badge>
}

export function AbteilungsPunkt({ farbe, className = 'w-2.5 h-2.5' }: { farbe: string; className?: string }) {
  return <span className={cx('inline-block rounded-full shrink-0', className)} style={{ backgroundColor: farbe }} aria-hidden />
}

export function Hinweis({ ton = 'info', titel, children, onSchliessen }:
  { ton?: 'info' | 'ok' | 'warn' | 'verstoss'; titel?: string; children?: ReactNode; onSchliessen?: () => void }) {
  const stil = {
    info: 'bg-[#EEF4F9] border-[#B9D0E4] text-[#24527A]',
    ok: 'bg-ok-hell border-ok/30 text-ok',
    warn: 'bg-warn-hell border-warn/30 text-warn',
    verstoss: 'bg-verstoss-hell border-verstoss/30 text-verstoss',
  }[ton]
  return (
    <div className={cx('flex gap-2 rounded-lg border px-3 py-2 text-sm', stil)} role={ton === 'verstoss' ? 'alert' : 'status'}>
      <Icon name={ton === 'info' ? 'info' : ton} className="w-4 h-4 mt-0.5" />
      <div className="flex-1">
        {titel && <div className="font-bold">{titel}</div>}
        {children && <div className="text-rinde/90">{children}</div>}
      </div>
      {onSchliessen && (
        <button type="button" onClick={onSchliessen} aria-label="Schließen" className="opacity-70 hover:opacity-100"><Icon name="x" /></button>
      )}
    </div>
  )
}

export function Laden({ text = 'Wird geladen …' }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 text-stein text-sm py-8 justify-center">
      <span className="w-4 h-4 rounded-full border-2 border-fell border-t-transparent animate-spin" />
      {text}
    </div>
  )
}

export function Fehler({ fehler }: { fehler: unknown }) {
  const text = fehler instanceof Error ? fehler.message : String(fehler)
  return <Hinweis ton="verstoss" titel="Fehler">{text}</Hinweis>
}

export function Leer({ titel, children }: { titel: string; children?: ReactNode }) {
  return (
    <div className="text-center py-10 text-stein">
      <Icon name="eichel" className="w-8 h-8 mx-auto text-eichel" />
      <div className="font-bold text-rinde mt-2">{titel}</div>
      {children && <div className="text-sm mt-1">{children}</div>}
    </div>
  )
}

// ------------------------------------------------------------------ Formulare
export function Field({ label, hinweis, fehler, children, className }:
  { label: string; hinweis?: ReactNode; fehler?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="block text-xs font-bold text-haselnuss mb-1">{label}</span>
      {children}
      {hinweis && !fehler && <span className="block text-xs text-stein mt-1">{hinweis}</span>}
      {fehler && <span className="block text-xs text-verstoss mt-1">{fehler}</span>}
    </label>
  )
}
/** Klassenname für <input>, <select>, <textarea>. */
export const eingabe = 'eingabe'

export function Modal({ offen, titel, onSchliessen, children, fuss, breit }:
  { offen: boolean; titel: string; onSchliessen: () => void; children: ReactNode; fuss?: ReactNode; breit?: boolean }) {
  useEffect(() => {
    if (!offen) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onSchliessen()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [offen, onSchliessen])
  if (!offen) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-rinde/40 p-4 pt-[8vh]" onMouseDown={onSchliessen}>
      <div role="dialog" aria-modal="true" aria-label={titel} onMouseDown={(e) => e.stopPropagation()}
        className={cx('w-full bg-white rounded-[var(--radius-eich)] shadow-xl border border-sand', breit ? 'max-w-3xl' : 'max-w-lg')}>
        <header className="flex items-center justify-between px-5 py-3 border-b border-sand">
          <h2 className="font-extrabold text-lg">{titel}</h2>
          <button type="button" onClick={onSchliessen} aria-label="Schließen" className="text-stein hover:text-rinde"><Icon name="x" className="w-5 h-5" /></button>
        </header>
        <div className="p-5">{children}</div>
        {fuss && <footer className="flex justify-end gap-2 px-5 py-3 border-t border-sand bg-creme rounded-b-[var(--radius-eich)]">{fuss}</footer>}
      </div>
    </div>
  )
}
