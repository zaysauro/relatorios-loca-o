// Indicadores da Locação (puros: recebem linhas decodificadas, devolvem números). Testados em tests/metrics.test.mjs.
import { dateToDay, dayToDate, todayDay, type Data, type Row } from './data'

export type Range = { from: number; to: number } // dias inclusivos
export type Preset = '7d' | '30d' | 'mes' | 'mes_passado' | 'trimestre' | 'ano' | 'tudo' | 'personalizado'
export const PRESETS: [Preset, string][] = [['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Este mês'], ['mes_passado', 'Mês passado'], ['trimestre', 'Trimestre'], ['ano', 'Ano'], ['tudo', 'Tudo'], ['personalizado', 'Personalizado']]

export function rangeFor(p: Preset, today = todayDay(), custom?: { from: string; to: string }): Range | null {
  const t = dayToDate(today); const y = t.getUTCFullYear(), m = t.getUTCMonth()
  const d = (yy: number, mm: number, dd: number) => dateToDay(new Date(Date.UTC(yy, mm, dd)))
  switch (p) {
    case '7d': return { from: today - 6, to: today }
    case '30d': return { from: today - 29, to: today }
    case 'mes': return { from: d(y, m, 1), to: today }
    case 'mes_passado': return { from: d(y, m - 1, 1), to: d(y, m, 0) }
    case 'trimestre': { const q = Math.floor(m / 3) * 3; return { from: d(y, q, 1), to: today } }
    case 'ano': return { from: d(y, 0, 1), to: today }
    case 'tudo': return { from: 0, to: today }
    case 'personalizado': {
      if (!custom?.from || !custom?.to) return null
      const a = dateToDay(new Date(custom.from + 'T00:00:00Z')), b = dateToDay(new Date(custom.to + 'T00:00:00Z'))
      return Number.isFinite(a) && Number.isFinite(b) && a <= b ? { from: a, to: b } : null
    }
  }
}
export const inRange = (d: unknown, r: Range) => typeof d === 'number' && d >= r.from && d <= r.to
const up = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
export const pct = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : 0)
export const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((s, x) => s + (typeof x === 'number' ? x : 0), 0)
export function countBy<T>(rows: T[], key: (r: T) => string | null | undefined) {
  const m = new Map<string, number>(); for (const r of rows) { const k = key(r) || 'Não informado'; m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n)
}

// ---------- Consultores ----------
/** Etapa final do lead: "LOCADO" conta como locação mesmo sem a data preenchida (a data, quando existe, define o período). */
export const isLocado = (r: Row) => r.dLocado != null || up(r.etapa) === 'LOCADO'
export const isDescartado = (r: Row) => r.dDescartado != null || /DESCART|JA ALUGOU|DESIST/.test(up(r.etapa))
/** Data em que a locação conta: data de locação; sem ela, a última data conhecida do funil. */
export const locacaoDay = (r: Row) => (r.dLocado as number | null) ?? (r.dReserva as number | null) ?? (r.dProposta as number | null) ?? (r.dVisita as number | null) ?? (r.dNovo as number | null)
/** Chegou à etapa X? (data da etapa, ou etapa atual igual/posterior quando a data não foi preenchida). */
const ORDER = ['NOVO LEAD', 'ATENDIMENTO', 'AGENDAMENTO', 'VISITA', 'PROPOSTA', 'RESERVA', 'LOCADO']
const stageIdx = (r: Row) => { const e = up(r.etapa); if (e.startsWith('RESERV')) return 5; if (e === 'AG IMOVEL') return 1; return ORDER.indexOf(e) }
export function reached(r: Row, step: 'atend' | 'agend' | 'visita' | 'proposta' | 'reserva' | 'locado') {
  const idx = { atend: 1, agend: 2, visita: 3, proposta: 4, reserva: 5, locado: 6 }[step]
  const date = { atend: r.dAtend, agend: r.dAgend, visita: r.dVisita, proposta: r.dProposta, reserva: r.dReserva, locado: r.dLocado }[step]
  return date != null || stageIdx(r) >= idx
}

