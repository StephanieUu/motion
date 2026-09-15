import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { MealType } from '@motion/domain'
import { useNavigate } from 'react-router-dom'
import { logger } from '../../app/logger'
import { AppIcon } from '../../components/AppIcon'
import interludeArt from '../../assets/motion-art/today-interlude.png'
import type { FoodEntryRecord, MealTemplateRecord, MealWithEntries } from '../../db/repositories/NutritionRepository'
import { openNutritionService, type NutritionService } from './nutritionService'
import type { DailyNutrition } from './nutritionPresentation'
import { compactPlanLabel } from './nutritionPlanPresentation'
import './food.css'

const mealTypes: { type: MealType; label: string }[] = [
  { type: 'BREAKFAST', label: '早餐' }, { type: 'LUNCH', label: '午餐' },
  { type: 'DINNER', label: '晚餐' }, { type: 'SNACK', label: '加餐' },
]
const mealPrompts: Record<MealType, string> = {
  BREAKFAST: '早饭吃了什么？', LUNCH: '午饭吃了什么？',
  DINNER: '晚饭吃了什么？', SNACK: '加餐吃了什么？', OTHER: '吃了什么？',
}
function defaultMealType(hour: number): MealType {
  return hour < 10 ? 'BREAKFAST' : hour < 14 ? 'LUNCH' : hour < 18 ? 'SNACK' : 'DINNER'
}
function foodDateLabel(localDate: string | undefined): string {
  if (!localDate) return ''
  const [, month, day] = localDate.split('-').map(Number)
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${localDate}T00:00:00Z`)).replace('星期', '周')
  return `${month}月${day}日 ${weekday}`
}
function mealTime(loggedAt: string): string {
  const date = new Date(loggedAt)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}
function mealPreview(item: MealWithEntries): { name: string; nutrition: string } {
  const names = item.entries.map((entry) => entry.name).filter((name) => name !== '快速记录')
  const knownCalories = item.entries.filter((entry) => entry.calories_kcal !== null)
  const knownProtein = item.entries.filter((entry) => entry.protein_g !== null)
  const unknownCalories = knownCalories.length < item.entries.length
  const unknownProtein = knownProtein.length < item.entries.length
  const calories = knownCalories.length ? `${unknownCalories ? '至少 ' : knownCalories.some(
    (entry) => entry.confidence_level === 'ROUGH') ? '约 ' : ''}${Math.round(knownCalories.reduce(
    (sum, entry) => sum + (entry.calories_kcal ?? 0), 0))} kcal` : ''
  const protein = knownProtein.length ? `蛋白质${unknownProtein ? '至少 ' : ' '}${Math.round(
    knownProtein.reduce((sum, entry) => sum + (entry.protein_g ?? 0), 0))} g` : ''
  return { name: names.join('、'), nutrition: calories || protein
    ? `${calories || '热量未知'} · ${protein || '蛋白质未知'}` : '营养数值未知' }
}
function valueOrNull(value: string): number | null {
  if (!value.trim()) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('请输入有效的非负数值。')
  return numeric
}

function EntryEditor({ entry, onSave, onDelete }: { entry: FoodEntryRecord;
  onSave: (changes: Partial<FoodEntryRecord>) => Promise<void>; onDelete: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(entry.name)
  const [calories, setCalories] = useState(entry.calories_kcal?.toString() ?? '')
  const [protein, setProtein] = useState(entry.protein_g?.toString() ?? '')
  const [error, setError] = useState('')
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      if (!name.trim()) throw new Error('请填写食物名称。')
      await onSave({ name: name.trim(), calories_kcal: valueOrNull(calories), protein_g: valueOrNull(protein),
        estimation_method: 'MANUAL', confidence_level: 'MEDIUM' })
      setEditing(false); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败。') }
  }
  return <li className="food-entry">
    {editing ? <form className="food-entry__editor" onSubmit={(event) => void save(event)}>
      <label>名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>千卡<input type="number" min="0" step="any" inputMode="decimal" value={calories}
        onChange={(event) => setCalories(event.target.value)} placeholder="未知可留空" /></label>
      <label>蛋白质 · 克<input type="number" min="0" step="any" inputMode="decimal" value={protein}
        onChange={(event) => setProtein(event.target.value)} placeholder="未知可留空" /></label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="food-entry__actions"><button type="submit">保存</button>
        <button type="button" onClick={() => setEditing(false)}>取消</button>
        <button type="button" onClick={() => void onDelete()}>删除</button></div>
    </form> : <>
      <div><strong>{entry.name}</strong><span>{entry.confidence_level === 'ROUGH' ? '粗略记录' :
        entry.calories_kcal === null || entry.protein_g === null ? '部分记录' : '手动记录'}</span></div>
      <p>{entry.calories_kcal === null ? '热量未知' : `${Math.round(entry.calories_kcal)} 千卡`}
        {' · '}{entry.protein_g === null ? '蛋白质未知' : `蛋白质 ${Math.round(entry.protein_g)} 克`}</p>
      <button type="button" onClick={() => setEditing(true)}>修改</button>
    </>}
  </li>
}

export function FoodScreen({ suppliedService }: { suppliedService?: NutritionService }) {
  const navigate = useNavigate()
  const [service, setService] = useState<NutritionService | null>(suppliedService ?? null)
  const [day, setDay] = useState<DailyNutrition | null>(null)
  const [templates, setTemplates] = useState<MealTemplateRecord[]>([])
  const [mealType, setMealType] = useState<MealType>(defaultMealType(new Date().getHours()))
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [templateMeal, setTemplateMeal] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [duplicateConfirm, setDuplicateConfirm] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [expandedMealId, setExpandedMealId] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)

  const refresh = useCallback(async (current: NutritionService) => {
    const [daily, savedTemplates] = await Promise.all([current.daily(), current.templates()])
    setDay(daily); setTemplates(savedTemplates)
  }, [])
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const current = suppliedService ?? await openNutritionService()
        if (!active) return
        setService(current); await refresh(current)
      } catch (cause) { logger.error('Food load failed', cause); if (active) setError('饮食记录暂时无法打开。') }
    })()
    return () => { active = false }
  }, [suppliedService, refresh])

  async function act(work: (current: NutritionService) => Promise<void>): Promise<boolean> {
    if (!service || busy) return false
    setBusy(true); setError(''); setNotice('')
    try { await work(service); await refresh(service); return true }
    catch (cause) { logger.error('Food operation failed', cause)
      setError(cause instanceof Error ? cause.message : '操作没有完成，请重试。'); return false }
    finally { setBusy(false) }
  }
  async function log(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await act(async (current) => { await current.logText(text, mealType); setText(''); setNotice('已记录。') })
    if (saved) setQuickOpen(false)
  }
  const groups = new Map<MealType, MealWithEntries[]>()
  for (const item of day?.meals ?? []) groups.set(item.meal.meal_type,
    [...(groups.get(item.meal.meal_type) ?? []), item])
  const unquantifiedMeals = day?.meals.filter((item) => item.entries.some((entry) => entry.calories_kcal === null)).length ?? 0
  const hasKnownCalories = !!day && day.summary.entryCount > day.summary.unknownCalories
  const intakeDisplay = hasKnownCalories ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })
    .format(day.summary.caloriesKnown) : '—'
  const remaining = day?.remaining

  return <div className="food-screen">
    <header className="food-header">
      <div className="food-header__top"><span className="food-header__moon" aria-hidden="true" />
        <span>{foodDateLabel(day?.localDate)}</span></div>
      <div className="food-header__title"><h1>饮食</h1></div>
    </header>
    <section className="food-status" aria-label="今日饮食">
      <span className="food-status__art" aria-hidden="true" />
      <div className="food-status__intake"><strong>{intakeDisplay}</strong><span>kcal</span>
        <small>{hasKnownCalories ? '已记录摄入' : day?.summary.entryCount ? '热量未知' : '暂无记录'}</small></div>
      <div className="food-status__detail">{day?.target ? <>
        <span>目标</span><strong>{day.target.calories_min.toLocaleString('zh-CN')}–{day.target.calories_max.toLocaleString('zh-CN')} kcal</strong>
        <span>{remaining?.calorieState === 'OVER' ? '今日已超过目标范围'
          : remaining?.calorieState === 'IN_RANGE' ? '今日已在目标范围内' : '距离目标范围'}</span>
        {remaining?.calorieState === 'BELOW' ? <strong>{remaining.caloriesRemainingMin?.toLocaleString('zh-CN')}–{remaining.caloriesRemainingMax?.toLocaleString('zh-CN')} kcal</strong> : null}
        {(remaining?.proteinGapG ?? 0) > 0 ? <><span>蛋白质还差</span><strong>{Math.round(remaining?.proteinGapG ?? 0)} g</strong></>
          : <strong>蛋白质已达参考下限</strong>}
      </> : <><strong className="food-status__no-target">—</strong>
        <span>{day?.targetUnavailableReason === 'UNDER_19' ? '暂无成人自动目标' : '尚未设置营养目标'}</span></>}</div>
      {unquantifiedMeals > 0 ? <div className="food-status__note"><p>{unquantifiedMeals} 餐营养未知</p></div> : null}
    </section>
    {day?.planRun ? <button className="food-plan-state" type="button" onClick={() => navigate('/food/plan')}>
      <span>{compactPlanLabel(day.planRun, day.target?.day_type)}</span><AppIcon name="arrow" /></button> : null}
    <button className="food-log-action" type="button" aria-label="记一餐" onClick={() => setQuickOpen(true)}>
      <span aria-hidden="true">＋</span><strong>记一餐</strong><AppIcon name="arrow" /></button>
    {!quickOpen && error ? <p className="food-error" role="alert">{error}</p> : null}
    {notice ? <p className="food-notice" role="status">{notice}</p> : null}
    <section className="food-meals" aria-label="今天吃了什么">
      <h2>今天吃了什么</h2>
      <div className="food-meals__timeline">{mealTypes.map(({ type, label }, index) => <section
        className="food-meal" key={type} aria-label={label}>
        <span className="food-meal__number">0{index + 1}</span>
        <span className="food-meal__seal" data-meal={type} aria-hidden="true" />
        <div className="food-meal__body"><h3>{label}</h3>
          {groups.get(type)?.length ? groups.get(type)!.map((item) => {
            const preview = mealPreview(item)
            return <div className="food-meal__record" key={item.meal.id}>
              <div className="food-meal__record-top"><time>{mealTime(item.meal.logged_at)}</time>
                <button type="button" aria-label={`${label}记录选项`} aria-expanded={expandedMealId === item.meal.id}
                  onClick={() => setExpandedMealId((current) => current === item.meal.id ? null : item.meal.id)}>···</button></div>
              {preview.name ? <p className="food-meal__name">{preview.name}</p> : null}
              <p className="food-meal__nutrition">{preview.nutrition}</p>
              {expandedMealId === item.meal.id ? <div className="food-meal__details">
                <ul className="food-meal__entries">{item.entries.map((entry) => <EntryEditor key={entry.id} entry={entry}
                  onSave={async (changes) => { await act(async (current) => { await current.updateEntry(entry.id, changes) }) }}
                  onDelete={async () => { await act(async (current) => { await current.deleteEntry(entry.id) }) }} />)}</ul>
                {templateMeal === item.meal.id ? <form className="food-template-save" onSubmit={(event) => {
                  event.preventDefault(); void act(async (current) => {
                    await current.saveTemplate(item.meal.id, templateName); setTemplateMeal(null); setTemplateName('')
                  }) }}><input aria-label="常用餐名称" value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)} placeholder="给这餐起个名字" />
                    <button type="submit" disabled={busy || !templateName.trim()}>保存</button></form>
                  : <button className="food-text-button" type="button" onClick={() => {
                    setTemplateMeal(item.meal.id); setTemplateName(`${label} · ${item.entries[0]?.name ?? '常用'}`)
                  }}>存为常用餐</button>}
              </div> : null}
            </div>
          }) : <button className="food-meal__empty" type="button" onClick={() => {
            setMealType(type); setQuickOpen(true)
          }}>还没有记录 <span aria-hidden="true">＋</span></button>}
        </div>
      </section>)}</div>
      {groups.get('OTHER')?.length ? <section className="food-meal food-meal--other" aria-label="其他记录">
        <h3>其他记录</h3>{groups.get('OTHER')?.flatMap((item) => item.entries).map((other) => <ul
          className="food-meal__entries" key={other.id}><EntryEditor entry={other}
            onSave={async (changes) => { await act(async (current) => { await current.updateEntry(other.id, changes) }) }}
            onDelete={async () => { await act(async (current) => { await current.deleteEntry(other.id) }) }} /></ul>)}</section> : null}
    </section>
    <section className="food-tools" aria-label="小工具"><span className="eyebrow">小工具</span>
      <div className="food-tools__row"><button type="button" aria-expanded={toolsOpen}
        onClick={() => setToolsOpen((value) => !value)}><span className="food-tools__icon" aria-hidden="true">◇</span>
          <span>常用餐<small>{templates.length} 个</small></span></button>
        <button type="button" disabled={busy} onClick={() => {
          if ((day?.summary.entryCount ?? 0) > 0) { setDuplicateConfirm(true); return }
          void act(async (current) => { const count = await current.copyYesterday(false)
            setNotice(count ? `已复制 ${count} 餐。` : '昨天没有餐食可复制。') })
        }}><span className="food-tools__icon" aria-hidden="true">▣</span><span>复制昨天<small>餐食记录</small></span>
          <AppIcon name="arrow" /></button></div>
      {toolsOpen ? <div className="food-tools__templates">{templates.length ? <ul>{templates.map((item) =>
        <li key={item.id}><span>{item.name}</span><button type="button" disabled={busy}
          onClick={() => void act(async (current) => { await current.applyTemplate(item.id)
            setNotice('已复制到今天。') })}>记到今天 →</button></li>)}</ul>
        : <p>暂无常用餐。可从餐食记录中保存。</p>}</div> : null}
      {duplicateConfirm ? <div className="food-tools__confirm"><p>今天已有记录，继续会额外添加昨天的餐食。</p>
        <button type="button" disabled={busy} onClick={() => void act(async (current) => {
          const count = await current.copyYesterday(true); setDuplicateConfirm(false)
          setNotice(count ? `已复制 ${count} 餐。` : '昨天没有餐食可复制。')
        })}>确认再复制</button><button type="button" onClick={() => setDuplicateConfirm(false)}>取消</button></div> : null}
    </section>
    <section className="food-setup" aria-label="每日营养参考">
      <button className="food-setup__toggle" type="button" onClick={() => navigate('/food/reference')}>
        <span>每日营养参考<small>{day?.target ? '查看你的热量与蛋白质参考' : '完善资料，获得个性化参考'}</small></span>
        <AppIcon name="arrow" /></button>
    </section>
    {quickOpen ? createPortal(<div className="food-compose" role="dialog" aria-modal="true" aria-labelledby="food-compose-title">
      <div className="food-compose__sheet"><button className="food-compose__close" type="button"
        aria-label="关闭记一餐" onClick={() => setQuickOpen(false)}>×</button>
        <header><span className="food-compose__moon" aria-hidden="true" /><h2 id="food-compose-title">记一餐</h2>
          <p>可填写食物，也可直接填写热量和蛋白质。</p></header>
        <form className="food-compose__form" onSubmit={(event) => void log(event)}>
          <div className="food-compose__types" role="group" aria-label="选择餐次">{mealTypes.map((item) =>
            <button key={item.type} type="button" aria-pressed={mealType === item.type}
              onClick={() => setMealType(item.type)}><span aria-hidden="true">{item.type === 'DINNER' ? '☾' : '✧'}</span>
              {item.label}</button>)}</div>
          <label className="food-compose__input-label" htmlFor="food-quick-input">食物或已知数值</label>
          <textarea id="food-quick-input" value={text} onChange={(event) => setText(event.target.value)}
            placeholder={`${mealPrompts[mealType]}\n也可以直接写：700 kcal`} rows={5} />
          <p className="food-compose__examples">例如：600 kcal · 午饭大约 700 kcal · 午饭 700 kcal 蛋白质 30g</p>
          {error ? <p className="food-error" role="alert">{error}</p> : null}
          <button className="food-compose__save" type="submit" disabled={busy || !text.trim()}>
            保存记录 <AppIcon name="arrow" /></button>
        </form>
        <img className="food-compose__art" src={interludeArt} alt="" aria-hidden="true" />
      </div>
    </div>, document.body) : null}
  </div>
}
