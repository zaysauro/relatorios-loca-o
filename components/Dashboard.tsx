'use client'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BadgeCheck, CalendarCheck, Clock, FileSignature, Home, Inbox, KeyRound, Send, Target, TrendingDown, UserCheck, Users, Wallet } from 'lucide-react'
import { decodeAll, fmtDay, todayDay, type Data, type Snapshot } from '../lib/data'
import {
  PRESETS, captacaoKpis, carteiraKpis, consultorKpis, countBy, inRange, isLocado, locacaoDay, okrDone, okrObjectives, pct, preKpis, preTransferido,
  rangeFor, reached, rescisaoFinalizada, rescisaoKpis, weekly, type Preset, type Range,
} from '../lib/metrics'

type Tab = 'geral' | 'consultores' | 'pre' | 'captacao' | 'carteira' | 'rescisoes' | 'metas'
const TABS: [Tab, string][] = [['geral', 'Visão geral'], ['consultores', 'Consultores (one-on-one)'], ['pre', 'Pré-atendimento'], ['captacao', 'Captação'], ['carteira', 'Carteira de proprietários'], ['rescisoes', 'Rescisões'], ['metas', 'OKRs']]
const COLORS = ['#F5C400', '#3B82F6', '#22C55E', '#A78BFA', '#FB7185', '#14B8A6', '#F97316', '#94A3B8']
const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const INT = (v: number) => v.toLocaleString('pt-BR')
const up = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const uniq = (xs: (string | number | null)[]) => [...new Set(xs.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
const prev = (r: Range): Range => { const len = r.to - r.from + 1; return { from: r.from - len, to: r.from - 1 } }

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('geral')
  const [preset, setPreset] = useState<Preset>('mes')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [pessoa, setPessoa] = useState('')

  useEffect(() => {
    let live = true
    fetch('/api/snapshot', { cache: 'no-store' })
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Não foi possível carregar os dados.'); return r.json() as Promise<Snapshot> })
      .then(s => { if (live) setData(decodeAll(s)) })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [])
  useEffect(() => { setPessoa('') }, [tab])

  const range = useMemo(() => rangeFor(preset, todayDay(), custom), [preset, custom])
  const people = useMemo(() => {
    if (!data) return []
    switch (tab) {
      case 'consultores': return uniq(data.consultores.map(r => r.consultor))
      case 'pre': return uniq(data.pre.map(r => r.sdr))
      case 'captacao': return uniq(data.angariadores.map(r => r.pessoa))
      case 'carteira': return uniq(data.carteira.map(r => r.pessoa))
      case 'rescisoes': return uniq(data.rescisoes.map(r => r.pessoa))
      default: return []
    }
  }, [data, tab])

  return <main className="wrap">
    <header className="head">
      <div>
        <div className="eyebrow">Cadena · Locação</div>
        <h1>Relatórios da Locação</h1>
        <p className="sub">Resultados do Monday para acompanhamento e reuniões one-on-one da equipe.</p>
      </div>
      {data && <span className="updated">Dados do Monday atualizados em {new Date(data.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}</span>}
    </header>

    <div className="bar" role="group" aria-label="Período">
      {PRESETS.map(([p, l]) => <button key={p} type="button" className="chip" aria-pressed={preset === p} onClick={() => setPreset(p)}>{l}</button>)}
      {preset === 'personalizado' && <>
        <label className="field">De<input type="date" value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} /></label>
        <label className="field">Até<input type="date" value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} /></label>
      </>}
    </div>

    <nav className="tabs" role="tablist" aria-label="Relatórios">
      {TABS.map(([t, l]) => <button key={t} type="button" role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{l}</button>)}
    </nav>

    {people.length > 0 && <div className="bar">
      <label className="field">Pessoa<select value={pessoa} onChange={e => setPessoa(e.target.value)}>
        <option value="">Toda a equipe</option>{people.map(p => <option key={p} value={p}>{p}</option>)}
      </select></label>
    </div>}

    {error ? <div className="empty" role="alert">{error}</div>
      : !data ? <div className="kpis">{Array.from({ length: 5 }, (_, i) => <div key={i} className="skel" style={{ height: 120 }} />)}</div>
      : !range ? <div className="empty">Escolha um período válido.</div>
      : tab === 'geral' ? <Geral d={data} r={range} />
      : tab === 'consultores' ? <Consultores d={data} r={range} pessoa={pessoa} setPessoa={setPessoa} />
      : tab === 'pre' ? <Pre d={data} r={range} pessoa={pessoa} />
      : tab === 'captacao' ? <Captacao d={data} r={range} pessoa={pessoa} />
      : tab === 'carteira' ? <Carteira d={data} r={range} pessoa={pessoa} />
      : tab === 'rescisoes' ? <Rescisoes d={data} r={range} pessoa={pessoa} />
      : <Okrs d={data} />}
  </main>
}

// ---------- Blocos visuais ----------
function Kpi({ icon, tone, label, value, help, delta }: { icon: ReactNode; tone: string; label: string; value: string; help?: string; delta?: { now: number; before: number; better?: 'up' | 'down' } }) {
  let d: ReactNode = null
  if (delta && delta.before > 0) {
    const v = Math.round(((delta.now - delta.before) / delta.before) * 100)
    const good = (delta.better ?? 'up') === 'up' ? v >= 0 : v <= 0
    d = <span className={'delta ' + (good ? 'up' : 'down')}>{v >= 0 ? '▲' : '▼'} {Math.abs(v)}% vs período anterior</span>
  }
  return <article className="card kpi">
    <div className="kpi-head"><span className={'kpi-icon t-' + tone} aria-hidden="true">{icon}</span><span className="kpi-label">{label}</span></div>
    <div className="kpi-value">{value}</div>
    {help && <div className="kpi-help">{help}</div>}
    {d}
  </article>
}
function Card({ title, note, children, className = '' }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return <section className={'card ' + className}><h3>{title}</h3>{note && <p className="note">{note}</p>}{children}</section>
}
function Bars({ items, max = 8, money }: { items: { name: string; n: number }[]; max?: number; money?: boolean }) {
  if (!items.length) return <div className="empty">Sem dados no período.</div>
  const top = items.slice(0, max); const hi = Math.max(...top.map(i => i.n), 1)
  return <div className="bars">{top.map(i => <div key={i.name} className="bars-row">
    <span className="bars-name" title={i.name}>{i.name}</span>
    <span className="bars-track"><span className="bars-fill" style={{ width: `${(100 * i.n) / hi}%` }} /></span>
    <span className="bars-n">{money ? BRL(i.n) : INT(i.n)}</span>
  </div>)}</div>
}
function Donut({ items }: { items: { name: string; n: number }[] }) {
  const data = items.slice(0, 7); const rest = items.slice(7).reduce((s, i) => s + i.n, 0)
  if (rest) data.push({ name: 'Outros', n: rest })
  if (!data.length) return <div className="empty">Sem dados no período.</div>
  return <ResponsiveContainer width="100%" height={240}><PieChart>
    <Pie data={data} dataKey="n" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2} isAnimationActive={false}>
      {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
    </Pie>
    <Tooltip formatter={v => INT(Number(v ?? 0))} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
  </PieChart></ResponsiveContainer>
}
function Trend({ data, series }: { data: Record<string, string | number>[]; series: [string, string, string][] }) {
  if (!data.length) return <div className="empty">Sem dados no período.</div>
  return <ResponsiveContainer width="100%" height={260}><AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="#E7E9EE" vertical={false} />
    <XAxis dataKey="semana" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
    <YAxis allowDecimals={false} width={40} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
    <Tooltip /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
    {series.map(([key, name, color]) => <Area key={key} type="linear" dataKey={key} name={name} stroke={color} fill={color} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />)}
  </AreaChart></ResponsiveContainer>
}
function Funnel({ steps }: { steps: [string, number][] }) {
  const top = Math.max(steps[0]?.[1] ?? 0, 1)
  return <div className="funnel">{steps.map(([name, n], i) => <div key={name} className="funnel-row">
    <span>{name}</span>
    <span><span className="funnel-bar" style={{ width: `${Math.max(4, (100 * n) / top)}%` }}>{INT(n)}</span></span>
    <span className="funnel-pct">{i === 0 ? '100%' : `${pct(n, steps[i - 1][1])}% da anterior`}</span>
  </div>)}</div>
}

// ---------- Abas ----------
function Geral({ d, r }: { d: Data; r: Range }) {
  const k = consultorKpis(d.consultores, r), kp = consultorKpis(d.consultores, prev(r))
  const p = preKpis(d.pre, r), c = captacaoKpis(d.angariadores, r), rs = rescisaoKpis(d.rescisoes, r)
  const trend = weekly(r, [
    ...d.pre.map(x => ({ day: x.dEntrada as number | null, key: 'pre' })),
    ...d.consultores.map(x => ({ day: x.dNovo as number | null, key: 'leads' })),
    ...d.consultores.filter(isLocado).map(x => ({ day: locacaoDay(x), key: 'locacoes' })),
  ])
  const ranking = uniq(d.consultores.map(x => x.consultor)).map(n => ({ name: n, ...consultorKpis(d.consultores.filter(x => x.consultor === n), r) })).filter(x => x.leads + x.locacoes > 0).sort((a, b) => b.locacoes - a.locacoes || b.leads - a.leads)
  return <>
    <div className="kpis">
      <Kpi icon={<Inbox size={17} />} tone="yellow" label="Leads no pré-atendimento" value={INT(p.recebidos)} help={`${p.taxaTransferencia}% transferidos aos consultores`} delta={{ now: p.recebidos, before: preKpis(d.pre, prev(r)).recebidos }} />
      <Kpi icon={<Users size={17} />} tone="blue" label="Leads com consultores" value={INT(k.leads)} delta={{ now: k.leads, before: kp.leads }} />
      <Kpi icon={<CalendarCheck size={17} />} tone="violet" label="Visitas" value={INT(k.visitas)} help="dos leads que entraram no período" delta={{ now: k.visitas, before: kp.visitas }} />
      <Kpi icon={<KeyRound size={17} />} tone="mint" label="Locações fechadas" value={INT(k.locacoes)} help={k.valorLocado ? BRL(k.valorLocado) + ' em valor' : undefined} delta={{ now: k.locacoes, before: kp.locacoes }} />
      <Kpi icon={<Home size={17} />} tone="yellow" label="Angariações" value={INT(c.angariacoes)} help={`${c.locados} imóveis captados locados`} />
      <Kpi icon={<FileSignature size={17} />} tone="rose" label="Rescisões em andamento" value={INT(rs.emAndamento)} help={`${rs.atrasadas} com prazo vencido`} />
    </div>
    <div className="grid">
      <Card className="span2" title="Entrada e locações por semana" note="Leads no pré-atendimento, leads com consultores e locações fechadas."><Trend data={trend} series={[['pre', 'Pré-atendimento', '#94A3B8'], ['leads', 'Consultores', '#3B82F6'], ['locacoes', 'Locações', '#F5C400']]} /></Card>
      <Card title="Origem dos leads (mídia)" note="Pré-atendimento no período."><Donut items={countBy(d.pre.filter(x => inRange(x.dEntrada, r)), x => x.midia as string)} /></Card>
      <Card className="full" title="Ranking de consultores" note="Leads que entraram no período e até onde chegaram; locações pela data de fechamento.">
        <ConsultorTable rows={ranking} />
      </Card>
    </div>
  </>
}

function ConsultorTable({ rows, selected, onPick }: { rows: (ReturnType<typeof consultorKpis> & { name: string })[]; selected?: string; onPick?: (n: string) => void }) {
  if (!rows.length) return <div className="empty">Sem dados no período.</div>
  return <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Consultor</th><th>Leads</th><th>Atendidos</th><th>Agend.</th><th>Visitas</th><th>Propostas</th><th>Locações</th><th>Conversão</th><th>Valor locado</th></tr></thead>
    <tbody>{rows.map(x => <tr key={x.name} className={(onPick ? 'clickable ' : '') + (selected === x.name ? 'is-on' : '')} onClick={onPick ? () => onPick(selected === x.name ? '' : x.name) : undefined}>
      <td>{x.name}</td><td>{INT(x.leads)}</td><td>{INT(x.atendimentos)}</td><td>{INT(x.agendamentos)}</td><td>{INT(x.visitas)}</td><td>{INT(x.propostas)}</td><td>{INT(x.locacoes)}</td><td>{x.conversao}%</td><td>{x.valorLocado ? BRL(x.valorLocado) : '—'}</td>
    </tr>)}</tbody></table></div>
}

function Consultores({ d, r, pessoa, setPessoa }: { d: Data; r: Range; pessoa: string; setPessoa: (p: string) => void }) {
  const rows = pessoa ? d.consultores.filter(x => x.consultor === pessoa) : d.consultores
  const k = consultorKpis(rows, r), kp = consultorKpis(rows, prev(r))
  const names = uniq(d.consultores.map(x => x.consultor))
  const team = consultorKpis(d.consultores, r)
  const ativos = names.filter(n => consultorKpis(d.consultores.filter(x => x.consultor === n), r).leads > 0).length
  const media = (v: number) => (ativos ? Math.round((v / ativos) * 10) / 10 : 0)
  const coorte = rows.filter(x => inRange(x.dNovo, r))
  const trend = weekly(r, [...rows.map(x => ({ day: x.dNovo as number | null, key: 'leads' })), ...rows.filter(x => reached(x, 'visita')).map(x => ({ day: (x.dVisita as number | null), key: 'visitas' })), ...rows.filter(isLocado).map(x => ({ day: locacaoDay(x), key: 'locacoes' }))])
  return <>
    <div className="kpis">
      <Kpi icon={<Inbox size={17} />} tone="blue" label="Leads recebidos" value={INT(k.leads)} help={pessoa ? `média da equipe: ${media(team.leads)}` : undefined} delta={{ now: k.leads, before: kp.leads }} />
      <Kpi icon={<UserCheck size={17} />} tone="violet" label="Atendidos" value={INT(k.atendimentos)} help={`${pct(k.atendimentos, k.leads)}% dos leads`} />
      <Kpi icon={<CalendarCheck size={17} />} tone="yellow" label="Visitas" value={INT(k.visitas)} help={pessoa ? `média da equipe: ${media(team.visitas)}` : `${pct(k.visitas, k.leads)}% dos leads`} delta={{ now: k.visitas, before: kp.visitas }} />
      <Kpi icon={<KeyRound size={17} />} tone="mint" label="Locações" value={INT(k.locacoes)} help={pessoa ? `média da equipe: ${media(team.locacoes)}` : undefined} delta={{ now: k.locacoes, before: kp.locacoes }} />
      <Kpi icon={<BadgeCheck size={17} />} tone="mint" label="Conversão (locações ÷ leads)" value={`${k.conversao}%`} help={pessoa ? `equipe: ${team.conversao}%` : undefined} />
      <Kpi icon={<Wallet size={17} />} tone="yellow" label="Valor locado" value={k.valorLocado ? BRL(k.valorLocado) : '—'} help="soma do valor dos imóveis locados" />
    </div>
    <div className="grid">
      <Card title="Funil do período" note="Leads que entraram no período e até onde chegaram.">
        <Funnel steps={[['Leads', k.leads], ['Atendimento', k.atendimentos], ['Agendamento', k.agendamentos], ['Visita', k.visitas], ['Proposta', k.propostas], ['Reserva', k.reservas], ['Locado', coorte.filter(isLocado).length]]} />
      </Card>
      <Card className="span2" title="Evolução semanal" note="Leads recebidos, visitas e locações fechadas."><Trend data={trend} series={[['leads', 'Leads', '#3B82F6'], ['visitas', 'Visitas', '#A78BFA'], ['locacoes', 'Locações', '#F5C400']]} /></Card>
      <Card title="Origem dos leads (mídia)"><Donut items={countBy(coorte, x => x.midia as string)} /></Card>
      <Card title="Situação dos leads" note="Campo de situação/anotações do quadro do consultor."><Bars items={countBy(coorte.filter(x => x.situacao), x => x.situacao as string)} /></Card>
      <Card title="Etapa atual dos leads"><Bars items={countBy(coorte, x => x.etapa as string)} /></Card>
      <Card className="full" title="Comparativo da equipe" note="Clique num consultor para abrir a visão one-on-one dele.">
        <ConsultorTable rows={names.map(n => ({ name: n, ...consultorKpis(d.consultores.filter(x => x.consultor === n), r) })).filter(x => x.leads + x.locacoes > 0 || x.name === pessoa)} selected={pessoa} onPick={setPessoa} />
      </Card>
    </div>
  </>
}

function Pre({ d, r, pessoa }: { d: Data; r: Range; pessoa: string }) {
  const rows = pessoa ? d.pre.filter(x => x.sdr === pessoa) : d.pre
  const k = preKpis(rows, r), kp = preKpis(rows, prev(r)); const c = rows.filter(x => inRange(x.dEntrada, r))
  const trend = weekly(r, [...rows.map(x => ({ day: x.dEntrada as number | null, key: 'recebidos' })), ...rows.filter(preTransferido).map(x => ({ day: (x.dTransferido ?? x.dEntrada) as number | null, key: 'transferidos' }))])
  const sdrs = uniq(d.pre.map(x => x.sdr)).map(n => ({ name: n, ...preKpis(d.pre.filter(x => x.sdr === n), r) })).filter(x => x.recebidos > 0).sort((a, b) => b.recebidos - a.recebidos)
  return <>
    <div className="kpis">
      <Kpi icon={<Inbox size={17} />} tone="yellow" label="Leads recebidos" value={INT(k.recebidos)} delta={{ now: k.recebidos, before: kp.recebidos }} />
      <Kpi icon={<Send size={17} />} tone="mint" label="Transferidos a consultores" value={INT(k.transferidos)} help={`${k.taxaTransferencia}% dos recebidos`} delta={{ now: k.transferidos, before: kp.transferidos }} />
      <Kpi icon={<TrendingDown size={17} />} tone="rose" label="Descartados" value={INT(k.descartados)} help={`${pct(k.descartados, k.recebidos)}% dos recebidos`} />
      <Kpi icon={<Clock size={17} />} tone="blue" label="Tempo até 1ª mensagem" value={k.tempoMedio1aMsg == null ? '—' : `${k.tempoMedio1aMsg} min`} help={k.tempoMedio1aMsg == null ? 'campo ainda não preenchido no Monday' : 'média'} />
    </div>
    <div className="grid">
      <Card className="span2" title="Recebidos × transferidos por semana"><Trend data={trend} series={[['recebidos', 'Recebidos', '#94A3B8'], ['transferidos', 'Transferidos', '#22C55E']]} /></Card>
      <Card title="Origem (mídia)"><Donut items={countBy(c, x => x.midia as string)} /></Card>
      <Card title="Para qual consultor foram"><Bars items={countBy(c.filter(x => x.consultor), x => x.consultor as string)} /></Card>
      <Card title="Etapa atual"><Bars items={countBy(c, x => x.etapa as string)} /></Card>
      <Card title="Cadência do pré-atendimento"><Bars items={countBy(c, x => x.cadencia as string)} /></Card>
      <Card className="full" title="Por pessoa do pré-atendimento (MQL)">{sdrs.length ? <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Pessoa</th><th>Recebidos</th><th>Transferidos</th><th>Taxa</th><th>Descartados</th></tr></thead><tbody>
        {sdrs.map(x => <tr key={x.name}><td>{x.name}</td><td>{INT(x.recebidos)}</td><td>{INT(x.transferidos)}</td><td>{x.taxaTransferencia}%</td><td>{INT(x.descartados)}</td></tr>)}
      </tbody></table></div> : <div className="empty">Sem dados no período.</div>}</Card>
    </div>
  </>
}

function Captacao({ d, r, pessoa }: { d: Data; r: Range; pessoa: string }) {
  const rows = pessoa ? d.angariadores.filter(x => x.pessoa === pessoa) : d.angariadores
  const k = captacaoKpis(rows, r), kp = captacaoKpis(rows, prev(r)); const c = rows.filter(x => inRange(x.dCriado, r))
  const pros = d.prospeccao.filter(x => inRange(x.dEncontrado, r))
  const ranking = uniq(d.angariadores.map(x => x.pessoa)).map(n => ({ name: n, ...captacaoKpis(d.angariadores.filter(x => x.pessoa === n), r) })).filter(x => x.registros > 0).sort((a, b) => b.angariacoes - a.angariacoes)
  return <>
    <div className="kpis">
      <Kpi icon={<Home size={17} />} tone="yellow" label="Angariações" value={INT(k.angariacoes)} delta={{ now: k.angariacoes, before: kp.angariacoes }} />
      <Kpi icon={<Users size={17} />} tone="blue" label="Prospecções" value={INT(k.prospeccoes)} />
      <Kpi icon={<KeyRound size={17} />} tone="mint" label="Imóveis captados locados" value={INT(k.locados)} help={k.valorLocado ? BRL(k.valorLocado) : undefined} />
      <Kpi icon={<TrendingDown size={17} />} tone="rose" label="Imóveis perdidos" value={INT(k.perdidos)} delta={{ now: k.perdidos, before: kp.perdidos, better: 'down' }} />
    </div>
    <div className="grid">
      <Card title="Status dos imóveis"><Bars items={countBy(c, x => x.status as string)} /></Card>
      <Card title="Forma de captação"><Bars items={countBy(c.filter(x => x.forma), x => x.forma as string)} /></Card>
      <Card title="Motivo de perda (churn)"><Bars items={countBy(c.filter(x => x.churn), x => x.churn as string)} /></Card>
      <Card className="full" title="Por angariador">{ranking.length ? <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Pessoa</th><th>Registros</th><th>Angariações</th><th>Prospecções</th><th>Locados</th><th>Perdidos</th><th>Valor locado</th></tr></thead><tbody>
        {ranking.map(x => <tr key={x.name}><td>{x.name}</td><td>{INT(x.registros)}</td><td>{INT(x.angariacoes)}</td><td>{INT(x.prospeccoes)}</td><td>{INT(x.locados)}</td><td>{INT(x.perdidos)}</td><td>{x.valorLocado ? BRL(x.valorLocado) : '—'}</td></tr>)}
      </tbody></table></div> : <div className="empty">Sem dados no período.</div>}</Card>
      <Card title="Prospecção ativa — funil" note="Quadro de captação (encontrados no período)."><Bars items={countBy(pros, x => x.funil as string)} /></Card>
      <Card title="Prospecção — por captadora"><Bars items={countBy(pros, x => x.captadora as string)} /></Card>
      <Card title="Prospecção — etapa"><Bars items={countBy(pros, x => x.etapa as string)} /></Card>
    </div>
  </>
}

function Carteira({ d, r, pessoa }: { d: Data; r: Range; pessoa: string }) {
  const rows = pessoa ? d.carteira.filter(x => x.pessoa === pessoa) : d.carteira
  const k = carteiraKpis(rows, r); const c = rows.filter(x => inRange(x.dCriado, r) || inRange(x.dSaida, r))
  const trend = weekly(r, [...rows.map(x => ({ day: x.dSaida as number | null, key: 'saidas' })), ...rows.map(x => ({ day: x.dCriado as number | null, key: 'novos' }))])
  return <>
    <div className="kpis">
      <Kpi icon={<Users size={17} />} tone="blue" label="Proprietários acompanhados" value={INT(k.acompanhados)} />
      <Kpi icon={<KeyRound size={17} />} tone="mint" label="Imóveis relocados" value={INT(k.locados)} />
      <Kpi icon={<Home size={17} />} tone="yellow" label="Disponíveis" value={INT(k.disponiveis)} />
      <Kpi icon={<TrendingDown size={17} />} tone="rose" label="Perdidos (churn)" value={INT(k.perdidos)} help={`${pct(k.perdidos, k.acompanhados)}% dos acompanhados`} />
    </div>
    <div className="grid">
      <Card className="span2" title="Saídas de inquilinos × novos acompanhamentos"><Trend data={trend} series={[['saidas', 'Saídas', '#FB7185'], ['novos', 'Novos acompanhamentos', '#3B82F6']]} /></Card>
      <Card title="Status"><Donut items={countBy(c, x => x.status as string)} /></Card>
      <Card title="Estágio"><Bars items={countBy(c, x => x.estagio as string)} /></Card>
      <Card title="Motivo de perda (churn)"><Bars items={countBy(c.filter(x => x.churn), x => x.churn as string)} /></Card>
      <Card title="Tipo"><Bars items={countBy(c, x => x.tipo as string)} /></Card>
    </div>
  </>
}

function Rescisoes({ d, r, pessoa }: { d: Data; r: Range; pessoa: string }) {
  const rows = pessoa ? d.rescisoes.filter(x => x.pessoa === pessoa) : d.rescisoes
  const k = rescisaoKpis(rows, r); const abertas = rows.filter(x => !rescisaoFinalizada(x) && !/DESISTIU/.test(up(x.estagio)))
  const trend = weekly(r, [...rows.map(x => ({ day: x.dCriado as number | null, key: 'novas' })), ...rows.map(x => ({ day: x.dSaida as number | null, key: 'saidas' }))])
  const today = todayDay()
  const porPessoa = uniq(d.rescisoes.map(x => x.pessoa)).map(n => { const rs = d.rescisoes.filter(x => x.pessoa === n); return { name: n, ...rescisaoKpis(rs, r, today) } }).filter(x => x.emAndamento + x.novas + x.finalizadasNoPeriodo > 0).sort((a, b) => b.emAndamento - a.emAndamento)
  return <>
    <div className="kpis">
      <Kpi icon={<FileSignature size={17} />} tone="violet" label="Novas rescisões" value={INT(k.novas)} />
      <Kpi icon={<BadgeCheck size={17} />} tone="mint" label="Finalizadas no período" value={INT(k.finalizadasNoPeriodo)} />
      <Kpi icon={<Clock size={17} />} tone="blue" label="Em andamento (hoje)" value={INT(k.emAndamento)} />
      <Kpi icon={<TrendingDown size={17} />} tone="rose" label="Com prazo vencido" value={INT(k.atrasadas)} help={`${pct(k.atrasadas, k.emAndamento)}% das em andamento`} />
    </div>
    <div className="grid">
      <Card className="span2" title="Entradas e saídas por semana"><Trend data={trend} series={[['novas', 'Novas rescisões', '#A78BFA'], ['saidas', 'Saídas de imóveis', '#FB7185']]} /></Card>
      <Card title="Em andamento por estágio" note="Situação atual (hoje)."><Bars items={countBy(abertas, x => x.estagio as string)} /></Card>
      <Card title="Prioridade (em andamento)"><Bars items={countBy(abertas, x => x.prioridade as string)} /></Card>
      <Card title="Estágio financeiro (em andamento)"><Bars items={countBy(abertas, x => x.estagio2 as string)} /></Card>
      <Card title="Garantia (em andamento)"><Bars items={countBy(abertas.filter(x => x.garantia), x => x.garantia as string)} /></Card>
      <Card className="full" title="Por responsável">{porPessoa.length ? <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Pessoa</th><th>Em andamento</th><th>Prazo vencido</th><th>Novas no período</th><th>Finalizadas no período</th></tr></thead><tbody>
        {porPessoa.map(x => <tr key={x.name}><td>{x.name}</td><td>{INT(x.emAndamento)}</td><td>{INT(x.atrasadas)}</td><td>{INT(x.novas)}</td><td>{INT(x.finalizadasNoPeriodo)}</td></tr>)}
      </tbody></table></div> : <div className="empty">Sem dados no período.</div>}</Card>
    </div>
  </>
}

function Okrs({ d }: { d: Data }) {
  const today = todayDay()
  const objs = okrObjectives(d.okrs, today)
  const [area, setArea] = useState('')
  const areas = uniq(objs.map(o => o.area))
  const shown = area ? objs.filter(o => o.area === area) : objs
  const acoes = shown.flatMap(o => o.acoes)
  const feitas = acoes.filter(okrDone).length
  const atrasadas = acoes.filter(a => !okrDone(a) && typeof a.dFim === 'number' && (a.dFim as number) < today).length
  const ultima = Math.max(...d.okrs.map(a => (a.dFim as number) ?? 0), 0)
  if (!objs.length) return <div className="empty">Nenhum OKR encontrado nos quadros do Monday.</div>
  return <>
    <div className="bar"><label className="field">Área<select value={area} onChange={e => setArea(e.target.value)}><option value="">Todas</option>{areas.map(a => <option key={a} value={a}>{a}</option>)}</select></label></div>
    <div className="kpis">
      <Kpi icon={<Target size={17} />} tone="violet" label="Objetivos" value={INT(shown.length)} />
      <Kpi icon={<BadgeCheck size={17} />} tone="mint" label="Ações concluídas" value={`${INT(feitas)} de ${INT(acoes.length)}`} help={`${pct(feitas, acoes.length)}%`} />
      <Kpi icon={<Clock size={17} />} tone="rose" label="Ações com prazo vencido" value={INT(atrasadas)} />
    </div>
    {ultima > 0 && ultima < today - 60 && <p className="note" style={{ margin: '0 0 16px' }}>Atenção: os quadros de OKR do Monday não têm ações com prazo depois de {fmtDay(ultima)}. Para acompanhar o ciclo atual, atualize-os no Monday.</p>}
    <div className="grid">
      {shown.map(o => <Card key={o.area + o.objetivo} className="full" title={o.objetivo} note={`${o.area} · ${o.total} ação(ões)${o.inicio != null ? ` · ${fmtDay(o.inicio)} a ${fmtDay(o.fim)}` : ''}`}>
        <div className="progress" aria-label={`Progresso ${o.progresso}%`} style={{ marginBottom: 10 }}><span style={{ width: `${Math.min(100, o.progresso)}%`, background: o.atrasadas ? '#FB7185' : '#22C55E' }} /></div>
        <div className="kpi-help" style={{ marginBottom: 10 }}>{o.progresso}% concluído · {o.feitas} feita(s) · {o.andamento} em andamento · {o.paradas} parada(s){o.atrasadas ? ` · ${o.atrasadas} com prazo vencido` : ''}</div>
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Ação</th><th>Responsável</th><th>Prioridade</th><th>Status</th><th>Prazo</th></tr></thead><tbody>
          {o.acoes.map((a, i) => { const late = !okrDone(a) && typeof a.dFim === 'number' && (a.dFim as number) < today
            return <tr key={i}><td style={{ fontWeight: 500 }}>{a.acao}</td><td>{a.responsavel || '—'}</td><td>{a.prioridade || '—'}</td>
              <td><span className={'pill ' + (okrDone(a) ? 't-mint' : late ? 't-rose' : /PARADO/i.test(String(a.status)) ? 't-yellow' : 't-blue')}>{a.status || (late ? 'Atrasada' : 'Sem status')}</span></td>
              <td>{a.dFim != null ? fmtDay(a.dFim as number) : '—'}</td></tr> })}
        </tbody></table></div>
      </Card>)}
    </div>
  </>
}