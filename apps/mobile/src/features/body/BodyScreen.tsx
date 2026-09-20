import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { addLocalDays, localDateAtStart, type BodyMeasurement, type BodyMetricValues,
  type BodyTrendPoint, type HealthDailySummary } from '@motion/domain'
import { AppIcon } from '../../components/AppIcon'
import { logger } from '../../app/logger'
import { openBodyService, type BodyOverview, type BodyService, type OcrDraft } from './bodyService'
import type { HealthRecordType } from '../../platform/body/bodyNative'
import { openAiService } from '../ai/aiRuntime'
import './body.css'

type BodyView = 'home' | 'entry' | 'trends' | 'history' | 'import' | 'health' | 'summary'
function display(value: number | undefined, fraction = 1) { return value === undefined ? '—' : value.toFixed(fraction) }
function toLocalDateTime(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}
function fromFields(fields: Record<string, string>, includeBlanks = false): Partial<BodyMetricValues> {
  const result: Partial<BodyMetricValues> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!value.trim()) { if (includeBlanks) result[key as keyof BodyMetricValues] = null; continue }
    const number = Number(value); if (!Number.isFinite(number) || number < 0) throw new Error('请输入有效数值')
    result[key as keyof BodyMetricValues] = number
  }
  return result
}
const metricInputs = [
  ['weightKg', '体重', 'kg', true], ['bodyFatPercent', '体脂率', '%', false],
  ['muscleMassKg', '肌肉量', 'kg', false], ['bodyWaterPercent', '体水分', '%', false],
  ['visceralFatLevel', '内脏脂肪等级', '', false], ['boneMassKg', '骨量', 'kg', false],
  ['bmi', 'BMI', '', false], ['fatMassKg', '脂肪量', 'kg', false],
  ['skeletalMuscle', '骨骼肌', '%', false], ['bmrKcal', '基础代谢', 'kcal', false],
  ['bodyAge', '身体年龄', '岁', false],
] as const

function TrendChart({ points }: { points: BodyTrendPoint[] }) {
  if (points.length < 2) return <div className="body-chart body-chart--empty">记录两次后显示趋势</div>
  const values = points.map((point) => point.value), min = Math.min(...values), max = Math.max(...values)
  const span = max - min || 1
  const line = points.map((point, index) => `${8 + index * (84 / (points.length - 1))},${84 - ((point.value - min) / span) * 62}`).join(' ')
  return <svg className="body-chart" viewBox="0 0 100 100" role="img" aria-label="真实记录趋势">
    <path d="M6 84H94M6 53H94M6 22H94" className="body-chart__grid" />
    <polyline points={line} className="body-chart__line" />
    {points.map((point, index) => <circle key={point.measurementId} cx={8 + index * (84 / (points.length - 1))}
      cy={84 - ((point.value - min) / span) * 62} r="1.8" />)}
  </svg>
}

function Header({ title, back }: { title: string; back?: () => void }) {
  return <header className="body-page-header">{back ? <button type="button" onClick={back} aria-label="返回">‹</button> : null}
    <h1>{title}</h1><span aria-hidden="true" /></header>
}

