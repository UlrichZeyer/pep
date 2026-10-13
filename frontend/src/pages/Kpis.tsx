// KPI-Seite (KONZEPT 3.4/3.5): Anlieferung, Prognose & Bedarf, Abdeckung, Leistung, Stunden & Personal.
// Jede Karte lädt und scheitert für sich (ChartKarte) – die Seite bleibt bedienbar, auch wenn einzelne Endpunkte fehlen.
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, endOfMonth, format, getISOWeek, getISODay, parseISO, startOfMonth, startOfWeek, subDays, subMonths } from 'date-fns'
import { de } from 'date-fns/locale'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, VERTRAGSARTEN, WOCHENTAGE, type AbdeckungWert, type Abteilung, type BedarfTag, type Warengruppe } from '../api'
import { useStammdaten } from '../hooks'
import { AbteilungsPunkt, Badge, Button, SeitenKopf, StatKachel, StatusBadge, cx, fmtProzent, fmtStd, fmtTag, toISO } from '../components/ui'
import { ChartKarte, Umschalter } from '../components/charts/ChartKarte'
import { ACHSE, CROSSHAIR, GITTER, Legende, RADIUS_OBEN, SAEULE, Schluessel, TOOLTIP_CURSOR, TooltipInhalt, Y_ACHSE } from '../components/charts/Legende'
import { CHROME, DIVERGIEREND, seqFarbe, textAuf, warengruppenFarben } from '../components/charts/farben'
import { fmtDelta, fmtFaktor, fmtMonat, fmtMonatLang, fmtPal, fmtStdVz, fmtZahl } from '../components/charts/format'

// ------------------------------------------------------------------ Zeitbezug
const heute = new Date()
const montagVon = (d: Date) => startOfWeek(d, { weekStartsOn: 1 })
const wochentagVon = (iso: string) => getISODay(parseISO(iso)) - 1 // 0 = Mo
const wgKey = (id: number) => `wg${id}`

const ABSCHNITTE = [
  { id: 'anlieferung', label: 'Anlieferung' },
  { id: 'bedarf', label: 'Prognose & Bedarf' },
  { id: 'abdeckung', label: 'Abdeckung' },
  { id: 'leistung', label: 'Leistung' },
  { id: 'personal', label: 'Stunden & Personal' },
]

export default function Kpis() {
  return (
    <div>
      <SeitenKopf titel="KPIs & Bedarf" untertitel="Wareneingang, Prognose, Personalbedarf und Abdeckung der Filiale" />
      <nav className="sticky top-0 z-10 -mx-1 mb-6 flex flex-wrap gap-1 bg-creme/95 px-1 py-2 backdrop-blur" aria-label="Abschnitte">
        {ABSCHNITTE.map((a) => (
          <a key={a.id} href={`#${a.id}`} className="rounded-md px-3 py-1.5 text-sm font-semibold text-haselnuss hover:bg-fell-hell">{a.label}</a>
        ))}
      </nav>
      <div className="space-y-10">
        <Abschnitt id="anlieferung" titel="Anlieferung" text="Paletten je Tag und Warengruppe aus der Anlieferungshistorie"><Anlieferung /></Abschnitt>
        <Abschnitt id="bedarf" titel="Prognose & Bedarf" text="Wochentagsmittel × Saison × Hotday-Faktor → Stunden und Köpfe je Abteilung"><PrognoseBedarf /></Abschnitt>
        <Abschnitt id="abdeckung" titel="Abdeckung" text="Geplante Stunden ÷ benötigte Stunden in der aktuellen Woche"><Abdeckung /></Abschnitt>
        <Abschnitt id="leistung" titel="Leistung" text="Ist-Paletten je Personenstunde, letzte 4 Wochen"><Leistung /></Abschnitt>
        <Abschnitt id="personal" titel="Stunden & Personal" text="Stundenkonten, Soll/Plan im laufenden Monat, Krankenquote, Urlaub, Skills"><StundenPersonal /></Abschnitt>
      </div>
    </div>
  )
}