export type ConsultorKpis = { leads: number; atendimentos: number; agendamentos: number; visitas: number; propostas: number; reservas: number; locacoes: number; valorLocado: number; descartados: number; conversao: number }
/** Coorte: leads que ENTRARAM no período e até onde chegaram + locações FECHADAS no período (por data de locação). */
export function consultorKpis(rows: Row[], r: Range): ConsultorKpis {
  const coorte = rows.filter(x => inRange(x.dNovo, r))
  const fechadas = rows.filter(x => isLocado(x) && inRange(locacaoDay(x), r))
  const k = {
    leads: coorte.length,
    atendimentos: coorte.filter(x => reached(x, 'atend')).length,
    agendamentos: coorte.filter(x => reached(x, 'agend')).length,
    visitas: coorte.filter(x => reached(x, 'visita')).length,
    propostas: coorte.filter(x => reached(x, 'proposta')).length,
    reservas: coorte.filter(x => reached(x, 'reserva')).length,
    locacoes: fechadas.length,
    valorLocado: sum(fechadas.map(x => x.valor as number | null)),
    descartados: coorte.filter(isDescartado).length,
    conversao: 0,
  }
  // Conversão = locações fechadas no período ÷ leads recebidos no período (mesma régua do mês; a coorte ainda está em andamento).
  k.conversao = pct(k.locacoes, k.leads)
  return k
}

// ---------- Pré-atendimento ----------
export const preTransferido = (r: Row) => r.dTransferido != null || (!!r.consultor && !/DESCART/.test(up(r.etapa)))
export const preDescartado = (r: Row) => r.dDescartado != null || /DESCART|SEM CONTATO|JA ALUGOU/.test(up(r.etapa))
export function preKpis(rows: Row[], r: Range) {
  const c = rows.filter(x => inRange(x.dEntrada, r))
  const tempos = c.map(x => x.tempo1aMsg).filter((v): v is number => typeof v === 'number' && v >= 0)
  return {
    recebidos: c.length, transferidos: c.filter(preTransferido).length, descartados: c.filter(preDescartado).length,
    taxaTransferencia: pct(c.filter(preTransferido).length, c.length),
    tempoMedio1aMsg: tempos.length ? Math.round(sum(tempos) / tempos.length) : null,
  }
}

// ---------- Captação (angariadores) ----------
export const isAngariacao = (r: Row) => up(r.tipo) === 'ANGARIACAO'
export function captacaoKpis(rows: Row[], r: Range) {
  const c = rows.filter(x => inRange(x.dCriado, r))
  return {
    registros: c.length, angariacoes: c.filter(isAngariacao).length, prospeccoes: c.filter(x => up(x.tipo) === 'PROSPECCAO').length,
    locados: c.filter(x => up(x.status) === 'LOCADO').length, perdidos: c.filter(x => up(x.status) === 'PERDIDO' || /CHURN/.test(up(x.estagio))).length,
    valorLocado: sum(c.filter(x => up(x.status) === 'LOCADO').map(x => x.valorLocado as number | null)),
  }
}

// ---------- Carteira (proprietários) ----------
export function carteiraKpis(rows: Row[], r: Range) {
  const c = rows.filter(x => inRange(x.dCriado, r) || inRange(x.dSaida, r))
  return {
    acompanhados: c.length, locados: c.filter(x => up(x.status) === 'LOCADO').length, perdidos: c.filter(x => up(x.status) === 'PERDIDO' || /CHURN/.test(up(x.estagio))).length,
    disponiveis: c.filter(x => up(x.status) === 'DISPONIVEL').length, saidas: rows.filter(x => inRange(x.dSaida, r)).length,
  }
}

