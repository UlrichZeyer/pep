// Übersicht: Kennzahlen des Tages, Abwesenheiten, Kalender-Ausblick, Zertifikate, Belegschaftsstruktur.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { addDays, parseISO, startOfWeek } from 'date-fns'
import { api, ABWESENHEITSTYPEN, VERTRAGSARTEN, type AbwesenheitTyp, type Vertragsart } from '../api'
import {
  Badge, Card, Fehler, Icon, Laden, Leer, SeitenKopf, StatKachel, StatusBadge,
  fmtDatum, fmtDatumLang, fmtProzent, fmtTag, fmtZahl, toISO, type IconName, type Ton,
} from '../components/ui'
import { Stundenkonto, tageBis } from '../components/personal/gemeinsam'

const TYP_TON: Record<AbwesenheitTyp, Ton> = {
  urlaub: 'moos', krank: 'verstoss', schule: 'info', fortbildung: 'info', wunschfrei: 'neutral', sonstiges: 'neutral',
}

function begruessung(): string {
  const h = new Date().getHours()
  return h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend'
}

export default function Dashboard() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard })
  if (q.isLoading) return <Laden />
  if (q.error || !q.data) return <><SeitenKopf titel="Übersicht" /><Fehler fehler={q.error ?? 'Keine Daten'} /></>
  const d = q.data

  const diff = d.paletten_diese_woche - d.paletten_vorwoche
  const trend = d.paletten_vorwoche > 0
    ? `${diff >= 0 ? '+' : '−'}${fmtZahl(Math.abs(diff))} ggü. Vorwoche (${fmtZahl(d.paletten_vorwoche)}) · Woche bis heute`
    : `Vorwoche: ${fmtZahl(d.paletten_vorwoche)}`
  const vertragsarten = (Object.entries(d.vertragsarten) as [Vertragsart, number][]).sort((a, b) => b[1] - a[1])
  const maxArt = Math.max(1, ...vertragsarten.map(([, n]) => n))
  const summeArt = vertragsarten.reduce((s, [, n]) => s + n, 0)

  return (
    <div className="space-y-6">
      <SeitenKopf titel={`${begruessung()}!`} untertitel={<>Heute ist {fmtDatumLang(d.stichtag)} · Filiale Musterstadt</>} />

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatKachel label="Aktive Mitarbeiter" wert={d.mitarbeiter_aktiv} hinweis={`von ${d.mitarbeiter_gesamt} gesamt`} />
        <StatKachel label="Heute abwesend" wert={d.abwesend_heute.length}
          ton={d.abwesend_heute.length > 0 ? 'warn' : 'ok'}
          hinweis={`${fmtProzent(d.mitarbeiter_aktiv ? d.abwesend_heute.length / d.mitarbeiter_aktiv : 0)} der Aktiven`} />
        <StatKachel label="Offene Urlaubsanträge" wert={d.offene_urlaubsantraege}
          ton={d.offene_urlaubsantraege > 0 ? 'warn' : 'ok'}
          hinweis={d.offene_urlaubsantraege > 0 ? <Link to="/abwesenheiten" className="underline hover:text-fell-dunkel">jetzt bearbeiten</Link> : 'alles erledigt'} />
        <StatKachel label="Paletten diese Woche" wert={fmtZahl(d.paletten_diese_woche)} hinweis={trend} />
        <StatKachel label="Summe Stundenkonten" wert={<Stundenkonto wert={d.stundenkonto_summe} />} hinweis="aktive Mitarbeiter" />
        <Abdeckungskachel stichtag={d.stichtag} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card titel="Heute abwesend" polster={false} className="lg:col-span-2"
          aktionen={<Link to="/abwesenheiten" className="text-sm font-semibold text-fell hover:text-fell-dunkel">Alle Abwesenheiten</Link>}>
          {d.abwesend_heute.length === 0 ? <Leer titel="Alle an Bord">Heute ist niemand abwesend.</Leer> : (
            <table className="tabelle">
              <thead><tr><th>Name</th><th>Grund</th><th>bis</th></tr></thead>
              <tbody>
                {d.abwesend_heute.map((a) => (
                  <tr key={`${a.mitarbeiter_id}-${a.typ}`}>
                    <td><Link to={`/mitarbeiter/${a.mitarbeiter_id}`} className="font-semibold text-rinde hover:text-fell-dunkel hover:underline">{a.name}</Link></td>
                    <td><Badge ton={TYP_TON[a.typ]}>{ABWESENHEITSTYPEN[a.typ]}</Badge></td>
                    <td className="tabular-nums">{a.bis === d.stichtag ? 'heute' : fmtDatum(a.bis)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card titel="Schnellzugriff">
          <div className="grid gap-2">
            <Schnelllink to="/planung" icon="kalender" titel="Wochenplan" text="Einsätze planen und prüfen" />
            <Schnelllink to="/abwesenheiten" icon="plus" titel="Abwesenheit erfassen" text="Urlaub, Krankheit, Berufsschule" />
            <Schnelllink to="/kpis" icon="zauber" titel="KPIs & Bedarf" text="Anlieferung, Abdeckung, Stunden" />
          </div>
        </Card>

        <Card titel="Nächste Feiertage" polster={false}>
          {d.naechste_feiertage.length === 0 ? <Leer titel="Keine Feiertage in Sicht" /> : (
            <ul className="divide-y divide-sand">
              {d.naechste_feiertage.map((f) => (
                <li key={f.datum} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="font-semibold">{f.name}</span>
                  <span className="text-stein tabular-nums whitespace-nowrap">{fmtTag(f.datum)} · in {tageBis(f.datum, d.stichtag)} T.</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card titel="Nächste Hotdays" polster={false}
          aktionen={<Link to="/kalender" className="text-sm font-semibold text-fell hover:text-fell-dunkel">Kalender</Link>}>
          {d.naechste_hotdays.length === 0 ? <Leer titel="Keine Hotdays geplant" /> : (
            <ul className="divide-y divide-sand">
              {d.naechste_hotdays.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold truncate" title={h.name}>{h.name}</div>
                    <div className="text-xs text-stein">{fmtTag(h.datum)}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {h.urlaubssperre && <Badge ton="verstoss" icon="schloss">Urlaubssperre</Badge>}
                    <Badge ton="fell" titel="Lastfaktor">×{h.lastfaktor.toLocaleString('de-DE', { maximumFractionDigits: 2 })}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card titel="Zertifikate laufen ab" polster={false}
          aktionen={<Link to="/skills" className="text-sm font-semibold text-fell hover:text-fell-dunkel">Skill-Matrix</Link>}>
          {d.ablaufende_zertifikate.length === 0 ? <Leer titel="Alles gültig">Keine Zertifikate laufen in den nächsten 60 Tagen ab.</Leer> : (
            <ul className="divide-y divide-sand">
              {[...d.ablaufende_zertifikate].sort((a, b) => a.zertifikat_bis.localeCompare(b.zertifikat_bis)).map((z) => (
                <li key={`${z.mitarbeiter_id}-${z.skill}`} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <div className="min-w-0">
                    <Link to={`/mitarbeiter/${z.mitarbeiter_id}`} className="font-semibold hover:text-fell-dunkel hover:underline">{z.name}</Link>
                    <div className="text-xs text-stein">{z.skill}</div>
                  </div>
                  {z.abgelaufen
                    ? <StatusBadge status="verstoss">abgelaufen {fmtDatum(z.zertifikat_bis)}</StatusBadge>
                    : <StatusBadge status="warn">bis {fmtDatum(z.zertifikat_bis)}</StatusBadge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card titel="Belegschaft nach Vertragsart" className="lg:col-span-3">
          {vertragsarten.length === 0 ? <Leer titel="Keine aktiven Verträge" /> : (
            <ul className="space-y-2" aria-label="Aktive Mitarbeiter je Vertragsart">
              {vertragsarten.map(([art, n]) => (
                <li key={art} className="grid grid-cols-[7rem_1fr_5rem] items-center gap-3 text-sm">
                  <span className="font-semibold">{VERTRAGSARTEN[art]}</span>
                  <span className="h-3 rounded-full bg-sand overflow-hidden" aria-hidden>
                    <span className="block h-full rounded-full bg-eichel" style={{ width: `${(n / maxArt) * 100}%` }} />
                  </span>
                  <span className="tabular-nums text-right"><b>{n}</b> <span className="text-stein">({fmtProzent(n / summeArt)})</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function Schnelllink({ to, icon, titel, text }: { to: string; icon: IconName; titel: string; text: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-lg border border-sand px-3 py-2 hover:border-fell hover:bg-fell-hell/40 transition-colors">
      <span className="w-8 h-8 rounded-full bg-fell-hell text-fell-dunkel flex items-center justify-center"><Icon name={icon} /></span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-sm">{titel}</span>
        <span className="block text-xs text-stein">{text}</span>
      </span>
      <Icon name="rechts" className="w-4 h-4 text-stein" />
    </Link>
  )
}

/** Abdeckung der laufenden Woche – nur wenn Plan- und KPI-Endpunkte verfügbar sind; Fehler werden still ignoriert. */
function Abdeckungskachel({ stichtag }: { stichtag: string }) {
  const mo = startOfWeek(parseISO(stichtag), { weekStartsOn: 1 })
  const von = toISO(mo)
  const bis = toISO(addDays(mo, 5))
  const plaene = useQuery({ queryKey: ['plaene', von, bis], queryFn: () => api.plaene(von, bis), retry: false })
  const plan = plaene.data?.find((p) => p.von <= stichtag && p.bis >= stichtag) ?? plaene.data?.[0]
  const abd = useQuery({
    queryKey: ['kpi', 'abdeckung', plan?.id], queryFn: () => api.kpiAbdeckung(plan!.id), enabled: !!plan, retry: false,
  })
  const wert = abd.data?.gesamt.abdeckung
  if (!plan || wert === undefined || wert === null) return null
  const ton = wert >= 0.95 ? 'ok' : wert >= 0.85 ? 'warn' : 'verstoss'
  return (
    <StatKachel label="Abdeckung diese Woche" wert={fmtProzent(wert)} ton={ton}
      hinweis={<Link to="/planung" className="underline hover:text-fell-dunkel">{fmtZahl(abd.data!.gesamt.geplant_std)} von {fmtZahl(abd.data!.gesamt.bedarf_std)} h geplant</Link>} />
  )
}