function Abschnitt({ id, titel, text, children }: { id: string; titel: string; text: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16">
      <div className="mb-3">
        <h2 className="text-lg font-extrabold text-rinde">{titel}</h2>
        <p className="text-sm text-stein">{text}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/** Tabellenansicht zu einem Diagramm (zugänglich ohne Hover). */
function TabellenAnsicht({ children }: { children: ReactNode }) {
  return (
    <details className="mt-3 group">
      <summary className="cursor-pointer select-none text-xs font-semibold text-haselnuss hover:text-fell-dunkel">Als Tabelle anzeigen</summary>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </details>
  )
}

const mittel = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const summe = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

/** Warengruppen mit fester Farbe (Slot nach id). */
function useWarengruppen() {
  const st = useStammdaten()
  const farben = useMemo(() => warengruppenFarben(st.warengruppen), [st.warengruppen])
  const liste = useMemo(() => [...st.warengruppen].sort((a, b) => a.id - b.id), [st.warengruppen])
  return { ...st, wgListe: liste, wgFarbe: farben }
}

function wgLegende(liste: Warengruppe[], farbe: Record<number, string>, form: 'flaeche' | 'linie' = 'flaeche') {
  return liste.map((w) => ({ name: w.name, farbe: farbe[w.id], form }))
}

// ================================================================== 1. Anlieferung
function Anlieferung() {
  const { wgListe, wgFarbe, ...st } = useWarengruppen()
  const von = toISO(startOfMonth(subMonths(heute, 11)))
  const bis = toISO(subDays(heute, 1))
  const anl = useQuery({ queryKey: ['kpi', 'anlieferung', von, bis], queryFn: () => api.kpiAnlieferung(von, bis) })
  const jahre = [...new Set([parseISO(von).getFullYear(), parseISO(bis).getFullYear()])]
  const kal = useQuery({
    queryKey: ['kalender', 'hotdays', ...jahre],
    queryFn: async () => (await Promise.all(jahre.map((j) => api.kalender(j)))).flatMap((k) => k.eintraege),
  })
  const hotdays = useMemo(() => {
    const m = new Map<string, { name: string; lastfaktor: number }>()
    for (const e of kal.data ?? []) if (e.typ === 'hotday') m.set(e.datum, { name: e.name, lastfaktor: e.lastfaktor })
    return m
  }, [kal.data])

  const [fenster, setFenster] = useState<'4' | '8' | '12'>('4')
  const [trendArt, setTrendArt] = useState<'gesamt' | 'wg'>('gesamt')

  const d = anl.data
  // Liefertage = Tage mit Anlieferung (So/Feiertage/Schließtage fallen heraus)
  const liefertage = useMemo(() => (d?.reihe ?? []).filter((r) => r.gesamt > 0), [d])
  const kennzahlen = useMemo(() => {
    const grenze4 = toISO(subDays(heute, 28))
    const grenze8 = toISO(subDays(heute, 56))
    const t4 = liefertage.filter((r) => r.datum >= grenze4)
    const t8 = liefertage.filter((r) => r.datum >= grenze8)
    const m4 = mittel(t4.map((r) => r.gesamt))
    const m8 = mittel(t8.map((r) => r.gesamt))
    const spitze = t4.reduce<(typeof t4)[number] | null>((b, r) => (!b || r.gesamt > b.gesamt ? r : b), null)
    const hd = liefertage.filter((r) => hotdays.has(r.datum)).length
    return { m4, m8, trend: m4 !== null && m8 ? m4 / m8 - 1 : null, spitze, hd, n: liefertage.length }
  }, [liefertage, hotdays])

  const wochentagDaten = useMemo(() => (d?.wochentagsmittel?.[fenster] ?? [])
    .filter((z) => z.wochentag <= 5)
    .sort((a, b) => a.wochentag - b.wochentag)
    .map((z) => ({ tag: WOCHENTAGE[z.wochentag], gesamt: z.gesamt, ...Object.fromEntries(wgListe.map((w) => [wgKey(w.id), z.je_warengruppe[String(w.id)] ?? 0])) })), [d, fenster, wgListe])

  const lfdMonat = format(heute, 'yyyy-MM')
  const monatDaten = useMemo(() => (d?.monate ?? []).map((m) => ({
    monat: m.monat, gesamt: m.gesamt, laufend: m.monat === lfdMonat,
    ...Object.fromEntries(wgListe.map((w) => [wgKey(w.id), m.je_warengruppe[String(w.id)] ?? 0])),
  })), [d, wgListe, lfdMonat])

  const tagesDaten = useMemo(() => {
    if (!d) return []
    const nach = new Map(d.reihe.map((r) => [r.datum, r.gesamt]))
    const zeilen: { datum: string; gesamt: number | null; hotday: { name: string; lastfaktor: number } | null }[] = []
    for (let t = subDays(parseISO(d.bis), 55); toISO(t) <= d.bis; t = addDays(t, 1)) {
      const iso = toISO(t)
      if (wochentagVon(iso) > 5) continue
      const g = nach.get(iso)
      zeilen.push({ datum: iso, gesamt: g && g > 0 ? g : null, hotday: hotdays.get(iso) ?? null })
    }
    return zeilen
  }, [d, hotdays])

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {anl.error ? <div className="col-span-full"><ChartKarte titel="Kennzahlen" abfragen={[anl]} /></div> : <>
          <StatKachel label="Ø Paletten je Liefertag" wert={anl.isLoading ? '…' : fmtZahl(kennzahlen.m4, 1)} hinweis="letzte 4 Wochen" />
          <StatKachel label="Trend" wert={anl.isLoading ? '…' : fmtDelta(kennzahlen.trend)}
            hinweis={`Ø 4 Wochen vs. Ø 8 Wochen (${fmtZahl(kennzahlen.m8, 1)} Pal.)`} />
          <StatKachel label="Spitzentag" wert={anl.isLoading ? '…' : kennzahlen.spitze ? fmtPal(kennzahlen.spitze.gesamt, 0) : '–'}
            hinweis={kennzahlen.spitze ? `${fmtTag(kennzahlen.spitze.datum)} · letzte 4 Wochen` : 'letzte 4 Wochen'} />
          <StatKachel label="Anteil Hotdays" wert={anl.isLoading || kal.isLoading ? '…' : kennzahlen.n ? fmtProzent(kennzahlen.hd / kennzahlen.n, 1) : '–'}
            hinweis={kal.error ? 'Kalender nicht verfügbar' : `${kennzahlen.hd} von ${kennzahlen.n} Liefertagen (12 Monate)`} />
        </>}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartKarte titel="Ø Paletten je Wochentag" untertitel={`gleitend über die letzten ${fenster} Wochen, gestapelt nach Warengruppe`}
          abfragen={[anl, st]} leer={!wochentagDaten.length}
          aktionen={<Umschalter label="Zeitfenster" aktiv={fenster} onChange={setFenster}
            werte={[{ wert: '4', label: '4 Wo.' }, { wert: '8', label: '8 Wo.' }, { wert: '12', label: '12 Wo.' }]} />}>
          <Legende eintraege={wgLegende(wgListe, wgFarbe)} />
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={wochentagDaten} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GITTER} />
                <XAxis dataKey="tag" {...ACHSE} />
                <YAxis {...Y_ACHSE} />
                <Tooltip cursor={TOOLTIP_CURSOR} content={(p) => (
                  <TooltipInhalt active={p.active} payload={p.payload} label={p.label} umgekehrt
                    wert={(v) => fmtPal(v)} summe={(v) => fmtPal(v)} />)} />
                {wgListe.map((w, i) => (
                  <Bar key={w.id} dataKey={wgKey(w.id)} name={w.name} stackId="a" fill={wgFarbe[w.id]} {...SAEULE} maxBarSize={40}
                    radius={i === wgListe.length - 1 ? RADIUS_OBEN : undefined}>
                    {i === wgListe.length - 1 && <LabelList dataKey="gesamt" position="top" fill={CHROME.text} fontSize={11} formatter={(v: unknown) => fmtZahl(Number(v), 0)} />}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <TabellenAnsicht>
            <table className="tabelle text-sm">
              <thead><tr><th>Warengruppe</th>{wochentagDaten.map((z) => <th key={z.tag} className="text-right">{z.tag}</th>)}</tr></thead>
              <tbody>
                {wgListe.map((w) => (
                  <tr key={w.id}><td><span className="inline-flex items-center gap-1.5"><Schluessel farbe={wgFarbe[w.id]} />{w.name}</span></td>
                    {wochentagDaten.map((z) => <td key={z.tag} className="text-right tabular-nums">{fmtZahl((z as Record<string, number | string>)[wgKey(w.id)] as number, 1)}</td>)}</tr>
                ))}
                <tr className="font-bold"><td>Gesamt</td>{wochentagDaten.map((z) => <td key={z.tag} className="text-right tabular-nums">{fmtZahl(z.gesamt, 1)}</td>)}</tr>
              </tbody>
            </table>
          </TabellenAnsicht>
        </ChartKarte>

        <ChartKarte titel="Trend 12 Monate" untertitel="Monatssummen Paletten; laufender Monat unvollständig"
          abfragen={[anl, st]} leer={!monatDaten.length}
          aktionen={<Umschalter label="Darstellung" aktiv={trendArt} onChange={setTrendArt}
            werte={[{ wert: 'gesamt', label: 'Gesamt' }, { wert: 'wg', label: 'je Warengruppe' }]} />}>
          {trendArt === 'wg' ? <Legende eintraege={wgLegende(wgListe, wgFarbe)} /> : <div className="h-6" />}
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={monatDaten} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...GITTER} />
                <XAxis dataKey="monat" {...ACHSE} tickFormatter={fmtMonat} interval="preserveStartEnd" minTickGap={8} />
                <YAxis {...Y_ACHSE} />
                <Tooltip cursor={CROSSHAIR} content={(p) => (
                  <TooltipInhalt active={p.active} payload={p.payload} label={p.label} umgekehrt={trendArt === 'wg'}
                    titel={(l) => `${fmtMonatLang(String(l))}${l === lfdMonat ? ' (laufend)' : ''}`}
                    wert={(v) => fmtPal(v, 0)} summe={(v) => fmtPal(v, 0)} />)} />
                {trendArt === 'gesamt'
                  ? <Area dataKey="gesamt" name="Gesamt" type="monotone" stroke={CHROME.gesamt} strokeWidth={2} fill={CHROME.gesamt} fillOpacity={0.1}
                    dot={{ r: 3, fill: CHROME.gesamt, stroke: CHROME.flaeche, strokeWidth: 2 }} activeDot={{ r: 5, stroke: CHROME.flaeche, strokeWidth: 2 }} />
                  : wgListe.map((w) => (
                    <Area key={w.id} dataKey={wgKey(w.id)} name={w.name} stackId="a" type="monotone" stroke={CHROME.flaeche} strokeWidth={1.5}
                      fill={wgFarbe[w.id]} fillOpacity={0.85} activeDot={false} />
                  ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <TabellenAnsicht>
            <table className="tabelle text-sm">
              <thead><tr><th>Monat</th>{wgListe.map((w) => <th key={w.id} className="text-right">{w.name}</th>)}<th className="text-right">Gesamt</th></tr></thead>
              <tbody>{monatDaten.map((m) => (
                <tr key={m.monat}><td>{fmtMonatLang(m.monat)}{m.laufend && ' (lfd.)'}</td>
                  {wgListe.map((w) => <td key={w.id} className="text-right tabular-nums">{fmtZahl((m as Record<string, number | string | boolean>)[wgKey(w.id)] as number)}</td>)}
                  <td className="text-right tabular-nums font-bold">{fmtZahl(m.gesamt)}</td></tr>
              ))}</tbody>
            </table>
          </TabellenAnsicht>
        </ChartKarte>
      </div>

      <ChartKarte titel="Tagesreihe der letzten 8 Wochen" untertitel="Paletten gesamt je Liefertag; Lücken = geschlossen/keine Anlieferung"
        abfragen={[anl]} leer={!tagesDaten.length}>
        <Legende eintraege={[{ name: 'Paletten gesamt', farbe: CHROME.gesamt, form: 'linie' }, { name: 'Hotday', farbe: CHROME.hervorhebung, form: 'punkt' }]} />
        <div className="h-56">
          <ResponsiveContainer>
            <ComposedChart data={tagesDaten} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...GITTER} />
              <XAxis dataKey="datum" {...ACHSE} tickFormatter={(s: string) => format(parseISO(s), 'dd.MM.')} minTickGap={24} />
              <YAxis {...Y_ACHSE} />
              <Tooltip cursor={CROSSHAIR} content={(p) => (
                <TooltipInhalt active={p.active} payload={p.payload} label={p.label} titel={(l) => fmtTag(String(l))}
                  wert={(v) => fmtPal(v, 0)}
                  zusatz={(z) => { const h = (z as { hotday?: { name: string; lastfaktor: number } | null })?.hotday; return h ? `Hotday: ${h.name} (${fmtFaktor(h.lastfaktor)})` : null }} />)} />
              <Line dataKey="gesamt" name="Paletten" type="linear" stroke={CHROME.gesamt} strokeWidth={2} connectNulls={false}
                activeDot={{ r: 5, stroke: CHROME.flaeche, strokeWidth: 2 }}
                dot={(props: { cx?: number; cy?: number; index?: number; payload?: { hotday?: unknown } }) => (
                  props.payload?.hotday && props.cx !== undefined && props.cy !== undefined
                    ? <circle key={props.index} cx={props.cx} cy={props.cy} r={5} fill={CHROME.hervorhebung} stroke={CHROME.flaeche} strokeWidth={2} />
                    : <g key={props.index} />
                )} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartKarte>
    </>
  )
}

// ================================================================== 2. Prognose & Bedarf
function PrognoseBedarf() {
  const { wgListe, wgFarbe, abteilungen, ...st } = useWarengruppen()
  const [versatz, setVersatz] = useState(1) // 1 = nächste Woche
  const montag = addDays(montagVon(heute), 7 * versatz)
  const von = toISO(montag)
  const bis = toISO(addDays(montag, 5))
  const prog = useQuery({ queryKey: ['kpi', 'prognose', von, bis], queryFn: () => api.prognose(von, bis) })
  const bed = useQuery({ queryKey: ['bedarf', von, bis], queryFn: () => api.bedarf(von, bis) })
  const [tagWahl, setTagWahl] = useState<string | null>(null)

  const tage = prog.data?.tage ?? []
  const progDaten = tage.map((t) => ({
    datum: t.datum, gesamt: t.gesamt, ...Object.fromEntries(wgListe.map((w) => [wgKey(w.id), t.je_warengruppe[String(w.id)] ?? 0])),
  }))
  const abtSortiert = [...abteilungen].sort((a, b) => a.sortierung - b.sortierung)
  const bedTage = bed.data?.tage ?? []
  const stundenMax = Math.max(0, ...bedTage.flatMap((t) => t.abteilungen.map((a) => a.stunden)))
  const gewaehlt = bedTage.find((t) => t.datum === tagWahl) ?? bedTage.find((t) => !t.geschlossen) ?? bedTage[0]

  const tagKopf = (t: { datum: string; geschlossen: boolean; hotday: string | null; lastfaktor: number }) => (
    <div className="flex flex-col items-end gap-0.5">
      <span>{fmtTag(t.datum)}</span>
      {t.geschlossen ? <Badge>geschlossen</Badge>
        : t.hotday ? <Badge ton="fell" titel={t.hotday}>Hotday {fmtFaktor(t.lastfaktor)}</Badge>
          : t.lastfaktor !== 1 ? <Badge titel="Saison-/Lastfaktor">{fmtFaktor(t.lastfaktor)}</Badge> : null}
    </div>
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button klein icon="links" aria-label="Vorige Woche" onClick={() => setVersatz((v) => v - 1)} />
        <div className="min-w-48 text-center text-sm font-bold text-rinde">
          KW {getISOWeek(montag)} · {format(montag, 'dd.MM.', { locale: de })} – {format(addDays(montag, 5), 'dd.MM.yyyy')}
        </div>
        <Button klein icon="rechts" aria-label="Nächste Woche" onClick={() => setVersatz((v) => v + 1)} />
        {versatz !== 1 && <Button klein variante="leise" onClick={() => setVersatz(1)}>Planwoche (nächste Woche)</Button>}
        {versatz === 1 && <Badge ton="moos">Planwoche</Badge>}
      </div>

      <ChartKarte titel="Prognose Paletten je Tag und Warengruppe" untertitel="Wochentagsmittel × Saison × Hotday-Faktor"
        abfragen={[prog, st]} leer={!tage.length}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <Legende eintraege={wgLegende(wgListe, wgFarbe)} />
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={progDaten} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...GITTER} />
                  <XAxis dataKey="datum" {...ACHSE} tickFormatter={(s: string) => fmtTag(s)} />
                  <YAxis {...Y_ACHSE} />
                  <Tooltip cursor={TOOLTIP_CURSOR} content={(p) => (
                    <TooltipInhalt active={p.active} payload={p.payload} label={p.label} umgekehrt titel={(l) => fmtTag(String(l))}
                      wert={(v) => fmtPal(v)} summe={(v) => fmtPal(v)}
                      zusatz={(z) => { const t = tage.find((x) => x.datum === (z as { datum?: string })?.datum); return t?.hotday ? `Hotday: ${t.hotday} (${fmtFaktor(t.lastfaktor)})` : null }} />)} />
                  {wgListe.map((w, i) => (
                    <Bar key={w.id} dataKey={wgKey(w.id)} name={w.name} stackId="a" fill={wgFarbe[w.id]} {...SAEULE} maxBarSize={40}
                      radius={i === wgListe.length - 1 ? RADIUS_OBEN : undefined}>
                      {i === wgListe.length - 1 && <LabelList dataKey="gesamt" position="top" fill={CHROME.text} fontSize={11} formatter={(v: unknown) => fmtZahl(Number(v), 0)} />}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="tabelle text-sm">
              <thead><tr><th>Warengruppe</th>{tage.map((t) => <th key={t.datum} className="text-right align-top">{tagKopf(t)}</th>)}<th className="text-right align-top">Woche</th></tr></thead>
              <tbody>
                {wgListe.map((w) => (
                  <tr key={w.id}>
                    <td className="whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><Schluessel farbe={wgFarbe[w.id]} />{w.name}</span></td>
                    {tage.map((t) => <td key={t.datum} className="text-right tabular-nums">{t.geschlossen ? '–' : fmtZahl(t.je_warengruppe[String(w.id)] ?? 0, 1)}</td>)}
                    <td className="text-right tabular-nums font-semibold">{fmtZahl(summe(tage.map((t) => t.je_warengruppe[String(w.id)] ?? 0)), 1)}</td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td>Gesamt</td>
                  {tage.map((t) => <td key={t.datum} className="text-right tabular-nums">{fmtZahl(t.gesamt, 1)}</td>)}
                  <td className="text-right tabular-nums">{fmtZahl(summe(tage.map((t) => t.gesamt)), 1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </ChartKarte>

      <ChartKarte titel="Bedarf Stunden je Abteilung und Tag" untertitel="Farbtiefe = Stunden (je dunkler, desto mehr)"
        abfragen={[bed, st]} leer={!bedTage.length}>
        <div className="overflow-x-auto">
          <table className="tabelle text-sm">
            <thead><tr><th>Abteilung</th>{bedTage.map((t) => <th key={t.datum} className="text-right align-top">{tagKopf(t)}</th>)}<th className="text-right align-top">Woche</th></tr></thead>
            <tbody>
              {abtSortiert.map((a) => {
                const werte = bedTage.map((t) => t.abteilungen.find((x) => x.abteilung_id === a.id))
                return (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><AbteilungsPunkt farbe={a.farbe} />{a.name}</span></td>
                    {werte.map((w, i) => {
                      const bg = w ? seqFarbe(w.stunden, stundenMax) : null
                      return (
                        <td key={bedTage[i].datum} className="text-right tabular-nums p-0.5!">
                          <span className="block rounded px-2 py-1" style={bg ? { backgroundColor: bg, color: textAuf(bg) } : undefined}
                            title={w ? `${a.name}, ${fmtTag(bedTage[i].datum)}: ${fmtStd(w.stunden)}${w.paletten ? ` · ${fmtZahl(w.paletten, 1)} Pal.` : ''}` : undefined}>
                            {w && w.stunden > 0 ? fmtZahl(w.stunden, 1) : '–'}
                          </span>
                        </td>
                      )
                    })}
                    <td className="text-right tabular-nums font-semibold">{fmtZahl(summe(werte.map((w) => w?.stunden ?? 0)), 1)}</td>
                  </tr>
                )
              })}
              <tr className="font-bold">
                <td>Gesamt</td>
                {bedTage.map((t) => <td key={t.datum} className="text-right tabular-nums">{fmtZahl(summe(t.abteilungen.map((a) => a.stunden)), 1)}</td>)}
                <td className="text-right tabular-nums">{fmtZahl(summe(bedTage.flatMap((t) => t.abteilungen.map((a) => a.stunden))), 1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </ChartKarte>

      <ChartKarte titel="Bedarfskurve eines Tages" untertitel={`Köpfe je ${bed.data?.slot_min ?? 30}-Minuten-Slot und Abteilung (gleiche Skala)`}
        abfragen={[bed, st]} leer={!gewaehlt}
        aktionen={bedTage.length ? <Umschalter label="Tag" aktiv={gewaehlt?.datum ?? ''} onChange={setTagWahl}
          werte={bedTage.map((t) => ({ wert: t.datum, label: WOCHENTAGE[wochentagVon(t.datum)] }))} /> : undefined}>
        {gewaehlt && <BedarfsKurven tag={gewaehlt} abteilungen={abtSortiert} slotMin={bed.data?.slot_min ?? 30} />}
      </ChartKarte>
    </>
  )
}

/** Small Multiples: je Abteilung eine Treppenlinie, gemeinsame y-Skala und Zeitachse. */
function slotEnde(beginn: string, min: number) {
  const [h, m] = beginn.split(':').map(Number)
  const t = h * 60 + m + min
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

function BedarfsKurven({ tag, abteilungen, slotMin }: { tag: BedarfTag; abteilungen: Abteilung[]; slotMin: number }) {
  if (tag.geschlossen) return <div className="py-6 text-center text-sm text-stein">{fmtTag(tag.datum)}: Filiale geschlossen – kein Bedarf.</div>
  const alleSlots = [...new Set(tag.abteilungen.flatMap((a) => a.slots.map((s) => s.beginn)))].sort()
  const yMax = Math.max(1, ...tag.abteilungen.flatMap((a) => a.slots.map((s) => s.koepfe)))
  const zeilen = abteilungen.map((a) => ({ a, d: tag.abteilungen.find((x) => x.abteilung_id === a.id) })).filter((z) => z.d && z.d.slots.length)
  if (!zeilen.length) return <div className="py-6 text-center text-sm text-stein">Für diesen Tag liegt keine Bedarfskurve vor.</div>
  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
      {zeilen.map(({ a, d }) => {
        const m = new Map(d!.slots.map((s) => [s.beginn, s.koepfe]))
        const daten = alleSlots.map((b) => ({ beginn: b, koepfe: m.get(b) ?? 0 }))
        // Schlusspunkt, damit der letzte Slot als Stufe sichtbar bleibt
        if (daten.length) daten.push({ beginn: slotEnde(daten[daten.length - 1].beginn, slotMin), koepfe: daten[daten.length - 1].koepfe })
        const spitze = Math.max(0, ...d!.slots.map((s) => s.koepfe))
        return (
          <div key={a.id}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 font-semibold text-rinde"><AbteilungsPunkt farbe={a.farbe} />{a.name}</span>
              <span className="text-xs text-stein tabular-nums">{fmtStd(d!.stunden)} · max {spitze}</span>
            </div>
            <div className="h-24">
              <ResponsiveContainer>
                <AreaChart data={daten} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid {...GITTER} />
                  <XAxis dataKey="beginn" {...ACHSE} interval="preserveStartEnd" minTickGap={30} />
                  <YAxis {...Y_ACHSE} width={24} domain={[0, yMax]} allowDecimals={false} />
                  <Tooltip cursor={CROSSHAIR} content={(p) => (
                    <TooltipInhalt active={p.active} payload={p.payload} label={p.label} titel={(l) => `${a.name}, ${l} Uhr`}
                      wert={(v) => `${fmtZahl(v)} ${v === 1 ? 'Kopf' : 'Köpfe'}`} />)} />
                  <Area dataKey="koepfe" name="Bedarf" type="stepAfter" stroke={a.farbe} strokeWidth={2} fill={a.farbe} fillOpacity={0.12}
                    isAnimationActive={false} activeDot={{ r: 4, stroke: CHROME.flaeche, strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ================================================================== 3. Abdeckung
type Ampel = { status: 'ok' | 'warn' | 'verstoss'; text: string }
function ampel(w: number | null): Ampel | null {
  if (w === null || w === undefined) return null
  if (w < 0.9) return { status: 'verstoss', text: 'Unterdeckung' }
  if (w < 0.95) return { status: 'warn', text: 'knapp' }
  if (w <= 1.1) return { status: 'ok', text: 'passt' }
  return { status: 'warn', text: 'Überdeckung' }
}
function AbdeckungsBadge({ w, kurz }: { w: AbdeckungWert; kurz?: boolean }) {
  const a = ampel(w.abdeckung)
  if (!a) return <span className="text-stein">–</span>
  return (
    <StatusBadge status={a.status} titel={`${a.text}: ${fmtStd(w.geplant_std)} geplant / ${fmtStd(w.bedarf_std)} Bedarf`}>
      {fmtProzent(w.abdeckung)}{!kurz && ` · ${a.text}`}
    </StatusBadge>
  )
}

const FARBE_BEDARF = '#C9BBA8'
const FARBE_GEPLANT = '#3E6FB0'

function Abdeckung() {
  const { abteilungen, ...st } = useStammdaten()
  const montag = montagVon(heute)
  const von = toISO(montag)
  const bis = toISO(addDays(montag, 5))
  const plaene = useQuery({ queryKey: ['plaene', von, bis], queryFn: () => api.plaene(von, bis) })
  const plan = (plaene.data ?? []).find((p) => p.von <= von && p.bis >= bis) ?? plaene.data?.[0]
  const abd = useQuery({ queryKey: ['kpi', 'abdeckung', plan?.id], queryFn: () => api.kpiAbdeckung(plan!.id), enabled: !!plan })
  const tage = abd.data?.tage ?? []
  const daten = tage.map((t) => ({ datum: t.datum, bedarf: t.bedarf_std, geplant: t.geplant_std, abdeckung: t.abdeckung }))
  const abtSortiert = [...abteilungen].sort((a, b) => a.sortierung - b.sortierung)
    .filter((a) => tage.some((t) => t.abteilungen.some((x) => x.abteilung_id === a.id)))
  const keinPlan = plaene.isSuccess && !plan
  const g = abd.data?.gesamt
  const ga = g ? ampel(g.abdeckung) : null

  const untertitel = plan ? <>KW {getISOWeek(montag)} · Plan „{plan.name}“</> : `KW ${getISOWeek(montag)}`
  return (
    <>
      {g && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatKachel label="Abdeckung Woche" wert={fmtProzent(g.abdeckung)} ton={ga?.status ?? 'neutral'} hinweis={ga ? ga.text : undefined} />
          <StatKachel label="Bedarf" wert={fmtStd(g.bedarf_std)} hinweis="Mo–Sa" />
          <StatKachel label="Geplant" wert={fmtStd(g.geplant_std)} hinweis="Einsatzstunden" />
          <StatKachel label="Differenz" wert={fmtStdVz(g.geplant_std - g.bedarf_std)} hinweis="geplant − Bedarf" />
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartKarte titel="Abdeckungsgrad je Tag" untertitel={untertitel} abfragen={[plaene, abd]}
          leer={keinPlan || !tage.length} leerText={keinPlan ? 'Für die aktuelle Woche gibt es noch keinen Plan.' : undefined}
          fuss="Ampel: unter 90 % Unterdeckung · 90–95 % knapp · 95–110 % passt · über 110 % Überdeckung">
          <Legende eintraege={[{ name: 'Bedarf', farbe: FARBE_BEDARF }, { name: 'Geplant', farbe: FARBE_GEPLANT }]} />
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={daten} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid {...GITTER} />
                <XAxis dataKey="datum" {...ACHSE} tickFormatter={(s: string) => fmtTag(s)} />
                <YAxis {...Y_ACHSE} tickFormatter={(v: number) => `${fmtZahl(v)} h`} width={48} />
                <Tooltip cursor={TOOLTIP_CURSOR} content={(p) => (
                  <TooltipInhalt active={p.active} payload={p.payload} label={p.label} titel={(l) => fmtTag(String(l))}
                    wert={(v) => fmtStd(Math.round(v * 10) / 10)}
                    zusatz={(z) => { const w = (z as { abdeckung?: number | null })?.abdeckung ?? null; const a = ampel(w); return a ? `Abdeckung ${fmtProzent(w)} – ${a.text}` : null }} />)} />
                <Bar dataKey="bedarf" name="Bedarf" fill={FARBE_BEDARF} radius={RADIUS_OBEN} {...SAEULE} />
                <Bar dataKey="geplant" name="Geplant" fill={FARBE_GEPLANT} radius={RADIUS_OBEN} {...SAEULE} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 grid gap-1 pl-12 pr-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, tage.length)}, minmax(0, 1fr))` }}>
            {tage.map((t) => <div key={t.datum} className="flex justify-center"><AbdeckungsBadge w={t} kurz /></div>)}
          </div>
        </ChartKarte>

        <ChartKarte titel="Abdeckung je Abteilung" untertitel={untertitel} abfragen={[plaene, abd, st]}
          leer={keinPlan || !tage.length} leerText={keinPlan ? 'Für die aktuelle Woche gibt es noch keinen Plan.' : undefined}>
          <div className="overflow-x-auto">
            <table className="tabelle text-sm">
              <thead><tr><th>Abteilung</th>{tage.map((t) => <th key={t.datum} className="text-center">{fmtTag(t.datum)}</th>)}</tr></thead>
              <tbody>
                {abtSortiert.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><AbteilungsPunkt farbe={a.farbe} />{a.kuerzel}</span></td>
                    {tage.map((t) => {
                      const w = t.abteilungen.find((x) => x.abteilung_id === a.id)
                      return <td key={t.datum} className="text-center">{w ? <AbdeckungsBadge w={w} kurz /> : <span className="text-stein">–</span>}</td>
                    })}
                  </tr>
                ))}
                <tr className="font-bold">
                  <td>Gesamt</td>
                  {tage.map((t) => <td key={t.datum} className="text-center"><AbdeckungsBadge w={t} kurz /></td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </ChartKarte>
      </div>
    </>
  )
}

// ================================================================== 4. Leistung
function Leistung() {
  const { abteilungNach, ...st } = useStammdaten()
  const bis = toISO(subDays(heute, 1))
  const von = toISO(subDays(heute, 28))
  const q = useQuery({ queryKey: ['kpi', 'leistung', von, bis], queryFn: () => api.kpiLeistung(von, bis) })
  const zeilen = (q.data?.abteilungen ?? []).filter((z) => z.pal_pro_h !== null || z.soll_pal_pro_h !== null)
    .sort((a, b) => (abteilungNach[a.abteilung_id]?.sortierung ?? 99) - (abteilungNach[b.abteilung_id]?.sortierung ?? 99))
  const max = Math.max(0.5, ...zeilen.flatMap((z) => [z.pal_pro_h ?? 0, z.soll_pal_pro_h ?? 0])) * 1.1
  return (
    <ChartKarte titel="Paletten je Personenstunde" untertitel={`Ist vs. Standard je Abteilung · ${fmtTag(von)} – ${fmtTag(bis)}`}
      abfragen={[q, st]} leer={!zeilen.length}>
      <Legende eintraege={[{ name: 'Ist', farbe: CHROME.gesamt }, { name: 'Standard (Soll)', farbe: CHROME.textStark, form: 'linie' }]} />
      <ul className="space-y-2.5">
        {zeilen.map((z) => {
          const a = abteilungNach[z.abteilung_id]
          const quote = z.pal_pro_h !== null && z.soll_pal_pro_h ? z.pal_pro_h / z.soll_pal_pro_h - 1 : null
          return (
            <li key={z.abteilung_id} className="grid grid-cols-[10rem_minmax(0,1fr)_8rem] items-center gap-3 text-sm"
              title={`${a?.name ?? z.abteilung_id}: ${fmtZahl(z.paletten, 0)} Pal. in ${fmtStd(Math.round(z.stunden))}`}>
              <span className="inline-flex items-center gap-1.5 truncate">{a && <AbteilungsPunkt farbe={a.farbe} />}{a?.name ?? `Abteilung ${z.abteilung_id}`}</span>
              <div className="relative h-5">
                <div className="absolute inset-y-0 left-0 border-l border-achse" style={{ borderColor: CHROME.achse }} />
                {z.pal_pro_h !== null && (
                  <div className="absolute top-1 bottom-1 left-0 rounded-r-[4px]" style={{ width: `${(z.pal_pro_h / max) * 100}%`, maxWidth: '100%', backgroundColor: CHROME.gesamt }} />
                )}
                {z.soll_pal_pro_h !== null && (
                  <div className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded-full" style={{ left: `calc(${(z.soll_pal_pro_h / max) * 100}% - 1px)`, backgroundColor: CHROME.textStark }}
                    aria-label={`Standard ${fmtZahl(z.soll_pal_pro_h, 2)}`} />
                )}
              </div>
              <span className="text-right tabular-nums">
                <span className="font-bold">{fmtZahl(z.pal_pro_h, 2)}</span>
                <span className="text-stein"> / {fmtZahl(z.soll_pal_pro_h, 2)}</span>
                {quote !== null && <span className={cx('block text-xs', quote < -0.1 ? 'text-warn font-semibold' : 'text-stein')}>{fmtDelta(quote)} vs. Standard</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </ChartKarte>
  )
}

// ================================================================== 5. Stunden & Personal
function StundenPersonal() {
  const { skillNach, ...st } = useStammdaten()
  const von = toISO(startOfMonth(heute))
  const bis = toISO(endOfMonth(heute))
  const std = useQuery({ queryKey: ['kpi', 'stunden', von, bis], queryFn: () => api.kpiStunden(von, bis) })
  const pers = useQuery({ queryKey: ['kpi', 'personal'], queryFn: api.kpiPersonal })
  const ma = std.data?.mitarbeiter ?? []
  const konten = [...ma].sort((a, b) => b.stundenkonto - a.stundenkonto)
  const kontoMax = Math.max(1, ...ma.map((m) => Math.abs(m.stundenkonto)))
  const urlaub = [...(pers.data?.urlaub ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const urlaubMax = Math.max(1, ...urlaub.map((u) => Math.max(u.anspruch, u.genommen + u.geplant)))
  const skills = [...(pers.data?.skill_abdeckung ?? [])].sort((a, b) => Number(b.engpass) - Number(a.engpass) || a.anzahl - b.anzahl)
  const skillMax = Math.max(1, ...skills.map((s) => s.anzahl))
  const kq = pers.data?.krankenquote
  const engpaesse = skills.filter((s) => s.engpass).length
  const monat = format(heute, 'MMMM yyyy', { locale: de })

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {pers.error ? <div className="col-span-2"><ChartKarte titel="Krankenquote" abfragen={[pers]} /></div> : <>
          <StatKachel label="Krankenquote" wert={pers.isLoading ? '…' : fmtProzent(kq, 1)} ton={kq !== undefined && kq > 0.06 ? 'warn' : 'neutral'}
            hinweis={kq !== undefined && kq > 0.06 ? 'über 6 % – erhöht · letzte 12 Monate' : 'letzte 12 Monate'} />
          <StatKachel label="Engpass-Skills" wert={pers.isLoading ? '…' : engpaesse} ton={engpaesse ? 'warn' : 'neutral'}
            hinweis={engpaesse ? 'zu wenige Mitarbeiter mit Skill' : 'keine Engpässe'} />
        </>}
        {!std.error && <>
          <StatKachel label="Stundenkonten Summe" wert={std.isLoading ? '…' : fmtStdVz(Math.round(summe(ma.map((m) => m.stundenkonto)) * 10) / 10)} hinweis="alle Mitarbeiter" />
          <StatKachel label="Geplant / Soll" wert={std.isLoading ? '…' : fmtProzent(summe(ma.map((m) => m.soll_std)) ? summe(ma.map((m) => m.geplant_std)) / summe(ma.map((m) => m.soll_std)) : null)}
            hinweis={monat} />
        </>}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartKarte titel="Stundenkonten" untertitel="Überstunden (+) und Minusstunden (−), sortiert" abfragen={[std]} leer={!konten.length}>
          <Legende eintraege={[{ name: 'Plus', farbe: DIVERGIEREND.positiv }, { name: 'Minus', farbe: DIVERGIEREND.negativ }]} />
          <ul className="space-y-1">
            {konten.map((m) => {
              const breite = (Math.abs(m.stundenkonto) / kontoMax) * 50
              return (
                <li key={m.mitarbeiter_id} className="grid grid-cols-[9rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-sm">
                  <span className="truncate" title={m.name}>{m.name}</span>
                  <div className="relative h-4">
                    <div className="absolute inset-y-0 left-1/2 w-px" style={{ backgroundColor: CHROME.achse }} />
                    {m.stundenkonto !== 0 && (
                      <div className={cx('absolute top-0.5 bottom-0.5', m.stundenkonto > 0 ? 'rounded-r-[4px]' : 'rounded-l-[4px]')}
                        style={{ width: `${breite}%`, [m.stundenkonto > 0 ? 'left' : 'right']: '50%', backgroundColor: m.stundenkonto > 0 ? DIVERGIEREND.positiv : DIVERGIEREND.negativ }} />
                    )}
                  </div>
                  <span className="text-right tabular-nums font-semibold">{fmtStdVz(Math.round(m.stundenkonto * 10) / 10)}</span>
                </li>
              )
            })}
          </ul>
        </ChartKarte>

        <ChartKarte titel="Soll vs. geplant" untertitel={monat} abfragen={[std]} leer={!ma.length}>
          <div className="overflow-x-auto max-h-[28rem]">
            <table className="tabelle text-sm">
              <thead className="sticky top-0 bg-white"><tr><th>Mitarbeiter</th><th>Vertrag</th><th className="text-right">Soll</th><th className="text-right">Geplant</th><th className="text-right">Differenz</th><th /></tr></thead>
              <tbody>
                {[...ma].sort((a, b) => a.name.localeCompare(b.name, 'de')).map((m) => {
                  const q = m.soll_std ? m.geplant_std / m.soll_std : null
                  return (
                    <tr key={m.mitarbeiter_id}>
                      <td className="whitespace-nowrap">{m.name}</td>
                      <td className="text-stein">{m.vertragsart ? VERTRAGSARTEN[m.vertragsart] : '–'}</td>
                      <td className="text-right tabular-nums">{fmtStd(Math.round(m.soll_std * 10) / 10)}</td>
                      <td className="text-right tabular-nums">{fmtStd(Math.round(m.geplant_std * 10) / 10)}</td>
                      <td className="text-right tabular-nums font-semibold">{fmtStdVz(Math.round(m.differenz * 10) / 10)}</td>
                      <td>{q !== null && q > 1.1 ? <StatusBadge status="warn">über Soll</StatusBadge>
                        : q !== null && q < 0.9 ? <StatusBadge status="warn">unter Soll</StatusBadge> : null}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </ChartKarte>

        <ChartKarte titel="Urlaubsplanung vs. Anspruch" untertitel="Tage je Mitarbeiter im laufenden Jahr" abfragen={[pers]} leer={!urlaub.length}>
          <Legende eintraege={[{ name: 'genommen', farbe: FARBE_GEPLANT }, { name: 'geplant', farbe: '#BF8314' }, { name: 'Rest', farbe: CHROME.gitter }]} />
          <ul className="space-y-1">
            {urlaub.map((u) => {
              const pct = (n: number) => `${(Math.max(0, n) / urlaubMax) * 100}%`
              return (
                <li key={u.mitarbeiter_id} className="grid grid-cols-[9rem_minmax(0,1fr)_7rem] items-center gap-2 text-sm"
                  title={`${u.name}: ${fmtZahl(u.genommen, 1)} genommen, ${fmtZahl(u.geplant, 1)} geplant, ${fmtZahl(u.rest, 1)} Rest von ${fmtZahl(u.anspruch, 1)}`}>
                  <span className="truncate">{u.name}</span>
                  <div className="flex h-3.5 gap-[2px]">
                    {u.genommen > 0 && <div className="h-full first:rounded-l-[4px]" style={{ width: pct(u.genommen), backgroundColor: FARBE_GEPLANT }} />}
                    {u.geplant > 0 && <div className="h-full first:rounded-l-[4px]" style={{ width: pct(u.geplant), backgroundColor: '#BF8314' }} />}
                    {u.rest > 0 && <div className="h-full rounded-r-[4px] first:rounded-l-[4px]" style={{ width: pct(u.rest), backgroundColor: CHROME.gitter }} />}
                  </div>
                  <span className="text-right tabular-nums">
                    {u.rest < 0 ? <StatusBadge status="verstoss">{fmtZahl(-u.rest, 1)} überplant</StatusBadge>
                      : <><span className="font-semibold">{fmtZahl(u.rest, 1)}</span><span className="text-stein"> Rest / {fmtZahl(u.anspruch, 0)}</span></>}
                  </span>
                </li>
              )
            })}
          </ul>
        </ChartKarte>

        <ChartKarte titel="Skill-Abdeckung" untertitel="Mitarbeiter je Skill (davon Experten, Level 3)" abfragen={[pers, st]} leer={!skills.length}>
          <Legende eintraege={[{ name: 'Experten (Level 3)', farbe: CHROME.gesamt }, { name: 'weitere', farbe: '#C9BBA8' }]} />
          <ul className="space-y-1.5">
            {skills.map((s) => (
              <li key={s.skill_id} className="grid grid-cols-[11rem_minmax(0,1fr)_6.5rem] items-center gap-2 text-sm">
                <span className="truncate" title={skillNach[s.skill_id]?.name}>{skillNach[s.skill_id]?.name ?? `Skill ${s.skill_id}`}</span>
                <div className="flex h-3.5 gap-[2px]" title={`${s.anzahl} Mitarbeiter, davon ${s.anzahl_level3} Experten`}>
                  {s.anzahl_level3 > 0 && <div className="h-full rounded-l-[4px] last:rounded-r-[4px]" style={{ width: `${(s.anzahl_level3 / skillMax) * 100}%`, backgroundColor: CHROME.gesamt }} />}
                  {s.anzahl - s.anzahl_level3 > 0 && <div className="h-full rounded-r-[4px] first:rounded-l-[4px]" style={{ width: `${((s.anzahl - s.anzahl_level3) / skillMax) * 100}%`, backgroundColor: '#C9BBA8' }} />}
                </div>
                <span className="flex items-center justify-end gap-1.5 tabular-nums">
                  {s.engpass ? <StatusBadge status="warn" titel="Engpass-Skill">{s.anzahl} · Engpass</StatusBadge>
                    : <><span className="font-semibold">{s.anzahl}</span><span className="text-stein">({s.anzahl_level3})</span></>}
                </span>
              </li>
            ))}
          </ul>
        </ChartKarte>
      </div>
    </>
  )
}