export function BodyScreen({ view = 'home', suppliedService }: { view?: BodyView; suppliedService?: BodyService }) {
  const navigate = useNavigate(), [service, setService] = useState<BodyService | null>(suppliedService ?? null)
  const [overview, setOverview] = useState<BodyOverview | null>(null), [error, setError] = useState('')
  const load = useCallback(async (current: BodyService) => { if (view === 'home' || view === 'history') setOverview(await current.overview()) }, [view])
  useEffect(() => { let active = true; void (async () => { try { const current = suppliedService ?? await openBodyService()
    if (!active) return; setService(current); await load(current) } catch (cause) { logger.error('Body screen failed', cause); if (active) setError('身体数据暂时无法打开') } })()
    return () => { active = false } }, [suppliedService, load])
  const back = () => navigate('/body')
  if (view === 'entry') return <BodyEntry service={service} onBack={back} />
  if (view === 'trends') return <BodyTrends service={service} onBack={back} />
  if (view === 'history') return <BodyHistory service={service} overview={overview} onBack={back} onRefresh={() => service && load(service)} />
  if (view === 'import') return <BodyImport service={service} onBack={back} />
  if (view === 'health') return <HealthSetup service={service} onBack={back} />
  if (view === 'summary') return <HealthSummary service={service} onBack={back} />

  const weight = overview?.snapshot.weightKg?.value, fat = overview?.snapshot.bodyFatPercent?.value
  const weightChange = overview && overview.weightTrend.length > 1
    ? overview.weightTrend.at(-1)!.value - overview.weightTrend[0]!.value : null
  return <div className="body-screen">
    <header className="body-hero"><h1>身体数据</h1><span className="body-hero__sun" aria-hidden="true" /></header>
    <nav className="body-tabs" aria-label="身体数据视图"><button aria-current="page" onClick={() => navigate('/body')}>概览</button>
      <button onClick={() => navigate('/body/trends')}>趋势</button><button onClick={() => navigate('/body/history')}>历史</button></nav>
    {error ? <p role="alert" className="body-error">{error}</p> : null}
    <section className="body-primary" aria-label="体重概览"><div className="body-primary__measure"><span>当前体重</span>
      <strong>{display(weight)} <small>kg</small></strong>
      <p>{weightChange === null ? '暂无趋势' : `近 30 天 ${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)} kg`}</p></div>
      <TrendChart points={overview?.weightTrend ?? []} /></section>
    <section className="body-secondary" aria-label="体脂率"><div><span>体脂率</span><strong>{display(fat)} <small>%</small></strong></div>
      <span className="body-secondary__leaves" aria-hidden="true" /></section>
    <button className="body-summary-link" type="button" onClick={() => navigate('/body/summary')}>
      <span>健康摘要 · 昨天</span><SummaryLines summary={overview?.yesterdaySummary ?? null} /><AppIcon name="arrow" /></button>
    <section className="body-actions" aria-label="身体数据操作"><div className="body-tools">
      <button onClick={() => navigate('/body/import')}><span aria-hidden="true">▧</span><span>导入薄荷截图</span><AppIcon name="arrow" /></button>
      <button onClick={() => navigate('/body/health')}><span aria-hidden="true">◉</span><span>连接 Health Connect</span><AppIcon name="arrow" /></button></div>
      <button className="body-primary-action" type="button" onClick={() => navigate('/body/entry')}>＋ 记录身体数据</button></section>
  </div>
}

function SummaryLines({ summary }: { summary: HealthDailySummary | null }) {
  if (!summary) return <small>暂无可用数据</small>
  return <small>{[summary.steps === null ? null : `${summary.steps.toLocaleString()} 步`,
    summary.sleepMinutes === null ? null : `${Math.floor(summary.sleepMinutes / 60)}小时${summary.sleepMinutes % 60}分钟 睡眠`,
    summary.restingHeartRate === null ? null : `${Math.round(summary.restingHeartRate)} bpm 静息心率`]
    .filter(Boolean).join(' · ') || '暂无可用数据'}</small>
}