// ---------- Rescisões ----------
export const rescisaoFinalizada = (r: Row) => /FINALIZAD/.test(up(r.grupo)) || up(r.estagio) === 'FINALIZADO'
export function rescisaoKpis(rows: Row[], r: Range, today = todayDay()) {
  const entradas = rows.filter(x => inRange(x.dCriado, r))
  const abertas = rows.filter(x => !rescisaoFinalizada(x) && !/DESISTIU/.test(up(x.estagio)))
  return {
    novas: entradas.length, finalizadasNoPeriodo: rows.filter(x => rescisaoFinalizada(x) && inRange(x.dBaixa ?? x.dSaida, r)).length,
    emAndamento: abertas.length, atrasadas: abertas.filter(x => typeof x.dPrazo === 'number' && (x.dPrazo as number) < today).length,
    saidasNoPeriodo: rows.filter(x => inRange(x.dSaida, r)).length,
  }
}

// ---------- OKRs (quadros do Monday: objetivo = grupo, resultados-chave/ações = itens) ----------
export const okrDone = (r: Row) => /^(FEITO|CONCLUIDO|FINALIZADO)$/.test(up(r.status))
export type OkrObjective = { area: string; objetivo: string; total: number; feitas: number; andamento: number; paradas: number; atrasadas: number; progresso: number; inicio: number | null; fim: number | null; acoes: Row[] }
/** Agrupa por área + objetivo. Progresso = média do campo Progresso quando preenchido; senão, % de ações feitas. */
export function okrObjectives(rows: Row[], today = todayDay()): OkrObjective[] {
  const map = new Map<string, Row[]>()
  for (const r of rows) { const k = `${r.area ?? '—'}\u0000${r.objetivo ?? 'Sem objetivo'}`; map.set(k, [...(map.get(k) ?? []), r]) }
  return [...map.entries()].map(([k, acoes]) => {
    const [area, objetivo] = k.split('\u0000')
    const feitas = acoes.filter(okrDone).length
    const prog = acoes.map(a => a.progresso).filter((v): v is number => typeof v === 'number')
    const atrasadas = acoes.filter(a => !okrDone(a) && typeof a.dFim === 'number' && (a.dFim as number) < today).length
    const ini = acoes.map(a => a.dInicio).filter((v): v is number => typeof v === 'number'); const fim = acoes.map(a => a.dFim).filter((v): v is number => typeof v === 'number')
    return {
      area, objetivo, total: acoes.length, feitas, andamento: acoes.filter(a => /ANDAMENTO/.test(up(a.status))).length, paradas: acoes.filter(a => /PARADO/.test(up(a.status))).length,
      atrasadas, progresso: prog.length ? Math.round(sum(prog) / prog.length) : pct(feitas, acoes.length),
      inicio: ini.length ? Math.min(...ini) : null, fim: fim.length ? Math.max(...fim) : null,
      acoes: [...acoes].sort((a, b) => ((a.dFim as number) ?? 1e9) - ((b.dFim as number) ?? 1e9)),
    }
  }).sort((a, b) => a.area.localeCompare(b.area, 'pt-BR') || a.objetivo.localeCompare(b.objetivo, 'pt-BR'))
}
/** Série semanal (segunda-feira) para gráficos de tendência. */
export function weekly(r: Range, items: { day: number | null; key: string }[]) {
  const start = r.from - ((dayToDate(r.from).getUTCDay() + 6) % 7)
  const weeks = new Map<number, Record<string, number>>()
  for (let w = start; w <= r.to; w += 7) weeks.set(w, {})
  for (const it of items) {
    if (typeof it.day !== 'number' || it.day < r.from || it.day > r.to) continue
    const w = it.day - ((dayToDate(it.day).getUTCDay() + 6) % 7)
    const o = weeks.get(w); if (o) o[it.key] = (o[it.key] ?? 0) + 1
  }
  return [...weeks.entries()].map(([w, o]) => ({ semana: dayToDate(w).toISOString().slice(5, 10).split('-').reverse().join('/'), ...o }))
}
