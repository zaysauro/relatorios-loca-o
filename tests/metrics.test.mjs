// Indicadores da Locação (lib/metrics.ts): coorte, funil, locações, pré, captação, rescisões e metas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

async function load(rel, deps = {}) {
  let src = readFileSync(new URL('../' + rel, import.meta.url), 'utf8')
  for (const [from, to] of Object.entries(deps)) src = src.replaceAll(`from '${from}'`, `from '${to}'`)
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
}
const data = await load('lib/data.ts')
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(readFileSync(new URL('../lib/data.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')
const m = await load('lib/metrics.ts', { './data': dataUrl })
const D = s => data.dateToDay(new Date(s + 'T00:00:00Z'))

test('períodos: mês, mês passado, personalizado e inválido', () => {
  const today = D('2026-11-13')
  assert.deepEqual(m.rangeFor('mes', today), { from: D('2026-11-01'), to: today })
  assert.deepEqual(m.rangeFor('mes_passado', today), { from: D('2026-10-01'), to: D('2026-10-31') })
  assert.deepEqual(m.rangeFor('7d', today), { from: D('2026-11-07'), to: today })
  assert.deepEqual(m.rangeFor('personalizado', today, { from: '2026-09-01', to: '2026-09-30' }), { from: D('2026-09-01'), to: D('2026-09-30') })
  assert.equal(m.rangeFor('personalizado', today, { from: '2026-10-01', to: '2026-09-01' }), null)
})

test('consultor: coorte do período, funil pela etapa quando falta a data, locação pela data de fechamento', () => {
  const r = { from: D('2026-11-01'), to: D('2026-11-30') }
  const rows = [
    { consultor: 'A', etapa: 'VISITA', dNovo: D('2026-11-02'), dAtend: null, dVisita: null, valor: null },          // chegou à visita sem datas
    { consultor: 'A', etapa: 'LOCADO', dNovo: D('2026-11-03'), dLocado: D('2026-11-10'), valor: 2500 },              // locado no mês
    { consultor: 'A', etapa: 'LOCADO', dNovo: D('2026-10-15'), dLocado: D('2026-11-05'), valor: 1800 },              // entrou antes, fechou no mês
    { consultor: 'A', etapa: 'DESCARTADO', dNovo: D('2026-11-04'), dDescartado: D('2026-11-06') },
    { consultor: 'A', etapa: 'NOVO LEAD', dNovo: D('2026-12-01') },                                                   // fora
  ]
  const k = m.consultorKpis(rows, r)
  assert.equal(k.leads, 3)
  assert.equal(k.atendimentos, 2, 'visita e locado passaram pelo atendimento')
  assert.equal(k.visitas, 2)
  assert.equal(k.locacoes, 2, 'locações contam pela data de fechamento, inclusive lead de outubro')
  assert.equal(k.valorLocado, 4300)
  assert.equal(k.descartados, 1)
  assert.equal(k.conversao, 66.7, '2 locações fechadas no mês ÷ 3 leads recebidos no mês')
})

test('pré-atendimento: transferido, descartado e tempo médio', () => {
  const r = { from: D('2026-11-01'), to: D('2026-11-30') }
  const rows = [
    { sdr: 'X', etapa: 'ATENDIMENTO', consultor: 'Enison', dEntrada: D('2026-11-02'), tempo1aMsg: 10 },
    { sdr: 'X', etapa: 'DESCARTADO', consultor: null, dEntrada: D('2026-11-03'), dDescartado: D('2026-11-03'), tempo1aMsg: 20 },
    { sdr: 'X', etapa: 'NOVO LEAD', consultor: null, dEntrada: D('2026-11-04') },
  ]
  const k = m.preKpis(rows, r)
  assert.deepEqual(k, { recebidos: 3, transferidos: 1, descartados: 1, taxaTransferencia: 33.3, tempoMedio1aMsg: 15 })
})

test('rescisões: em andamento, prazo vencido e finalizadas no período', () => {
  const today = D('2026-11-13'); const r = { from: D('2026-11-01'), to: today }
  const rows = [
    { grupo: 'EM ANDAMENTO', estagio: 'AG VISTORIA', dCriado: D('2026-11-02'), dPrazo: D('2026-11-10') },
    { grupo: 'EM ANDAMENTO', estagio: 'AG VISTORIA', dCriado: D('2026-10-02'), dPrazo: D('2026-11-20') },
    { grupo: 'FINALIZADOS', estagio: 'FINALIZADO', dCriado: D('2026-09-02'), dBaixa: D('2026-11-05') },
    { grupo: 'EM ANDAMENTO', estagio: 'DESISTIU', dCriado: D('2026-11-03') },
  ]
  assert.deepEqual(m.rescisaoKpis(rows, r, today), { novas: 2, finalizadasNoPeriodo: 1, emAndamento: 2, atrasadas: 1, saidasNoPeriodo: 0 })
})

test('OKRs: agrupa por área e objetivo, progresso, ações feitas e atrasadas', () => {
  const today = D('2025-02-10')
  const rows = [
    { area: 'Carteira 01', objetivo: 'Reduzir custos', acao: 'A', status: 'Feito', progresso: null, dInicio: D('2025-01-01'), dFim: D('2025-01-16') },
    { area: 'Carteira 01', objetivo: 'Reduzir custos', acao: 'B', status: 'Em andamento', progresso: null, dInicio: D('2025-01-31'), dFim: D('2025-02-05') },
    { area: 'Carteira 01', objetivo: 'Reduzir custos', acao: 'C', status: null, progresso: null, dInicio: D('2025-02-23'), dFim: D('2025-02-28') },
    { area: 'Rescisão 01', objetivo: 'Imóvel vago em 7 dias', acao: 'D', status: 'Parado', progresso: 40, dInicio: D('2025-01-01'), dFim: D('2025-01-31') },
  ]
  const o = m.okrObjectives(rows, today)
  assert.equal(o.length, 2)
  const cart = o.find(x => x.area === 'Carteira 01')
  assert.deepEqual([cart.total, cart.feitas, cart.andamento, cart.atrasadas, cart.progresso], [3, 1, 1, 1, 33.3])
  assert.equal(cart.acoes[0].acao, 'A', 'ações em ordem de prazo')
  const resc = o.find(x => x.area === 'Rescisão 01')
  assert.equal(resc.progresso, 40, 'usa o campo Progresso quando preenchido'); assert.equal(resc.paradas, 1); assert.equal(resc.atrasadas, 1)
})
test('retrato: decodifica dicionário e mantém números e datas', () => {
  const snap = { dict: ['Enison', 'LOCADO'], consultores: { fields: ['consultor', 'etapa', 'valor', 'dNovo'], rows: [[0, 1, 2500, 100], [0, -1, null, 101]] } }
  assert.deepEqual(data.decode(snap, snap.consultores), [{ consultor: 'Enison', etapa: 'LOCADO', valor: 2500, dNovo: 100 }, { consultor: 'Enison', etapa: null, valor: null, dNovo: 101 }])
})
