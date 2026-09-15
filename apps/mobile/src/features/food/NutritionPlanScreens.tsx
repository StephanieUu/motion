import { useEffect, useState } from 'react'
import type { NutritionBaseStrategy, NutritionPlanConfig } from '@motion/domain'
import { useNavigate } from 'react-router-dom'
import { AppIcon } from '../../components/AppIcon'
import { logger } from '../../app/logger'
import { openNutritionService, type NutritionService } from './nutritionService'
import { configFromRun, strategyLabels, treWindow, weekdayLabels } from './nutritionPlanPresentation'
import './nutritionPlans.css'

const defaultConfig: NutritionPlanConfig = { baseStrategy: 'STABLE_FAT_LOSS', highProtein: false,
  treEnabled: false, treStartLocalTime: null, treWindowMinutes: null, flexibleWeekday: null }
const strategies: { value: NutritionBaseStrategy; detail: string }[] = [
  { value: 'STABLE_FAT_LOSS', detail: '较温和的日常能量缺口，约减少 300–500 kcal' },
  { value: 'FOCUSED_FAT_LOSS', detail: '较明显的日常能量缺口，约减少 500–750 kcal' },
  { value: 'MAINTENANCE', detail: '接近维持所需能量' },
]

function PageBack() {
  const navigate = useNavigate()
  return <button className="nutrition-page__back" type="button" aria-label="返回" onClick={() => navigate(-1)}>‹</button>
}