function BodyEntry({ service, onBack }: { service: BodyService | null; onBack: () => void }) {
  const [at, setAt] = useState(toLocalDateTime(new Date())), [fields, setFields] = useState<Record<string, string>>({})
  const [more, setMore] = useState(false), [error, setError] = useState('')
  async function submit(event: FormEvent) { event.preventDefault(); if (!service) return
    try { const values = fromFields(fields); if (values.weightKg === undefined) throw new Error('请填写体重')
      const measured = new Date(at); await service.saveManual({ ...values, measuredAt: measured.toISOString(), localDate: localDateAtStart(measured) }); onBack()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败') } }
  return <main className="body-detail body-entry"><Header title="记录身体数据" back={onBack} /><form className="body-form" onSubmit={(event) => void submit(event)}>
    <label className="body-form__date">日期与时间<input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} /></label>
    <section className="body-form__core" aria-label="核心指标">{metricInputs.slice(0, 4).map(([key, label, unit, required]) => <label key={key}>{label}{required ? ' *' : '（可选）'}
      <span><input type="number" step="any" min="0" value={fields[key] ?? ''} onChange={(event) => setFields({ ...fields, [key]: event.target.value })}/><em>{unit}</em></span></label>)}</section>
    {!more ? <button className="body-more" type="button" onClick={() => setMore(true)}>更多指标 ›</button> : null}
    {more ? <section className="body-form__advanced" aria-label="更多指标"><h2>更多指标</h2>
      {metricInputs.slice(4).map(([key, label, unit]) => <label key={key}>{label}（可选）
        <span><input type="number" step="any" min="0" value={fields[key] ?? ''} onChange={(event) => setFields({ ...fields, [key]: event.target.value })}/><em>{unit}</em></span></label>)}</section> : null}
    <p className="body-note">只需记录你有的数据。体重是唯一必填项。</p>{error ? <p role="alert">{error}</p> : null}
    <button className="body-primary-action" type="submit">保存记录</button></form></main>
}

function BodyTrends({ service, onBack }: { service: BodyService | null; onBack: () => void }) {
  const [metric, setMetric] = useState<'weightKg' | 'bodyFatPercent'>('weightKg'), [range, setRange] = useState<'30D'|'3M'|'1Y'>('30D')
  const [points, setPoints] = useState<BodyTrendPoint[]>([])
  useEffect(() => { if (service) void service.trends(metric, range).then(setPoints) }, [service, metric, range])
  const change = points.length > 1 ? points.at(-1)!.value - points[0]!.value : null
  return <main className="body-detail"><Header title="体重趋势" back={onBack} />
    <div className="body-segment"><button aria-pressed={metric === 'weightKg'} onClick={() => setMetric('weightKg')}>体重</button>
      <button aria-pressed={metric === 'bodyFatPercent'} onClick={() => setMetric('bodyFatPercent')}>体脂率</button><button disabled>其他指标</button></div>
    <div className="body-range">{(['30D','3M','1Y'] as const).map((item) => <button key={item} aria-pressed={range===item} onClick={() => setRange(item)}>{item==='30D'?'30天':item==='3M'?'3个月':'1年'}</button>)}</div>
    <section className="body-trend-detail"><strong>{points.length ? points.at(-1)!.value.toFixed(1) : '—'} <small>{metric === 'weightKg' ? 'kg' : '%'}</small></strong>
      <p>{change === null ? '暂无变化数据' : `本区间 ${change > 0 ? '+' : ''}${change.toFixed(1)} ${metric === 'weightKg' ? 'kg' : '%'}`}</p><TrendChart points={points} /></section>
    <section className="body-facts"><h2>数据摘要</h2><p>记录天数 <strong>{points.length} 天</strong></p>
      <p>最高值 <strong>{points.length ? Math.max(...points.map((p) => p.value)).toFixed(1) : '—'}</strong></p>
      <p>最低值 <strong>{points.length ? Math.min(...points.map((p) => p.value)).toFixed(1) : '—'}</strong></p></section></main>
}

function BodyHistory({ service, overview, onBack, onRefresh }: { service: BodyService | null; overview: BodyOverview | null; onBack: () => void; onRefresh: () => void }) {
  const [editing,setEditing]=useState<string|null>(null),[editFields,setEditFields]=useState<Record<string,string>>({})
  async function remove(record: BodyMeasurement) { if (!service) return; await service.delete(record.id); onRefresh() }
  async function save(record: BodyMeasurement) { if (!service) return; await service.edit(record.id,{measuredAt:record.measuredAt,
    localDate:record.localDate,...fromFields(editFields,true)}); setEditing(null); onRefresh() }
  return <main className="body-detail"><Header title="历史记录" back={onBack} /><ul className="body-history">
    {(overview?.records ?? []).map((record) => <li key={record.id}><div><strong>{record.localDate}</strong><small>{record.sourceType === 'MANUAL'?'手动记录':record.sourceType === 'SCREENSHOT_OCR'?'截图导入':record.sourceType === 'HEALTH_CONNECT'?`Health Connect${record.sourceApp ? ` · ${record.sourceApp}` : ''}`:'薄荷'}</small></div>
      {editing===record.id?<div className="body-history__edit">{metricInputs.map(([key,label,unit])=><label key={key}>{label}<span><input aria-label={label} type="number" step="any" value={editFields[key]??''} onChange={e=>setEditFields({...editFields,[key]:e.target.value})}/>{unit}</span></label>)}<button onClick={()=>void save(record)}>保存</button></div>:<p>{record.weightKg !== null ? `${record.weightKg} kg` : ''}{record.bodyFatPercent !== null ? ` · 体脂率 ${record.bodyFatPercent}%` : ''}</p>}
      {['MANUAL','SCREENSHOT_OCR'].includes(record.sourceType) ? <div className="body-history__actions"><button onClick={() => {setEditing(record.id);setEditFields(Object.fromEntries(metricInputs.map(([key])=>[key,record[key]?.toString()??''])))}}>编辑</button><button onClick={() => void remove(record)}>删除</button></div> : null}</li>)}
    {!overview?.records.length ? <li>暂无身体记录</li> : null}</ul></main>
}

function BodyImport({ service, onBack }: { service: BodyService | null; onBack: () => void }) {
  const [draft, setDraft] = useState<OcrDraft | null>(null), [fields, setFields] = useState<Record<string,string>>({}), [error, setError] = useState('')
  const hasParsedFields = Object.values(fields).some((value) => value.trim() !== '')
  async function choose() { if (!service) return; setError(''); try { const next = await service.recognizeScreenshot(); setDraft(next)
    const nextFields = Object.fromEntries(Object.entries(next.values).map(([key,value]) => [key, String(value)])); setFields(nextFields)
    if (!Object.keys(nextFields).length) setError('没有识别到可保存的身体数据，你可以重新选择截图或手动记录。')
  } catch { setError('没有识别到可保存的身体数据，你可以重新选择截图或手动记录。') } }
  async function confirm() { if (!service || !draft) return
    if (!hasParsedFields) { setError('没有识别到可保存的身体数据，你可以重新选择截图或手动记录。'); return }
    try { const values = fromFields(fields), now = new Date()
    await service.confirmScreenshot(draft, { ...values, measuredAt: now.toISOString(), localDate: localDateAtStart(now), confidenceLevel: 'MEDIUM' }); onBack() }
    catch (cause) { setError(cause instanceof Error && cause.message !== 'At least one body metric is required' ? cause.message
      : '没有识别到可保存的身体数据，你可以重新选择截图或手动记录。') } }
  async function assistWithAi() { if (!draft) return; setError('')
    try { const values = await (await openAiService()).screenshotAssist(draft.rawText)
      const next = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null)
        .map(([key, value]) => [key, String(value)])); setFields(next)
      if (!Object.keys(next).length) setError('AI 也没有识别到可保存的身体数据，你可以重新选择截图或手动记录。')
    } catch { setError('AI 辅助识别暂时无法使用，你可以重新选择截图或手动记录。') } }
  return <main className="body-detail"><Header title="导入薄荷截图" back={onBack} />
    {!draft ? <section className="body-import-empty"><span aria-hidden="true">▧</span><p>选择截图后，将在设备上识别数据。</p>
      <button className="body-primary-action" onClick={() => void choose()}>选择薄荷截图</button></section> : <>
      <section className="body-ocr-preview"><h2>识别结果（可编辑）</h2>{metricInputs.map(([key,label,unit]) => fields[key] === undefined ? null : <label key={key}>{label}<span><input type="number" step="any" value={fields[key]} onChange={(event) => setFields({...fields,[key]:event.target.value})}/><em>{unit}</em></span></label>)}</section>
      {!hasParsedFields ? <button className="body-link" onClick={() => void assistWithAi()}>使用 AI 辅助识别</button> : null}
      <button className="body-primary-action" disabled={!hasParsedFields} onClick={() => void confirm()}>确认并保存</button><button className="body-link" onClick={() => void choose()}>重新选择截图</button></>}
    {error ? <p role="alert" className="body-error">{error}</p> : null}</main>
}

