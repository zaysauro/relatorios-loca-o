// Retrato gerado por scripts/sync-monday.mjs. Linhas compactas (arrays) + dicionário de textos.
export type Table = { fields: string[]; rows: (number | string | null)[][] }
export type Snapshot = {
  version: number; generatedAt: string; epoch: string; dict: string[]
  consultores: Table; pre: Table; angariadores: Table; carteira: Table; prospeccao: Table; rescisoes: Table; okrs: Table
}
export type Row = Record<string, string | number | null>

const EPOCH = Date.UTC(2020, 0, 1)
export const dayToDate = (d: number) => new Date(EPOCH + d * 864e5)
export const dateToDay = (dt: Date) => Math.round((Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) - EPOCH) / 864e5)
/** "Hoje" no calendário de São Paulo, em dias do retrato. */
export function todayDay(now = new Date()) { const sp = new Date(now.getTime() - 3 * 3600e3); return dateToDay(sp) }
export const fmtDay = (d: number | null) => (d == null ? '—' : dayToDate(d).toISOString().slice(0, 10).split('-').reverse().join('/'))

/** Converte uma tabela compacta em objetos. Campos de texto (índices no dicionário) viram strings; -1 vira null. */
export function decode(snap: Snapshot, t: Table): Row[] {
  const textual = new Set(t.fields.filter(f => !/^d[A-Z]|^(valor|tempo1aMsg|precificacao|valorLocado|ultimoAluguel|aluguel|vInquilino|vGarantia|vFci|progresso)$/.test(f) && f !== 'id'))
  return t.rows.map(r => {
    const o: Row = {}
    t.fields.forEach((f, i) => {
      const v = r[i]
      o[f] = textual.has(f) ? (typeof v === 'number' && v >= 0 ? snap.dict[v] : null) : (v as number | string | null)
    })
    return o
  })
}

export type Data = {
  generatedAt: string
  consultores: Row[]; pre: Row[]; angariadores: Row[]; carteira: Row[]; prospeccao: Row[]; rescisoes: Row[]; okrs: Row[]
}
export function decodeAll(s: Snapshot): Data {
  return {
    generatedAt: s.generatedAt,
    consultores: decode(s, s.consultores), pre: decode(s, s.pre), angariadores: decode(s, s.angariadores),
    carteira: decode(s, s.carteira), prospeccao: decode(s, s.prospeccao), rescisoes: decode(s, s.rescisoes), okrs: s.okrs ? decode(s, s.okrs) : [],
  }
}
