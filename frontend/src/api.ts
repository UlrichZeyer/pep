// API-Client, TypeScript-Typen und Beschriftungen.
// Dies ist der Vertrag zwischen Frontend und Backend (siehe docs/TECHNISCHES_KONZEPT.md, Kapitel 7).
// Datumswerte sind ISO-Strings ("2026-10-13"), Zeiten "HH:MM", Wochentage 0 = Mo … 5 = Sa.

export class ApiFehler extends Error {
  status: number
  constructor(status: number, meldung: string) {
    super(meldung)
    this.status = status
  }
}

async function anfrage<T>(methode: string, pfad: string, body?: unknown): Promise<T> {
  let antwort: Response
  try {
    antwort = await fetch(`/api${pfad}`, {
      method: methode,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiFehler(0, 'Backend nicht erreichbar – läuft der Server auf Port 8000?')
  }
  if (!antwort.ok) {
    let meldung = `Fehler ${antwort.status}`
    try {
      const daten = await antwort.json()
      if (typeof daten.detail === 'string') meldung = daten.detail
      else if (Array.isArray(daten.detail))
        meldung = daten.detail.map((d: { loc?: string[]; msg: string }) => `${d.loc?.slice(1).join('.') ?? ''}: ${d.msg}`).join('; ')
    } catch {
      /* keine JSON-Antwort */
    }
    throw new ApiFehler(antwort.status, meldung)
  }
  return antwort.json() as Promise<T>
}

/** Query-String aus einem Objekt bauen (undefined/null werden ausgelassen). */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  return p.length ? '?' + p.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&') : ''
}

export const http = {
  get: <T>(pfad: string) => anfrage<T>('GET', pfad),
  post: <T>(pfad: string, body?: unknown) => anfrage<T>('POST', pfad, body ?? {}),
  put: <T>(pfad: string, body?: unknown) => anfrage<T>('PUT', pfad, body ?? {}),
  del: <T>(pfad: string) => anfrage<T>('DELETE', pfad),
}

// ============================================================ Typen: Stammdaten
export type Bedarfsart = 'paletten' | 'frequenz' | 'fix'

export interface Abteilung {
  id: number
  name: string
  kuerzel: string
  farbe: string
  mindestbesetzung: number
  arbeitszeit_von: string
  arbeitszeit_bis: string
  bedarfsart: Bedarfsart
  sortierung: number
}

export type SkillKategorie = 'verraeumen' | 'kasse' | 'zertifikat' | 'sonstiges'

export interface Skill {
  id: number
  name: string
  kategorie: SkillKategorie
  hat_ablauf: boolean
  abteilung_id: number | null
}

export interface Warengruppe {
  id: number
  name: string
  abteilung_id: number
  skill_id: number
  std_leistung_pal_h: number
}

export interface Schichtmodell {
  id: number
  name: string
  beginn: string
  ende: string
  pause_min: number
}

export interface Regelparameter {
  schluessel: string
  wert: number
  beschreibung: string
}

export interface Stammdaten {
  abteilungen: Abteilung[]
  skills: Skill[]
  warengruppen: Warengruppe[]
  schichtmodelle: Schichtmodell[]
  regelparameter: Regelparameter[]
}

// ============================================================ Typen: Personal
export type Vertragsart = 'vollzeit' | 'teilzeit' | 'minijob' | 'werkstudent' | 'aushilfe' | 'azubi'
export type Rolle = 'filialleitung' | 'stellvertretung' | 'verkaeufer' | 'aushilfe' | 'azubi'
export type MitarbeiterStatus = 'aktiv' | 'inaktiv' | 'mutterschutz' | 'elternzeit'

export interface Vertrag {
  id: number
  mitarbeiter_id: number
  art: Vertragsart
  gueltig_ab: string
  gueltig_bis: string | null
  soll_std_woche: number
  max_std_monat: number | null
  max_tage_woche: number
  erlaubte_tage: string
  frueheste_zeit: string
  spaeteste_zeit: string
  urlaubstage: number
  stundenlohn: number
}
export type VertragIn = Omit<Vertrag, 'id' | 'mitarbeiter_id'>

export interface MitarbeiterSkill {
  id: number
  mitarbeiter_id: number
  skill_id: number
  level: 1 | 2 | 3
  leistungsfaktor: number
  zertifikat_bis: string | null
}
export type SkillZuordnungIn = Pick<MitarbeiterSkill, 'skill_id' | 'level' | 'leistungsfaktor' | 'zertifikat_bis'>

export type AbwesenheitTyp = 'urlaub' | 'krank' | 'schule' | 'fortbildung' | 'wunschfrei' | 'sonstiges'
export type AbwesenheitStatus = 'beantragt' | 'genehmigt' | 'abgelehnt'

export interface Abwesenheit {
  id: number
  mitarbeiter_id: number
  von: string
  bis: string
  typ: AbwesenheitTyp
  status: AbwesenheitStatus
  notiz: string | null
}
export type AbwesenheitIn = Omit<Abwesenheit, 'id'>

export interface MitarbeiterStamm {
  persnr: string
  vorname: string
  nachname: string
  geburtsdatum: string
  eintritt: string
  austritt: string | null
  stammabteilung_id: number | null
  rolle: Rolle
  status: MitarbeiterStatus
  stundenkonto: number
}

export interface Mitarbeiter extends MitarbeiterStamm {
  id: number
  quelle: 'mock' | 'manuell'
  name: string
  alter: number
  minderjaehrig: boolean
  vertrag: Vertrag | null
  skills: MitarbeiterSkill[]
  abwesend_heute: Abwesenheit | null
}

export interface MitarbeiterDetail extends Mitarbeiter {
  vertraege: Vertrag[]
  abwesenheiten: Abwesenheit[]
}

export interface MitarbeiterNeu extends MitarbeiterStamm {
  vertrag: VertragIn
}

// ============================================================ Typen: Kalender & Dashboard
export type KalenderTyp = 'hotday' | 'sondertag' | 'schliesstag'

export interface Kalendereintrag {
  id: number
  datum: string
  typ: KalenderTyp
  name: string
  lastfaktor: number
  urlaubssperre: boolean
  quelle: 'auto' | 'manuell' | 'mock'
}
export type KalendereintragIn = Pick<Kalendereintrag, 'datum' | 'typ' | 'name' | 'lastfaktor' | 'urlaubssperre'>

export interface Feiertag {
  datum: string
  name: string
}

export interface Kalender {
  jahr: number
  bundesland: string
  feiertage: Feiertag[]
  eintraege: Kalendereintrag[]
}

export interface Dashboard {
  stichtag: string
  mitarbeiter_gesamt: number
  mitarbeiter_aktiv: number
  abwesend_heute: { mitarbeiter_id: number; name: string; typ: AbwesenheitTyp; bis: string }[]
  naechste_feiertage: Feiertag[]
  naechste_hotdays: Kalendereintrag[]
  ablaufende_zertifikate: { mitarbeiter_id: number; name: string; skill: string; zertifikat_bis: string; abgelaufen: boolean }[]
  offene_urlaubsantraege: number
  paletten_diese_woche: number
  paletten_vorwoche: number
  stundenkonto_summe: number
  vertragsarten: Partial<Record<Vertragsart, number>>
}

export interface MitWarnungen<T> {
  warnungen: string[]
  abwesenheit: T
}

// ============================================================ Typen: Planung & Regelwerk (Cluster A)
export type PlanStatus = 'entwurf' | 'freigegeben' | 'veroeffentlicht'

export interface Plan {
  id: number
  name: string
  von: string
  bis: string
  status: PlanStatus
  erstellt_am: string
  quelle: string
  anzahl_einsaetze: number
}
export interface PlanIn {
  name?: string
  von: string
  bis: string
}

export interface Einsatz {
  id: number
  plan_id: number
  mitarbeiter_id: number
  abteilung_id: number
  datum: string
  beginn: string
  ende: string
  pause_min: number
  gesperrt: boolean
  quelle: 'manuell' | 'auto' | 'mock'
  ist_paletten: number | null
  /** Netto-Arbeitszeit in Stunden (vom Backend berechnet). */
  stunden: number
}
/** Fehlt pause_min, setzt das Backend die gesetzliche Mindestpause (§ 4 ArbZG). */
export interface EinsatzIn {
  mitarbeiter_id: number
  abteilung_id: number
  datum: string
  beginn: string
  ende: string
  pause_min?: number
  gesperrt?: boolean
}

export type Schwere = 'hart' | 'weich'

export interface Verstoss {
  regel: string // z. B. "ARBZG_5_RUHEZEIT"
  schwere: Schwere
  mitarbeiter_id: number
  datum: string
  einsatz_ids: number[]
  meldung: string
}

export interface Validierung {
  verstoesse: Verstoss[]
  zusammenfassung: { hart: number; weich: number }
}

export interface EinsatzErgebnis {
  einsatz: Einsatz
  /** Verstöße des betroffenen Mitarbeiters im Plan nach der Änderung. */
  verstoesse: Verstoss[]
}

export interface RegelInfo {
  code: string
  name: string
  quelle: string
  schwere: Schwere
}

// ============================================================ Typen: Bedarf & KPIs (Cluster B)
export interface BedarfSlot {
  beginn: string // "05:00", 30-Minuten-Slots
  koepfe: number
}
export interface BedarfAbteilung {
  abteilung_id: number
  stunden: number
  paletten: number
  slots: BedarfSlot[]
}
export interface BedarfTag {
  datum: string
  geschlossen: boolean
  lastfaktor: number
  hotday: string | null
  abteilungen: BedarfAbteilung[]
}
export interface Bedarf {
  slot_min: number
  tage: BedarfTag[]
}

export interface PrognoseTag {
  datum: string
  geschlossen: boolean
  lastfaktor: number
  hotday: string | null
  je_warengruppe: Record<string, number> // Schlüssel: warengruppe_id
  gesamt: number
}
export interface Prognose {
  von: string
  bis: string
  tage: PrognoseTag[]
}

export interface KpiAnlieferung {
  von: string
  bis: string
  /** Tageswerte */
  reihe: { datum: string; je_warengruppe: Record<string, number>; gesamt: number }[]
  /** Monatssummen ("2026-03") */
  monate: { monat: string; je_warengruppe: Record<string, number>; gesamt: number }[]
  /** Ø Paletten je Wochentag (0–5), gleitend über die letzten 4/8/12 Wochen bis "bis" */
  wochentagsmittel: Record<'4' | '8' | '12', { wochentag: number; je_warengruppe: Record<string, number>; gesamt: number }[]>
}

export interface AbdeckungWert {
  bedarf_std: number
  geplant_std: number
  /** geplant ÷ bedarf; null wenn kein Bedarf */
  abdeckung: number | null
}
export interface KpiAbdeckung {
  plan_id: number
  gesamt: AbdeckungWert
  tage: (AbdeckungWert & {
    datum: string
    abteilungen: (AbdeckungWert & { abteilung_id: number })[]
  })[]
}

export interface KpiLeistung {
  von: string
  bis: string
  abteilungen: { abteilung_id: number; paletten: number; stunden: number; pal_pro_h: number | null; soll_pal_pro_h: number | null }[]
}

export interface KpiStunden {
  von: string
  bis: string
  mitarbeiter: {
    mitarbeiter_id: number
    name: string
    vertragsart: Vertragsart | null
    soll_std: number
    geplant_std: number
    differenz: number
    stundenkonto: number
  }[]
}

export interface KpiPersonal {
  stichtag: string
  krankenquote: number // 0..1, letzte 12 Monate
  urlaub: { mitarbeiter_id: number; name: string; anspruch: number; genommen: number; geplant: number; rest: number }[]
  skill_abdeckung: { skill_id: number; anzahl: number; anzahl_level3: number; engpass: boolean }[]
}

// ============================================================ Typen: Auto-Planung (Cluster G)
export type AutoPlanModus = 'neu' | 'luecken' | 'umplanen'

export interface SolverGewichte {
  unterdeckung: number
  soll_abweichung: number
  ueberdeckung: number
  fremdabteilung: number
  fairness: number
  skill_level: number
}

export interface AutoPlanAnfrage {
  modus: AutoPlanModus
  gewichte?: Partial<SolverGewichte>
  zeitlimit_s?: number
}

export interface SolverBerichtZeile {
  datum: string
  abteilung_id: number | null
  art: 'unterdeckung' | 'ueberdeckung' | 'hinweis'
  stunden: number
  meldung: string
}

export interface SolverErgebnis {
  einsaetze_neu: number
  einsaetze_entfernt: number
  solver_status: string // OPTIMAL | FEASIBLE | INFEASIBLE …
  zielwert: number
  laufzeit_s: number
  abdeckung: number | null
  bericht: SolverBerichtZeile[]
  verstoesse: Verstoss[]
}

export interface SolverJob {
  job_id: string
  plan_id: number
  status: 'laeuft' | 'fertig' | 'fehler'
  fortschritt: number // 0..1
  meldung: string
  ergebnis: SolverErgebnis | null
}

// ============================================================ Endpunkte
export const api = {
  // Stammdaten
  stammdaten: () => http.get<Stammdaten>('/stammdaten'),
  abteilungAendern: (id: number, d: Partial<Abteilung>) => http.put<Abteilung>(`/abteilungen/${id}`, d),
  warengruppeAendern: (id: number, std_leistung_pal_h: number) => http.put<Warengruppe>(`/warengruppen/${id}`, { std_leistung_pal_h }),
  regelparameterAendern: (schluessel: string, wert: number) => http.put<Regelparameter>(`/regelparameter/${schluessel}`, { wert }),

  // Personal
  mitarbeiter: (stichtag?: string) => http.get<Mitarbeiter[]>(`/mitarbeiter${qs({ stichtag })}`),
  mitarbeiterDetail: (id: number) => http.get<MitarbeiterDetail>(`/mitarbeiter/${id}`),
  mitarbeiterAnlegen: (d: MitarbeiterNeu) => http.post<MitarbeiterDetail>('/mitarbeiter', d),
  mitarbeiterAendern: (id: number, d: MitarbeiterStamm) => http.put<MitarbeiterDetail>(`/mitarbeiter/${id}`, d),
  vertragAnlegen: (mitarbeiterId: number, d: VertragIn) => http.post<Vertrag>(`/mitarbeiter/${mitarbeiterId}/vertraege`, d),
  vertragAendern: (id: number, d: VertragIn) => http.put<Vertrag>(`/vertraege/${id}`, d),
  skillsSetzen: (mitarbeiterId: number, d: SkillZuordnungIn[]) => http.put<MitarbeiterSkill[]>(`/mitarbeiter/${mitarbeiterId}/skills`, d),

  // Abwesenheiten
  abwesenheiten: (von: string, bis: string, mitarbeiter_id?: number) => http.get<Abwesenheit[]>(`/abwesenheiten${qs({ von, bis, mitarbeiter_id })}`),
  abwesenheitAnlegen: (d: AbwesenheitIn) => http.post<MitWarnungen<Abwesenheit>>('/abwesenheiten', d),
  abwesenheitAendern: (id: number, d: AbwesenheitIn) => http.put<MitWarnungen<Abwesenheit>>(`/abwesenheiten/${id}`, d),
  abwesenheitLoeschen: (id: number) => http.del<{ ok: boolean }>(`/abwesenheiten/${id}`),

  // Kalender
  kalender: (jahr: number) => http.get<Kalender>(`/kalender${qs({ jahr })}`),
  kalendereintragAnlegen: (d: KalendereintragIn) => http.post<Kalendereintrag>('/kalender/eintraege', d),
  kalendereintragAendern: (id: number, d: KalendereintragIn) => http.put<Kalendereintrag>(`/kalender/eintraege/${id}`, d),
  kalendereintragLoeschen: (id: number) => http.del<{ ok: boolean }>(`/kalender/eintraege/${id}`),
  hotdaysVorschlagen: (jahr: number) => http.post<{ jahr: number; erzeugt: number }>(`/kalender/hotdays-vorschlagen${qs({ jahr })}`),

  // Übersicht & Admin
  dashboard: () => http.get<Dashboard>('/dashboard'),
  demodaten: () => http.post<Record<string, number | string>>('/admin/demodaten'),

  // Planung (Cluster A)
  plaene: (von?: string, bis?: string) => http.get<Plan[]>(`/plaene${qs({ von, bis })}`),
  plan: (id: number) => http.get<Plan>(`/plaene/${id}`),
  planAnlegen: (d: PlanIn) => http.post<Plan>('/plaene', d),
  planAendern: (id: number, d: { name?: string; status?: PlanStatus }) => http.put<Plan>(`/plaene/${id}`, d),
  planLoeschen: (id: number) => http.del<{ ok: boolean }>(`/plaene/${id}`),
  einsaetze: (planId: number) => http.get<Einsatz[]>(`/plaene/${planId}/einsaetze`),
  einsatzAnlegen: (planId: number, d: EinsatzIn) => http.post<EinsatzErgebnis>(`/plaene/${planId}/einsaetze`, d),
  einsatzAendern: (id: number, d: Partial<EinsatzIn>) => http.put<EinsatzErgebnis>(`/einsaetze/${id}`, d),
  einsatzLoeschen: (id: number) => http.del<{ ok: boolean }>(`/einsaetze/${id}`),
  validieren: (planId: number) => http.post<Validierung>(`/plaene/${planId}/validieren`),
  regeln: () => http.get<RegelInfo[]>('/regeln'),

  // Bedarf & KPIs (Cluster B)
  bedarf: (von: string, bis: string) => http.get<Bedarf>(`/bedarf${qs({ von, bis })}`),
  prognose: (von: string, bis: string) => http.get<Prognose>(`/kpi/prognose${qs({ von, bis })}`),
  kpiAnlieferung: (von: string, bis: string) => http.get<KpiAnlieferung>(`/kpi/anlieferung${qs({ von, bis })}`),
  kpiAbdeckung: (planId: number) => http.get<KpiAbdeckung>(`/kpi/abdeckung${qs({ plan_id: planId })}`),
  kpiLeistung: (von: string, bis: string) => http.get<KpiLeistung>(`/kpi/leistung${qs({ von, bis })}`),
  kpiStunden: (von: string, bis: string) => http.get<KpiStunden>(`/kpi/stunden${qs({ von, bis })}`),
  kpiPersonal: () => http.get<KpiPersonal>('/kpi/personal'),

  // Auto-Planung (Cluster G)
  solverGewichte: () => http.get<SolverGewichte>('/solver/gewichte'),
  autoPlanen: (planId: number, d: AutoPlanAnfrage) => http.post<SolverJob>(`/plaene/${planId}/auto-planen`, d),
  solverJob: (jobId: string) => http.get<SolverJob>(`/solver/jobs/${jobId}`),
}

// Export (Cluster H) – Datei-Download per Link
export type ExportFormat = 'pdf' | 'xlsx' | 'csv'
export const exportUrl = (planId: number, format: ExportFormat) => `/api/plaene/${planId}/export?format=${format}`

// ============================================================ Beschriftungen
export const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
export const WOCHENTAGE_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

export const VERTRAGSARTEN: Record<Vertragsart, string> = {
  vollzeit: 'Vollzeit', teilzeit: 'Teilzeit', minijob: 'Minijob', werkstudent: 'Werkstudent', aushilfe: 'Aushilfe', azubi: 'Azubi',
}
export const ROLLEN: Record<Rolle, string> = {
  filialleitung: 'Filialleitung', stellvertretung: 'Stellvertretung', verkaeufer: 'Verkäufer/in', aushilfe: 'Aushilfe', azubi: 'Auszubildende/r',
}
export const STATUS: Record<MitarbeiterStatus, string> = {
  aktiv: 'aktiv', inaktiv: 'inaktiv', mutterschutz: 'Mutterschutz', elternzeit: 'Elternzeit',
}
export const ABWESENHEITSTYPEN: Record<AbwesenheitTyp, string> = {
  urlaub: 'Urlaub', krank: 'Krank', schule: 'Berufsschule', fortbildung: 'Fortbildung', wunschfrei: 'Wunschfrei', sonstiges: 'Sonstiges',
}
/** Kürzel für den Monatsplan */
export const ABWESENHEITSKUERZEL: Record<AbwesenheitTyp, string> = {
  urlaub: 'U', krank: 'K', schule: 'BS', fortbildung: 'FB', wunschfrei: 'W', sonstiges: 'X',
}
export const ABWESENHEITSSTATUS: Record<AbwesenheitStatus, string> = {
  beantragt: 'beantragt', genehmigt: 'genehmigt', abgelehnt: 'abgelehnt',
}
export const KALENDERTYPEN: Record<KalenderTyp, string> = {
  hotday: 'Hotday', sondertag: 'Sondertag', schliesstag: 'Schließtag',
}
export const SKILLKATEGORIEN: Record<SkillKategorie, string> = {
  verraeumen: 'Verräumen', kasse: 'Kasse', zertifikat: 'Zertifikat', sonstiges: 'Sonstiges',
}
export const LEVEL: Record<number, string> = { 1: 'Einarbeitung', 2: 'selbstständig', 3: 'Experte' }
export const PLANSTATUS: Record<PlanStatus, string> = {
  entwurf: 'Entwurf', freigegeben: 'freigegeben', veroeffentlicht: 'veröffentlicht',
}
