import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { PlanDayInput, TrainingPlanImageDraft } from '@motion/domain'
import { logger } from '../../app/logger'
import { ChoiceSelect } from '../../components/ChoiceSelect'
import celestialFrame from '../../assets/motion-art/motion-celestial-frame.svg'
import { uiCopy } from '../../locales'
import { displayWorkoutTitle } from './libraryModel'
import { openTrainingExecution, type ExecutionSnapshot, type TrainingExecution } from './trainingExecution'
import { openAiService } from '../ai/aiRuntime'
import { MotionAi } from '../../platform/ai/aiNative'
import './trainingPlan.css'

interface DraftDay { isRestDay: boolean; workoutId: string }
const newDay = (): DraftDay => ({ isRestDay: false, workoutId: '' })

export function TrainingPlanScreen({ execution: supplied }: { execution?: TrainingExecution }) {
  const navigate = useNavigate()
  const location = useLocation()
  const backPath = (location.state as { from?: string } | null)?.from === '/' ? '/' : '/training'
  const [service, setService] = useState<TrainingExecution | null>(supplied ?? null)
  const [data, setData] = useState<ExecutionSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [days, setDays] = useState<DraftDay[]>([newDay()])
  const [moveDate, setMoveDate] = useState('')
  const [swapTarget, setSwapTarget] = useState('')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [aiDraft, setAiDraft] = useState<TrainingPlanImageDraft | null>(null)

  const refresh = useCallback(async (current: TrainingExecution) => {
    setData(await current.load())
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const current = supplied ?? await openTrainingExecution()
        const snapshot = await current.load()
        if (active) { setService(current); setData(snapshot); setError('') }
      } catch (cause) {
        logger.error('Training plan load failed', cause)
        if (active) setError(uiCopy.plan.error)
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [supplied])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let listener: PluginListenerHandle | undefined
    let disposed = false
    void CapacitorApp.addListener('backButton', () => {
      if (!document.querySelector('[data-choice-sheet="open"]')) navigate(backPath)
    }).then((handle) => {
      if (disposed) void handle.remove()
      else listener = handle
    })
    return () => { disposed = true; if (listener) void listener.remove() }
  }, [navigate, backPath])

  async function act(work: (current: TrainingExecution) => Promise<unknown>) {
    if (!service || busy) return
    setBusy(true); setError('')
    try { await work(service); await refresh(service) }
    catch (cause) { logger.error('Training plan operation failed', cause); setError(uiCopy.plan.error) }
    finally { setBusy(false) }
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim() || days.some((day) => !day.isRestDay && !day.workoutId)) {
      setError(uiCopy.plan.validation); return
    }
    await act(async (current) => {
      const input: PlanDayInput[] = days.map((day, index) => ({ dayIndex: index + 1,
        isRestDay: day.isRestDay, items: day.isRestDay ? [] : [{ workoutContentId: day.workoutId, role: 'PRIMARY' }] }))
      await current.createPlan(title, input)
      setCreating(false); setTitle(''); setDays([newDay()])
    })
  }
  async function recognizePlanImage() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const image = await MotionAi.chooseMealImage()
      const base64 = image.dataUrl.replace(/^data:image\/jpeg;base64,/, '')
      setAiDraft(await (await openAiService()).trainingPlanImage(base64))
    } catch (cause) {
      if (!String(cause).includes('IMAGE_NOT_SELECTED')) {
        logger.error('Training plan image assist failed', cause); setError('暂时无法识别计划图片。')
      }
    } finally { setBusy(false) }
  }
  async function confirmAiPlan() {
    if (!aiDraft || busy) return
    setBusy(true); setError('')
    try { await (await openAiService()).confirmTrainingPlanDraft(aiDraft); setAiDraft(null); if (service) await refresh(service) }
    catch (cause) { logger.error('Training plan AI draft save failed', cause); setError('计划草稿没有保存，请检查后重试。') }
    finally { setBusy(false) }
  }

  if (loading) return <section className="plan-screen" aria-live="polite">{uiCopy.plan.loading}</section>
  if (!data || !service) return <section className="plan-screen" role="alert">{error || uiCopy.execution.unavailable}</section>

  const current = data.currentDay
  const active = data.run
  const restSwap = data.runDays.find((day) => day.isRestDay && day.status === 'SCHEDULED')
  const swappable = data.runDays.filter((day) => !day.isRestDay && day.status === 'SCHEDULED' && day.id !== restSwap?.id)
  const available = data.workouts.filter((workout) => workout.userVisibility !== 'ARCHIVED')
  const workoutName = (id: string | null) => {
    const workout = data.workouts.find((item) => item.id === id)
    return workout ? displayWorkoutTitle(workout) : uiCopy.plan.rest
  }

  return <section className="plan-screen">
    <header className="plan-screen__header">
      <Link to={backPath} aria-label={backPath === '/' ? uiCopy.plan.backToday : uiCopy.plan.back}
        className="plan-screen__back">‹</Link>
      <span className="eyebrow">{uiCopy.training.eyebrow}</span>
      <h1>{uiCopy.plan.title}</h1>
      <img className="plan-screen__emblem" src={celestialFrame} alt="" aria-hidden="true" />
    </header>
    {error ? <p role="alert" className="plan-screen__error">{error}</p> : null}

    {active ? <section className="plan-screen__current" aria-label={uiCopy.plan.active}>
      <div className="plan-screen__heading"><h2>{data.plans.find((plan) => plan.id === active.trainingPlanId)?.title}</h2>
        <span>{active.status === 'PAUSED' ? uiCopy.plan.paused : uiCopy.plan.active}</span></div>
      {data.runDays.map((day) => <div className="plan-screen__day" key={day.id}
        data-status={day.status} data-rest={day.isRestDay} data-current={day.id === current?.id}>
        <strong>{uiCopy.plan.day}{day.dayIndex}{uiCopy.plan.dayUnit} · {day.isRestDay ? uiCopy.plan.rest : workoutName(day.primaryWorkoutId)}</strong>
        <span>{uiCopy.plan.status[day.status]}</span>
        <small>{uiCopy.plan.scheduledDate} {day.scheduledLocalDate}{day.originalScheduledLocalDate !== day.scheduledLocalDate
          ? ` · ${uiCopy.plan.originalDate} ${day.originalScheduledLocalDate}` : ''}</small>
      </div>)}
      {active.status === 'PAUSED' ? <button type="button" disabled={busy} onClick={() => void act((s) => s.resume(active.id))}>
        {uiCopy.plan.resume}</button> : <>
        {current ? <div className="plan-screen__actions">
          {current.isRestDay && current.scheduledLocalDate <= service.today() ?
            <button type="button" disabled={busy} onClick={() => void act((s) => s.rest(current.id))}>{uiCopy.plan.completeRest}</button> : null}
          {current.status === 'SCHEDULED' && !current.isRestDay ? <>
            <label>{uiCopy.plan.reschedule}
              <input type="date" min={current.scheduledLocalDate} value={moveDate}
                onChange={(event) => setMoveDate(event.target.value)} /></label>
            <button type="button" disabled={busy || !moveDate || moveDate <= current.scheduledLocalDate}
              onClick={() => void act(async (s) => { await s.reschedule(current.id, moveDate); setMoveDate('') })}>
              {uiCopy.plan.applyReschedule}</button>
            <button type="button" disabled={busy} onClick={() => void act((s) => s.skip(current.id))}>{uiCopy.plan.skip}</button>
          </> : null}
          {restSwap && swappable.length ? <ChoiceSelect label={uiCopy.plan.moveRest}
            value={swapTarget} onChange={setSwapTarget} options={[
              { value: '', label: uiCopy.plan.swapWith },
              ...swappable.map((day) => ({ value: day.id,
                label: `${uiCopy.plan.day}${day.dayIndex}${uiCopy.plan.dayUnit} · ${day.scheduledLocalDate}` })),
            ]} /> : null}
          {restSwap && swapTarget ? <button type="button" disabled={busy}
            onClick={() => void act(async (s) => { await s.swapRest(restSwap.id, swapTarget); setSwapTarget('') })}>
            {uiCopy.plan.applySwap}</button> : null}
        </div> : <button type="button" disabled={busy} onClick={() => void act((s) => s.completeRun(active.id))}>
          {uiCopy.plan.finish}</button>}
        <button type="button" disabled={busy || !!data.session} onClick={() => void act((s) => s.pause(active.id))}>
          {uiCopy.plan.pause}</button>
      </>}
      {confirmEnd ? <div className="plan-screen__confirm" role="group" aria-label={uiCopy.plan.end}>
        <p>{uiCopy.plan.confirmEnd}</p>
        <button type="button" disabled={busy || !!data.session} onClick={() => void act(async (s) => { await s.end(active.id); setConfirmEnd(false) })}>
          {uiCopy.plan.end}</button>
        <button type="button" onClick={() => setConfirmEnd(false)}>{uiCopy.plan.cancel}</button>
      </div> : <button type="button" className="plan-screen__end" disabled={busy || !!data.session}
        onClick={() => setConfirmEnd(true)}>{uiCopy.plan.end}</button>}
    </section> : null}

    <section className="plan-screen__saved">
      <div className="plan-screen__heading"><h2>{uiCopy.plan.title}</h2>
        <div><button type="button" disabled={busy} onClick={() => void recognizePlanImage()}>识别计划图片</button>
          <button type="button" onClick={() => setCreating((value) => !value)}>{uiCopy.plan.create}</button></div></div>
      {data.plans.length ? data.plans.map((plan) => <div className="plan-screen__saved-item" key={plan.id}>
        <strong>{plan.title}</strong><span>{plan.plannedDays}{uiCopy.plan.dayUnit}</span>
        {!active ? <button type="button" disabled={busy} onClick={() => void act((s) => s.startPlan(plan.id))}>
          {uiCopy.plan.start}</button> : null}
      </div>) : <p>{uiCopy.plan.empty}</p>}
    </section>

    {aiDraft ? <section className="plan-screen__ai-draft" aria-labelledby="plan-ai-draft-title">
      <h2 id="plan-ai-draft-title">AI 计划草稿（可编辑）</h2>
      <label>计划名称<input value={aiDraft.title ?? ''} onChange={(event) => setAiDraft({ ...aiDraft, title: event.target.value })} /></label>
      {aiDraft.days.map((day, index) => <div key={day.dayIndex}><strong>第 {day.dayIndex} 天</strong>
        <label>标题<input value={day.title ?? ''} onChange={(event) => setAiDraft({ ...aiDraft,
          days: aiDraft.days.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value || null } : item) })} /></label>
        <label><input type="checkbox" checked={day.isRestDay} onChange={(event) => setAiDraft({ ...aiDraft,
          days: aiDraft.days.map((item, itemIndex) => itemIndex === index ? { ...item, isRestDay: event.target.checked } : item) })} />休息日</label></div>)}
      <p>识别结果不会自动启用。确认后仅创建本地计划，仍需由你手动开始。</p>
      <div><button type="button" disabled={busy} onClick={() => void confirmAiPlan()}>确认创建计划</button>
        <button type="button" onClick={() => setAiDraft(null)}>取消</button></div></section> : null}

    {creating ? <form className="plan-screen__create" onSubmit={(event) => void savePlan(event)}>
      <label>{uiCopy.plan.planName}<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      {days.map((day, index) => <div className="plan-screen__draft-day" key={index}>
        <strong>{uiCopy.plan.day}{index + 1}{uiCopy.plan.dayUnit}</strong>
        <label><input type="checkbox" checked={day.isRestDay} onChange={(event) => setDays((list) => list.map((item, i) =>
          i === index ? { ...item, isRestDay: event.target.checked, workoutId: event.target.checked ? '' : item.workoutId } : item))} />
          {uiCopy.plan.rest}</label>
        {!day.isRestDay ? <ChoiceSelect label={uiCopy.plan.workout} value={day.workoutId}
          onChange={(value) => setDays((list) => list.map((item, i) =>
            i === index ? { ...item, workoutId: value } : item))} options={[
            { value: '', label: uiCopy.plan.chooseWorkout },
            ...available.map((workout) => ({ value: workout.id, label: displayWorkoutTitle(workout) })),
          ]} /> : null}
        {days.length > 1 ? <button type="button" onClick={() => setDays((list) => list.filter((_, i) => i !== index))}>
          {uiCopy.plan.removeDay}</button> : null}
      </div>)}
      {!available.length ? <p>{uiCopy.plan.noWorkout}</p> : null}
      <div className="plan-screen__actions">
        <button type="button" onClick={() => setDays((list) => [...list, newDay()])}>{uiCopy.plan.addDay}</button>
        <button type="button" onClick={() => setDays((list) => [...list, { isRestDay: true, workoutId: '' }])}>
          {uiCopy.plan.addRest}</button>
      </div>
      <button type="submit" disabled={busy || !available.length}>{uiCopy.plan.save}</button>
    </form> : null}
  </section>
}