const permissionGroups: Array<{ title: string; items: Array<[HealthRecordType,string]> }> = [
  { title: '身体数据', items: [['Weight','体重'],['BodyFat','体脂率']] },
  { title: '活动数据', items: [['Steps','步数'],['ExerciseSession','运动记录'],['ActiveCaloriesBurned','活动消耗热量']] },
  { title: '恢复数据', items: [['SleepSession','睡眠'],['RestingHeartRate','静息心率'],['HeartRate','心率']] },
]
function HealthSetup({ service, onBack }: { service: BodyService | null; onBack: () => void }) {
  const [selected,setSelected] = useState<Set<HealthRecordType>>(new Set(['Weight','BodyFat','Steps','SleepSession']))
  const [state,setState] = useState('正在检查 Health Connect…')
  useEffect(() => { if (service) void service.availability().then(({status}) => setState(status === 'AVAILABLE' ? '可连接' : status === 'PROVIDER_UPDATE_REQUIRED' ? '需要安装或更新 Health Connect' : '此设备暂不可用')) }, [service])
  async function connect() { if (!service) return; const granted = await service.requestPermissions([...selected]); setState(`已授权 ${granted.recordTypes.length} 项`); await service.sync() }
  return <main className="body-detail health-setup"><Header title="Health Connect" back={onBack} /><div className="health-mark" aria-hidden="true">◉</div>
    <h2>连接 Health Connect</h2><p className="body-note">读取你选择的数据，用于身体趋势和每日健康摘要。数据保存在 Motion 本地；拒绝授权不影响手动记录。</p>
    {permissionGroups.map((group) => <fieldset key={group.title}><legend>{group.title}</legend>{group.items.map(([type,label]) => <label key={type}><input type="checkbox" checked={selected.has(type)} onChange={(event) => { const next=new Set(selected); if (event.target.checked) next.add(type); else next.delete(type); setSelected(next)}}/>{label}</label>)}</fieldset>)}
    <p className="health-state">{state}</p><button className="body-primary-action" onClick={() => void connect()}>继续并授权</button></main>
}

