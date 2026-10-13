// Skill-Matrix: Mitarbeiter × Skills mit Level-Punkten, Zertifikatsstatus und Engpass-Erkennung.
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { SKILLKATEGORIEN, LEVEL, type Mitarbeiter, type Skill, type SkillKategorie } from '../api'
import { useMitarbeiter, useStammdaten } from '../hooks'
import { AbteilungsPunkt, Card, Fehler, Field, Hinweis, Icon, Laden, Leer, SeitenKopf, StatusBadge, Tabs, cx, eingabe, fmtDatum } from '../components/ui'
import { LevelPunkte, useStichtag, zertStatus } from '../components/personal/gemeinsam'

const KATEGORIEN: SkillKategorie[] = ['verraeumen', 'kasse', 'zertifikat', 'sonstiges']
/** Engpass: höchstens so viele aktive Personen beherrschen einen Verräum- oder Kassen-Skill. */
const ENGPASS_MAX = 4

type Sortierung = 'abteilung' | 'name'

export default function SkillMatrix() {
  const ma = useMitarbeiter()
  const st = useStammdaten()
  const stichtag = useStichtag()
  const [abteilung, setAbteilung] = useState('')
  const [nurAktive, setNurAktive] = useState(true)
  const [sortierung, setSortierung] = useState<Sortierung>('abteilung')

  const spalten = useMemo(() => KATEGORIEN.map((k) => ({ kategorie: k, skills: st.skills.filter((s) => s.kategorie === k) }))
    .filter((g) => g.skills.length), [st.skills])
  const skillsSortiert = spalten.flatMap((g) => g.skills)

  // Engpässe auf Basis aller aktiven Mitarbeiter (unabhängig vom Filter)
  const engpass = useMemo(() => {
    const aktive = ma.liste.filter((m) => m.status === 'aktiv')
    const r: Record<number, number> = {}
    for (const s of st.skills) {
      if (s.kategorie !== 'verraeumen' && s.kategorie !== 'kasse') continue
      const n = aktive.filter((m) => m.skills.some((x) => x.skill_id === s.id)).length
      if (n <= ENGPASS_MAX) r[s.id] = n
    }
    return r
  }, [ma.liste, st.skills])

  const zeilen = useMemo(() => {
    const sortNr = (m: Mitarbeiter) => (m.stammabteilung_id ? st.abteilungNach[m.stammabteilung_id]?.sortierung ?? 99 : 999)
    return ma.liste
      .filter((m) => (!nurAktive || m.status === 'aktiv') && (!abteilung || String(m.stammabteilung_id ?? 'ohne') === abteilung))
      .sort((a, b) => (sortierung === 'abteilung' ? sortNr(a) - sortNr(b) : 0)
        || a.nachname.localeCompare(b.nachname, 'de') || a.vorname.localeCompare(b.vorname, 'de'))
  }, [ma.liste, nurAktive, abteilung, sortierung, st.abteilungNach])

  const gruppen = useMemo(() => {
    if (sortierung === 'name') return [{ id: -1, zeilen }]
    const g: { id: number; zeilen: Mitarbeiter[] }[] = []
    for (const m of zeilen) {
      const id = m.stammabteilung_id ?? 0
      if (g.at(-1)?.id !== id) g.push({ id, zeilen: [] })
      g.at(-1)!.zeilen.push(m)
    }
    return g
  }, [zeilen, sortierung])

  const fehler = ma.error ?? st.error
  const laedt = ma.isLoading || st.isLoading
  const spaltenzahl = skillsSortiert.length + 1
  const anzahl = (s: Skill, minLevel = 1) => zeilen.filter((m) => m.skills.some((x) => x.skill_id === s.id && x.level >= minLevel)).length

  return (
    <div className="space-y-4">
      <SeitenKopf titel="Skill-Matrix" untertitel="Wer kann was? Level 1 = Einarbeitung, 2 = selbstständig, 3 = Experte" />

      {Object.keys(engpass).length > 0 && (
        <Hinweis ton="warn" titel="Engpass-Skills">
          Höchstens {ENGPASS_MAX} aktive Personen beherrschen:{' '}
          {Object.entries(engpass).map(([id, n], i) => (
            <Fragment key={id}>{i > 0 && ', '}<b>{st.skillNach[Number(id)]?.name}</b> ({n})</Fragment>
          ))}
          . Einarbeitung weiterer Mitarbeiter einplanen.
        </Hinweis>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Abteilung" className="w-60">
            <select className={eingabe} value={abteilung} onChange={(e) => setAbteilung(e.target.value)}>
              <option value="">alle</option>
              {st.abteilungen.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              <option value="ohne">ohne Stammabteilung</option>
            </select>
          </Field>
          <div>
            <span className="block text-xs font-bold text-haselnuss mb-1">Sortierung</span>
            <Tabs<Sortierung> aktiv={sortierung} onChange={setSortierung}
              werte={[{ wert: 'abteilung', label: 'nach Stammabteilung' }, { wert: 'name', label: 'nach Name' }]} />
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold pb-2 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-[var(--color-fell)]" checked={nurAktive} onChange={(e) => setNurAktive(e.target.checked)} />
            nur aktive Mitarbeiter
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-stein pb-2" aria-label="Legende">
            {[1, 2, 3].map((l) => <span key={l} className="inline-flex items-center gap-1"><LevelPunkte level={l} /> {LEVEL[l]}</span>)}
            <span className="inline-flex items-center gap-1"><Icon name="verstoss" className="w-3.5 h-3.5 text-verstoss" /> Zertifikat abgelaufen</span>
            <span className="inline-flex items-center gap-1"><Icon name="warn" className="w-3.5 h-3.5 text-warn" /> läuft bald ab</span>
          </div>
        </div>
      </Card>

      {fehler ? <Fehler fehler={fehler} /> : laedt ? <Laden /> : (
        <Card polster={false}>
          {zeilen.length === 0 || skillsSortiert.length === 0 ? (
            <Leer titel={skillsSortiert.length === 0 ? 'Keine Skills definiert' : 'Keine Mitarbeiter'}>Filter anpassen oder Mitarbeiter anlegen.</Leer>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-sm border-collapse w-full">
                <caption className="sr-only">Skill-Matrix: Mitarbeiter in Zeilen, Skills in Spalten, Zellen zeigen das Level</caption>
                <thead>
                  <tr>
                    <th rowSpan={2} className="sticky left-0 z-10 bg-white text-left align-bottom px-3 py-2 border-b-2 border-sand text-xs font-bold uppercase tracking-wide text-stein min-w-[12rem]">Mitarbeiter</th>
                    {spalten.map((g) => (
                      <th key={g.kategorie} colSpan={g.skills.length} scope="colgroup"
                        className="px-2 pt-2 pb-1 text-[11px] font-extrabold uppercase tracking-wider text-haselnuss border-l border-sand text-center">
                        {SKILLKATEGORIEN[g.kategorie]}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {spalten.map((g) => g.skills.map((s, i) => (
                      <th key={s.id} scope="col" className={cx('px-1 pb-2 align-bottom border-b-2 border-sand', i === 0 && 'border-l')}>
                        <div className="flex flex-col items-center gap-1">
                          <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-bold text-rinde whitespace-nowrap max-h-40" title={s.name}>
                            {s.name.replace(/^Verräumen /, '')}
                          </span>
                          {engpass[s.id] !== undefined && (
                            <StatusBadge status="warn" titel={`Engpass: nur ${engpass[s.id]} aktive Personen`}>{engpass[s.id]}</StatusBadge>
                          )}
                        </div>
                      </th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {gruppen.map((g) => {
                    const abt = st.abteilungNach[g.id]
                    return (
                      <Fragment key={g.id}>
                        {sortierung === 'abteilung' && (
                          <tr className="bg-creme">
                            <th colSpan={spaltenzahl} scope="rowgroup" className="text-left px-3 py-1.5 text-xs font-extrabold text-rinde border-b border-sand">
                              <span className="sticky left-3 inline-flex items-center gap-2">
                                {abt ? <><AbteilungsPunkt farbe={abt.farbe} />{abt.name}</> : 'ohne Stammabteilung'}
                                <span className="font-semibold text-stein">({g.zeilen.length})</span>
                              </span>
                            </th>
                          </tr>
                        )}
                        {g.zeilen.map((m) => (
                          <tr key={m.id} className="hover:bg-[#FDFAF5] group">
                            <th scope="row" className="sticky left-0 z-10 bg-white group-hover:bg-[#FDFAF5] text-left font-normal px-3 py-1.5 border-b border-sand whitespace-nowrap">
                              <Link to={`/mitarbeiter/${m.id}`} className="font-semibold hover:text-fell-dunkel hover:underline">{m.nachname}, {m.vorname}</Link>
                              {sortierung === 'name' && m.stammabteilung_id && st.abteilungNach[m.stammabteilung_id] && (
                                <AbteilungsPunkt farbe={st.abteilungNach[m.stammabteilung_id].farbe} className="w-2 h-2 ml-2" />
                              )}
                            </th>
                            {skillsSortiert.map((s, i) => {
                              const ms = m.skills.find((x) => x.skill_id === s.id)
                              const zs = ms && s.hat_ablauf ? zertStatus(ms.zertifikat_bis, stichtag) : null
                              const ersterInGruppe = i === 0 || skillsSortiert[i - 1].kategorie !== s.kategorie
                              return (
                                <td key={s.id} className={cx('text-center px-1 py-1.5 border-b border-sand', ersterInGruppe && 'border-l',
                                  zs === 'verstoss' && 'bg-verstoss-hell')}
                                  title={ms ? `${s.name}: Level ${ms.level} (${LEVEL[ms.level]})${ms.zertifikat_bis ? ` · gültig bis ${fmtDatum(ms.zertifikat_bis)}` : ''}` : `${s.name}: –`}>
                                  {ms ? (
                                    <span className="inline-flex items-center gap-0.5">
                                      <LevelPunkte level={ms.level} />
                                      {zs === 'verstoss' && <Icon name="verstoss" className="w-3 h-3 text-verstoss" titel="Zertifikat abgelaufen" />}
                                      {zs === 'warn' && <Icon name="warn" className="w-3 h-3 text-warn" titel="Zertifikat läuft bald ab" />}
                                    </span>
                                  ) : <span className="text-sand" aria-label="nicht vorhanden">·</span>}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot className="text-xs">
                  <tr className="bg-creme">
                    <th scope="row" className="sticky left-0 z-10 bg-creme text-left px-3 py-1.5 font-bold text-stein border-t-2 border-sand">Anzahl</th>
                    {skillsSortiert.map((s) => <td key={s.id} className="text-center tabular-nums font-bold px-1 py-1.5 border-t-2 border-sand">{anzahl(s)}</td>)}
                  </tr>
                  <tr className="bg-creme">
                    <th scope="row" className="sticky left-0 z-10 bg-creme text-left px-3 py-1.5 font-bold text-stein">davon Level 3</th>
                    {skillsSortiert.map((s) => <td key={s.id} className="text-center tabular-nums px-1 py-1.5">{anzahl(s, 3)}</td>)}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
