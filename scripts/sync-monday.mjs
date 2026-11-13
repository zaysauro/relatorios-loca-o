// Sincronização SÓ LEITURA do Monday → "retrato" agregável dos relatórios da Locação.
// Nunca grava no Monday. Não leva dados de clientes (nome, telefone, e-mail, endereço, proprietário, observações):
// só datas, etapas, pessoas da equipe, mídia, bairro, quartos, tipologia e valores.
// Uso: MONDAY_API_TOKEN=... node scripts/sync-monday.mjs [--out arquivo.json] [--upload]
//   --upload grava no Vercel Blob (BLOB_READ_WRITE_TOKEN + SNAPSHOT_PATH). Logs só com contagens (repo público).
import { writeFileSync } from 'node:fs'

const TOKEN = process.env.MONDAY_API_TOKEN
if (!TOKEN) { console.error('MONDAY_API_TOKEN ausente'); process.exit(2) }
const args = process.argv.slice(2)
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : null
const UPLOAD = args.includes('--upload')

// Quadros (ids do Monday). Históricos/antigos ficam de fora quando duplicam o quadro atual.
export const SOURCES = {
  consultores: [
    { id: '9560945416', who: 'Enison' }, { id: '9560926523', who: 'Miqueias' }, { id: '18404048685', who: 'Yasmin' },
    { id: '9560910549', who: 'Marcelo' }, { id: '9560938157', who: 'Claudia' },
  ],
  pre: [{ id: '9536554198', label: 'atual' }, { id: '18437285104', label: 'histórico 2026' }],
  angariadores: [{ id: '4255749023' }],
  carteira: [{ id: '3982244545' }],
  prospeccao: [{ id: '18431621646' }],
  rescisoes: [{ id: '8261099202', label: 'Rescisão 01' }, { id: '2911614515', label: 'Rescisão 02' }],
}
// OKRs da Locação já existentes no Monday (workspace LUIZA): planos de ação por objetivo (grupo), com responsável, status e prazo.
export const OKR_BOARDS = [
  { id: '8144986827', area: 'Gestão (Luiza)' }, { id: '8157831809', area: 'Carteira 01' }, { id: '8157977808', area: 'Carteira 02' },
  { id: '8158130265', area: 'Rescisão 01' }, { id: '8158143759', area: 'Rescisão 02' }, { id: '8205196106', area: 'Contrato' },
  { id: '8205534697', area: 'Aux. contrato' }, { id: '8205594632', area: 'Manutenção' },
]

// ---------- Monday ----------
async function gql(query, variables = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { Authorization: TOKEN, 'Content-Type': 'application/json', 'API-Version': '2024-10' }, body: JSON.stringify({ query, variables }) })
    const j = await r.json().catch(() => ({}))
    const msg = JSON.stringify(j.errors || j.error_message || '')
    if (r.status === 429 || /complexity|rate limit|minute/i.test(msg)) { await new Promise(s => setTimeout(s, 15000 * (attempt + 1))); continue }
    if (!r.ok || j.errors) throw new Error(`Monday ${r.status}: ${msg.slice(0, 200)}`)
    return j.data
  }
  throw new Error('Monday: limite de requisições persistente')
}
async function boardMeta(id) {
  const d = await gql(`query($b:[ID!]){ boards(ids:$b){ id name columns{ id title type } } }`, { b: [id] })
  return d.boards[0]
}
async function boardItems(id, colIds) {
  const f = `id name created_at group{ title } column_values(ids:$cols){ id text value ... on PeopleValue { persons_and_teams { id } } }`
  let d = await gql(`query($b:[ID!],$cols:[String!]){ boards(ids:$b){ items_page(limit:500){ cursor items{ ${f} } } } }`, { b: [id], cols: colIds })
  let page = d.boards[0].items_page; const items = [...page.items]
  while (page.cursor) {
    d = await gql(`query($c:String!,$cols:[String!]){ next_items_page(limit:500,cursor:$c){ cursor items{ ${f} } } }`, { c: page.cursor, cols: colIds })
    page = d.next_items_page; items.push(...page.items)
  }
  return items
}