export function NutritionPlanSelectionScreen({ suppliedService }: { suppliedService?: NutritionService }) {
  const navigate = useNavigate()
  const [service, setService] = useState<NutritionService | null>(suppliedService ?? null)
  const [config, setConfig] = useState<NutritionPlanConfig>(defaultConfig)
  const [preview, setPreview] = useState<Awaited<ReturnType<NutritionService['previewPlan']>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; void (async () => {
    try { const current = suppliedService ?? await openNutritionService(); if (!active) return
      setService(current); const runs = await current.plans()
      if (runs.scheduled ?? runs.active) setConfig(configFromRun((runs.scheduled ?? runs.active)!))
    } catch (cause) { logger.error('Nutrition plan setup failed', cause); if (active) setError('营养方案暂时无法打开。') }
  })(); return () => { active = false } }, [suppliedService])
  const setStrategy = (baseStrategy: NutritionBaseStrategy) => setConfig((current) => ({ ...current,
    baseStrategy, flexibleWeekday: baseStrategy === 'MAINTENANCE' ? null : current.flexibleWeekday }))
  async function showPreview() {
    if (!service) return
    try { setError(''); setPreview(await service.previewPlan(config)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法生成方案预览。') }
  }
  async function confirm() {
    if (!service || !preview?.target) return
    setBusy(true)
    try { await service.confirmPlan(config); navigate('/food/plan', { replace: true }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '方案未能保存。') }
    finally { setBusy(false) }
  }
  if (preview) return <main className="nutrition-page nutrition-plan-page nutrition-plan-preview">
    <button className="nutrition-page__back" type="button" aria-label="返回选择方案" onClick={() => setPreview(null)}>‹</button>
    <header><h1>方案预览</h1><p>按你现在的资料</p></header>
    {preview.target ? <>
      <section className="nutrition-plan-preview__targets" aria-label="预计每日目标">
        <span>热量范围</span><strong>{preview.target.caloriesMin.toLocaleString('zh-CN')}–{preview.target.caloriesMax.toLocaleString('zh-CN')}</strong><small>kcal / 天</small>
        <i /><span>蛋白质目标</span><strong>{preview.target.proteinMinG}–{preview.target.proteinMaxG} g</strong><small>/ 天</small>
      </section>
      <section className="nutrition-plan-summary"><h2>方案配置</h2>
        <p><b>基础目标</b>{strategyLabels[config.baseStrategy]}</p>
        <p><b>高蛋白</b>{config.highProtein ? '已开启' : '未开启'}</p>
        <p><b>进食窗口</b>{treWindow(config) ?? '未开启'}</p>
        <p><b>每周宽松日</b>{config.flexibleWeekday === null ? '未开启' : weekdayLabels[config.flexibleWeekday]}</p>
      </section>
      <p className="nutrition-plan-effective">{preview.startsTomorrow
        ? '今天已有饮食记录，新方案将从明天开始。' : '今天还没有饮食记录，新方案可从今天开始。'}</p>
    </> : <section className="nutrition-reference__empty"><strong>{preview.unavailableReason === 'UNDER_19'
      ? '暂不生成成人方案' : '请先完善个人资料'}</strong><p>{preview.unavailableReason === 'UNDER_19'
        ? '成人自动营养方案适用于 19 岁及以上用户。' : '需要出生日期、身高、体重和日常节奏。'}</p>
      <button type="button" onClick={() => navigate('/food/profile')}>调整个人资料 →</button></section>}
    {error ? <p className="nutrition-page__error" role="alert">{error}</p> : null}
    {preview.target ? <div className="nutrition-page__action"><button type="button" disabled={busy} onClick={() => void confirm()}>
      <span>{preview.startsTomorrow ? '确认并从明天开始' : '确认并从今天开始'}</span><AppIcon name="arrow" /></button></div> : null}
  </main>
  return <main className="nutrition-page nutrition-plan-page nutrition-plan-select"><PageBack />
    <header><h1>选择营养方案</h1><p>找到适合你的日常方式；以后仍可调整。</p></header>
    <section><h2>基础目标</h2><p className="nutrition-plan-section-note">选择一个基础目标，这会影响每日热量范围。</p>
      <div className="nutrition-plan-choices">{strategies.map((item) => <button key={item.value} type="button"
        aria-pressed={config.baseStrategy === item.value} onClick={() => setStrategy(item.value)}>
        <span className="nutrition-plan-choice__mark" aria-hidden="true">{item.value === 'MAINTENANCE' ? '✧' : '♧'}</span>
        <span><strong>{strategyLabels[item.value]}</strong><small>{item.detail}</small></span><i /></button>)}</div></section>
    <section><h2>可选侧重</h2><div className="nutrition-plan-modifiers">
      <label><input type="checkbox" checked={config.highProtein} onChange={(event) => setConfig({ ...config,
        highProtein: event.target.checked })} /><span><strong>高蛋白</strong><small>在自动范围内提高蛋白质参考</small></span></label>
      {config.highProtein ? <p className="nutrition-plan-caution">如医生要求限制蛋白质摄入，请不要启用高蛋白侧重。</p> : null}
      <label><input type="checkbox" checked={config.treEnabled} onChange={(event) => setConfig({ ...config,
        treEnabled: event.target.checked, treStartLocalTime: event.target.checked ? '09:00' : null,
        treWindowMinutes: event.target.checked ? 600 : null })} /><span><strong>进食窗口</strong><small>设置每日 8–12 小时的进食时间</small></span></label>
      {config.treEnabled ? <div className="nutrition-plan-inline"><label>开始时间<input aria-label="进食窗口开始时间" type="time"
        value={config.treStartLocalTime ?? '09:00'} onChange={(event) => setConfig({ ...config,
          treStartLocalTime: event.target.value })} /></label><label>时长<select aria-label="进食窗口时长"
          value={config.treWindowMinutes ?? 600} onChange={(event) => setConfig({ ...config,
            treWindowMinutes: Number(event.target.value) })}>{[8,9,10,11,12].map((hour) => <option key={hour}
              value={hour * 60}>{hour} 小时</option>)}</select></label></div> : null}
      {config.baseStrategy !== 'MAINTENANCE' ? <label><input type="checkbox" checked={config.flexibleWeekday !== null}
        onChange={(event) => setConfig({ ...config, flexibleWeekday: event.target.checked ? 6 : null })} />
        <span><strong>每周宽松日</strong><small>当天热量回到维持范围，其他日期不变</small></span></label> : null}
      {config.flexibleWeekday !== null ? <label className="nutrition-plan-weekday">星期<select aria-label="每周宽松日"
        value={config.flexibleWeekday} onChange={(event) => setConfig({ ...config,
          flexibleWeekday: Number(event.target.value) })}>{weekdayLabels.map((label, index) => <option key={label}
            value={index}>{label}</option>)}</select><small>当天能量参考回到维持范围；蛋白质和进食窗口不变。</small></label> : null}
    </div></section>
    {error ? <p className="nutrition-page__error" role="alert">{error}</p> : null}
    <div className="nutrition-page__action"><button type="button" onClick={() => void showPreview()}>
      <span>查看预计结果</span><AppIcon name="arrow" /></button></div>
  </main>
}

export function NutritionPlanManagementScreen({ suppliedService }: { suppliedService?: NutritionService }) {
  const navigate = useNavigate()
  const [state, setState] = useState<Awaited<ReturnType<NutritionService['plans']>> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; void (async () => { try {
    const service = suppliedService ?? await openNutritionService(); const result = await service.plans()
    if (active) setState(result)
  } catch (cause) { logger.error('Nutrition plan history failed', cause); if (active) setError('方案记录暂时无法打开。') }
  })(); return () => { active = false } }, [suppliedService])
  const current = state?.active ?? state?.scheduled ?? null
  return <main className="nutrition-page nutrition-plan-page nutrition-plan-manage"><PageBack />
    <header><h1>我的营养方案</h1></header>{error ? <p role="alert" className="nutrition-page__error">{error}</p> : null}
    {current ? <section className="nutrition-plan-current"><div><span>当前方案</span>
      <em>{current.status === 'SCHEDULED' ? '待开始' : '进行中'}</em></div>
      <small>{current.status === 'SCHEDULED' ? `将于 ${current.starts_on} 开始` : `自 ${current.starts_on} 开始`}</small>
      <h2>{strategyLabels[current.base_strategy]}</h2>
      <ul>{current.high_protein ? <li>高蛋白</li> : null}{current.tre_enabled ? <li>进食窗口 {treWindow(configFromRun(current))}</li> : null}
        {current.flexible_weekday !== null ? <li>每周宽松日：{weekdayLabels[current.flexible_weekday]}</li> : null}</ul>
      <button type="button" onClick={() => navigate('/food/plan/select')}>调整方案 →</button></section>
      : state ? <section className="nutrition-reference__empty"><strong>尚未选择营养方案</strong>
        <button type="button" onClick={() => navigate('/food/plan/select')}>选择方案 →</button></section> : null}
    {state?.active && state.scheduled ? <section className="nutrition-plan-scheduled"><span>下一方案</span>
      <strong>{strategyLabels[state.scheduled.base_strategy]}</strong><small>{state.scheduled.starts_on} 开始</small></section> : null}
    {state?.history.some((run) => run.status === 'ENDED') ? <section className="nutrition-plan-history"><h2>历史方案</h2>
      {state.history.filter((run) => run.status === 'ENDED').map((run) => <article key={run.id}>
        <strong>{strategyLabels[run.base_strategy]}</strong><span>{run.starts_on} – {run.ends_on}</span></article>)}</section> : null}
  </main>
}