function HealthSummary({ service, onBack }: { service: BodyService | null; onBack: () => void }) {
  const [date,setDate] = useState(localDateAtStart(new Date())), [summary,setSummary] = useState<HealthDailySummary|null>(null)
  useEffect(() => { if(service) void service.summary(date).then(setSummary) }, [service,date])
  const rows = useMemo(() => [['步数',summary?.steps,'步'],['活动消耗',summary?.activeCaloriesKcal,'kcal'],['运动时长',summary?.exerciseMinutes,'分钟'],['睡眠时长',summary?.sleepMinutes,'分钟'],['静息心率',summary?.restingHeartRate,'bpm'],['心率（每日平均）',summary?.averageHeartRate,'bpm']] as const,[summary])
  return <main className="body-detail"><Header title="健康摘要" back={onBack}/><div className="summary-date"><button onClick={()=>setDate(addLocalDays(date,-1))}>‹</button><time>{date}</time><button disabled={date>=localDateAtStart(new Date())} onClick={()=>setDate(addLocalDays(date,1))}>›</button></div>
    <ul className="health-summary">{rows.map(([label,value,unit])=><li key={label}><span>{label}</span><strong>{value === null || value === undefined ? '暂无数据' : `${Math.round(value)} ${unit}`}</strong></li>)}</ul>
    <p className="body-note">这些数据来自 Health Connect。不同来源的更新时间可能不同。</p></main>
}