// ---------- Normalização ----------
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
/** Acha a coluna pelo título (regex sobre o título normalizado) e, opcionalmente, pelo tipo. */
function pick(cols, re, type) { return cols.find(c => re.test(norm(c.title)) && (!type || c.type === type)) }
const EPOCH = Date.UTC(2020, 0, 1)
/** Data → dia (inteiro desde 2020-01-01), no calendário de São Paulo. */
function day(v) {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
  if (m) return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 864e5)
  const t = Date.parse(v); if (!Number.isFinite(t)) return null
  const sp = new Date(t - 3 * 3600e3)
  return Math.round((Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate()) - EPOCH) / 864e5)
}
const num = v => { const n = Number(String(v ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null }
const txt = v => { const s = String(v ?? '').trim(); return s || null }
function dateOf(cv) { if (!cv) return null; try { const v = JSON.parse(cv.value || 'null'); if (v?.date) return day(v.date); if (v?.created_at) return day(v.created_at) } catch {} return day(cv.text) }
function cell(item, col) { return col ? item.column_values.find(c => c.id === col.id) : undefined }
/** Pessoa: nome do usuário do Monday (equipe). Só o primeiro, para não vazar listas. */
const person = cv => txt(cv?.text?.split(',')[0])

// Dicionário de textos repetidos (encurta o retrato).
const dict = []; const dictIndex = new Map()
const D = s => { if (s == null) return -1; const k = String(s); if (!dictIndex.has(k)) { dictIndex.set(k, dict.length); dict.push(k) } return dictIndex.get(k) }

async function readBoard(id, wanted) {
  const meta = await boardMeta(id)
  const cols = {}
  for (const [key, [re, type]] of Object.entries(wanted)) cols[key] = pick(meta.columns, re, type)
  const ids = Object.values(cols).filter(Boolean).map(c => c.id)
  const items = await boardItems(id, ids)
  return { meta, cols, items }
}

// ---------- Fontes ----------
async function consultores() {
  const rows = []
  for (const src of SOURCES.consultores) {
    const { cols, items } = await readBoard(src.id, {
      etapa: [/^ETAPA FUNIL$/, 'status'], midia: [/^MIDIA$/, 'status'], bairro: [/^BAIRRO$/, 'dropdown'], quartos: [/QUARTO/, 'status'],
      valor: [/^B - VALOR$/], valorLocado: [/^VALOR LOCADO$/], data: [/^DATA$/, 'date'],
      novo: [/NOVO LEAD$/, 'date'], atend: [/ATENDIMENTO$/, 'date'], agend: [/AGENDAMENTO$/, 'date'], visita: [/VISITA$/, 'date'],
      proposta: [/PROPOSTA$/, 'date'], reserva: [/RESERVA(DO)?$/, 'date'], locado: [/LOCADO$/, 'date'], descartado: [/DESCARTADO$/, 'date'],
      motivo: [/^(LIVRE|ANOTACOES)$/, 'status'],
    })
    for (const it of items) {
      const c = k => cell(it, cols[k])
      const etapa = txt(c('etapa')?.text)
      const novo = dateOf(c('novo')) ?? dateOf(c('data')) ?? day(it.created_at)
      rows.push([D(src.who), D(etapa), D(txt(c('midia')?.text)), D(txt(c('bairro')?.text?.split(',')[0])), D(txt(c('quartos')?.text)),
        num(c('valorLocado')?.text) ?? num(c('valor')?.text), novo, dateOf(c('atend')), dateOf(c('agend')), dateOf(c('visita')),
        dateOf(c('proposta')), dateOf(c('reserva')), dateOf(c('locado')), dateOf(c('descartado')), D(txt(c('motivo')?.text))])
    }
    console.log(`consultor ${src.who}: ${items.length} itens`)
  }
  return { fields: ['consultor', 'etapa', 'midia', 'bairro', 'quartos', 'valor', 'dNovo', 'dAtend', 'dAgend', 'dVisita', 'dProposta', 'dReserva', 'dLocado', 'dDescartado', 'situacao'], rows }
}

async function pre() {
  const rows = []; const seen = new Set()
  for (const src of SOURCES.pre) {
    const { cols, items } = await readBoard(src.id, {
      sdr: [/^MQL$/, 'people'], etapa: [/^ETAPA FUNIL$/, 'status'], cadencia: [/CADENCIA PRE/, 'status'], midia: [/^MIDIA$/, 'status'],
      consultor: [/^CONSULTOR$/, 'status'], data: [/^DATA$/, 'date'], transferido: [/^TRANSFERIDO$/, 'date'], descartado: [/^DESCARTADO$/, 'date'],
      motivo: [/MOTIVO DESCARTE/, 'status'], tempo: [/TEMPO ATE 1/, 'numbers'], bairro: [/^BAIRRO$/, 'dropdown'], valor: [/^B - VALOR$/],
    })
    for (const it of items) {
      if (seen.has(it.id)) continue; seen.add(it.id)
      const c = k => cell(it, cols[k])
      rows.push([D(person(c('sdr'))), D(txt(c('etapa')?.text)), D(txt(c('cadencia')?.text)), D(txt(c('midia')?.text)), D(txt(c('consultor')?.text)),
        dateOf(c('data')) ?? day(it.created_at), dateOf(c('transferido')), dateOf(c('descartado')), D(txt(c('motivo')?.text)), num(c('tempo')?.text),
        D(txt(c('bairro')?.text?.split(',')[0])), num(c('valor')?.text)])
    }
    console.log(`pré-atendimento ${src.label}: ${items.length} itens`)
  }
  return { fields: ['sdr', 'etapa', 'cadencia', 'midia', 'consultor', 'dEntrada', 'dTransferido', 'dDescartado', 'motivo', 'tempo1aMsg', 'bairro', 'valor'], rows }
}

async function followup(kind) {
  const id = SOURCES[kind][0].id
  const { cols, items } = await readBoard(id, {
    pessoa: [/^PESSOA$/, 'people'], tipo: [/^TIPO$/, 'status'], status: [/^STATUS$/, 'status'], estagio: [/^ESTAGIO$/, 'status'],
    criado: [/^CRIADO EM$/, 'creation_log'], prazo: [/^PRAZO$/, 'date'], precificacao: [/^PRECIFICACAO$/], valorLocado: [/^VALOR LOCADO$/],
    churn: [/^MOTIVO CHURN$/, 'status'], forma: [/FORMA DE CAPTACAO/, 'status'], angariado: [/ANGARIADO/, 'dropdown'], saida: [/^SAIDA$/, 'date'],
    ultimoAluguel: [/ULTIMO ALUGUEL/], atualizado: [/ULTIMA ATUALIZACAO/],
  })
  const rows = items.map(it => { const c = k => cell(it, cols[k]); return [
    D(person(c('pessoa'))), D(txt(c('tipo')?.text)), D(txt(c('status')?.text)), D(txt(c('estagio')?.text)), dateOf(c('criado')) ?? day(it.created_at),
    dateOf(c('prazo')), num(c('precificacao')?.text), num(c('valorLocado')?.text), D(txt(c('churn')?.text)), D(txt(c('forma')?.text)),
    D(txt(c('angariado')?.text?.split(',')[0])), dateOf(c('saida')), num(c('ultimoAluguel')?.text), dateOf(c('atualizado')), D(txt(it.group?.title))] })
  console.log(`${kind}: ${items.length} itens`)
  return { fields: ['pessoa', 'tipo', 'status', 'estagio', 'dCriado', 'dPrazo', 'precificacao', 'valorLocado', 'churn', 'forma', 'angariadoPor', 'dSaida', 'ultimoAluguel', 'dAtualizado', 'grupo'], rows }
}

async function prospeccao() {
  const { cols, items } = await readBoard(SOURCES.prospeccao[0].id, {
    etapa: [/^ETAPA$/, 'status'], captadora: [/^CAPTADORA$/, 'status'], follow: [/^FOLLOW - UP$/, 'status'], exclusividade: [/EXCLUSIVIDADE/, 'status'],
    origem: [/^ORIGEM$/, 'status'], funil: [/^FUNIL$/, 'status'], tipologia: [/TIPOLOGIA/, 'dropdown'], bairro: [/^BAIRRO$/, 'dropdown'],
    encontrado: [/DATA ENCONTRADO/, 'date'], angariado: [/DATA ANGARIADO/, 'date'], pre: [/PRE ATENDIMENTO/, 'people'],
  })
  const rows = items.map(it => { const c = k => cell(it, cols[k]); return [
    D(txt(c('captadora')?.text)), D(person(c('pre'))), D(txt(c('etapa')?.text)), D(txt(c('follow')?.text)), D(txt(c('exclusividade')?.text)),
    D(txt(c('origem')?.text)), D(txt(c('funil')?.text)), D(txt(c('tipologia')?.text?.split(',')[0])), D(txt(c('bairro')?.text?.split(',')[0])),
    dateOf(c('encontrado')) ?? day(it.created_at), dateOf(c('angariado'))] })
  console.log(`prospecção: ${items.length} itens`)
  return { fields: ['captadora', 'pre', 'etapa', 'followUp', 'exclusividade', 'origem', 'funil', 'tipologia', 'bairro', 'dEncontrado', 'dAngariado'], rows }
}

async function rescisoes() {
  const rows = []
  for (const src of SOURCES.rescisoes) {
    const { cols, items } = await readBoard(src.id, {
      pessoa: [/^PESSOA$/, 'people'], status2: [/^STATUS II$/, 'status'], estagio: [/^ESTAGIO$/, 'status'], estagio2: [/^ESTAGIO II$/, 'status'],
      status: [/^STATUS$/, 'status'], prioridade: [/^PRIORIDADE$/, 'status'], criado: [/^CRIADO EM$/, 'creation_log'], prazo: [/^PRAZO$/, 'date'],
      vistoria: [/^VISTORIA$/, 'date'], saida: [/^SAIDA$/, 'date'], baixa: [/^BAIXA SISTEMA$/, 'date'], aluguel: [/^ALUGUEL$/, 'numbers'],
      inquilino: [/TOTAL INQUILINO/], garantia: [/TOTAL GARANTIA/], fci: [/TOTAL FCI/], saldo: [/POSSUI SALDO/, 'status'], temporario: [/^TEMPORARIO$/, 'status'],
      garantiaTipo: [/CART.\/GARANTIA/, 'dropdown'],
    })
    for (const it of items) {
      const c = k => cell(it, cols[k])
      rows.push([D(src.label), D(person(c('pessoa'))), D(txt(it.group?.title)), D(txt(c('estagio')?.text)), D(txt(c('estagio2')?.text)), D(txt(c('status')?.text)),
        D(txt(c('status2')?.text)), D(txt(c('prioridade')?.text)), dateOf(c('criado')) ?? day(it.created_at), dateOf(c('prazo')), dateOf(c('vistoria')),
        dateOf(c('saida')), dateOf(c('baixa')), num(c('aluguel')?.text), num(c('inquilino')?.text), num(c('garantia')?.text), num(c('fci')?.text),
        D(txt(c('saldo')?.text)), D(txt(c('temporario')?.text)), D(txt(c('garantiaTipo')?.text?.split(',')[0]))])
    }
    console.log(`rescisões ${src.label}: ${items.length} itens`)
  }
  return { fields: ['quadro', 'pessoa', 'grupo', 'estagio', 'estagio2', 'status', 'status2', 'prioridade', 'dCriado', 'dPrazo', 'dVistoria', 'dSaida', 'dBaixa', 'aluguel', 'vInquilino', 'vGarantia', 'vFci', 'saldo', 'temporario', 'garantia'], rows }
}

async function okrs() {
  const rows = []
  for (const src of OKR_BOARDS) {
    const { cols, items } = await readBoard(src.id, {
      lead: [/^LEAD$/, 'people'], prioridade: [/^PRIORIDADE$/, 'status'], status: [/^STATUS$/, 'status'], progresso: [/^PROGRESSO$/], timeline: [/^TIMELINE$/, 'timeline'],
    })
    for (const it of items) {
      const c = k => cell(it, cols[k])
      let ini = null, fim = null
      try { const v = JSON.parse(c('timeline')?.value || 'null'); ini = day(v?.from); fim = day(v?.to) } catch {}
      // Nome da tarefa é um plano de ação interno (não é dado de cliente).
      rows.push([D(src.area), D(txt(it.group?.title)), D(txt(it.name)), D(person(c('lead'))), D(txt(c('prioridade')?.text)), D(txt(c('status')?.text)), num(c('progresso')?.text), ini, fim])
    }
    console.log(`OKR ${src.area}: ${items.length} itens`)
  }
  return { fields: ['area', 'objetivo', 'acao', 'responsavel', 'prioridade', 'status', 'progresso', 'dInicio', 'dFim'], rows }
}
// ---------- Execução ----------
const t0 = Date.now()
const [c, p, a, h, pr, r, o] = await Promise.all([consultores(), pre(), followup('angariadores'), followup('carteira'), prospeccao(), rescisoes(), okrs()])
const snapshot = { version: 1, generatedAt: new Date().toISOString(), epoch: '2020-01-01', dict, consultores: c, pre: p, angariadores: a, carteira: h, prospeccao: pr, rescisoes: r, okrs: o }
const json = JSON.stringify(snapshot)
console.log(`retrato: ${(json.length / 1024).toFixed(0)} KB, ${dict.length} termos, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
if (OUT) writeFileSync(OUT, json)
if (UPLOAD) {
  const { put } = await import('@vercel/blob')
  const pathname = process.env.SNAPSHOT_PATH
  if (!pathname || !process.env.BLOB_READ_WRITE_TOKEN) { console.error('SNAPSHOT_PATH/BLOB_READ_WRITE_TOKEN ausentes'); process.exit(2) }
  await put(pathname, json, { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 })
  console.log('retrato publicado')
}
