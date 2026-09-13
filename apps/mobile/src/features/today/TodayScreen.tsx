import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { CompletionStatus, PlanEquivalence } from '@motion/domain'
import { logger } from '../../app/logger'
import { AppIcon } from '../../components/AppIcon'
import { uiCopy } from '../../locales'
import { displayWorkoutTitle } from '../training/libraryModel'
import { openTrainingExecution, type ExecutionSnapshot, type TrainingExecution } from '../training/trainingExecution'
import './today.css'

const completionOptions: CompletionStatus[] = ['COMPLETE', 'MOSTLY_COMPLETE', 'PARTIAL']
const equivalenceOptions: PlanEquivalence[] = ['FULL', 'PARTIAL', 'NONE']
const reactionOptions = ['LOVE', 'LIKE', 'NEUTRAL', 'DISLIKE'] as const

function safeWorkoutUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch { return null }
}

function elapsedMinutes(startedAt: string): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 60000))
}

export function TodayScreen({ execution: supplied }: { execution?: TrainingExecution }) {
  const [service, setService] = useState<TrainingExecution | null>(supplied ?? null)
  const [data, setData] = useState<ExecutionSnapshot | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [duration, setDuration] = useState('')
  const [status, setStatus] = useState<CompletionStatus>('COMPLETE')
  const [equivalence, setEquivalence] = useState<PlanEquivalence | ''>('')
  const [finishStage, setFinishStage] = useState<'IDLE' | 'CONFIRM' | 'DETAILS'>('IDLE')
  const [feedbackId, setFeedbackId] = useState<string | null>(null)
  const [effort, setEffort] = useState<'EASY' | 'JUST_RIGHT' | 'HARD' | ''>('')
  const [reaction, setReaction] = useState<(typeof reactionOptions)[number] | ''>('')

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const current = supplied ?? await openTrainingExecution()
        const snapshot = await current.load()
        if (active) { setService(current); setData(snapshot) }
      } catch (cause) {
        logger.error('Today training load failed', cause)
        if (active) setError(uiCopy.execution.unavailable)
      }
    })()
    return () => { active = false }
  }, [supplied])

  useEffect(() => {
    if (!service) return
    const reload = () => {
      if (document.visibilityState !== 'visible') return
      void service.load().then(setData).catch((cause: unknown) => {
        logger.error('Today training resume failed', cause)
        setError(uiCopy.execution.unavailable)
      })
    }
    document.addEventListener('visibilitychange', reload)
    return () => document.removeEventListener('visibilitychange', reload)
  }, [service])

  async function act(work: (current: TrainingExecution) => Promise<void>) {
    if (!service || busy) return
    setBusy(true); setError(''); setNotice('')
    try { await work(service); setData(await service.load()) }
    catch (cause) { logger.error('Today training operation failed', cause); setError(uiCopy.execution.error) }
    finally { setBusy(false) }
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const session = data?.session
    if (!session) return
    const minutes = duration.trim() ? Number(duration) : elapsedMinutes(session.startedAt)
    if (!Number.isFinite(minutes) || minutes < 0) { setError(uiCopy.training.invalidDuration); return }
    await act(async (current) => {
      await current.completeWorkout(session.id, minutes, status, equivalence || undefined)
      setFeedbackId(session.id); setDuration(''); setEquivalence(''); setFinishStage('IDLE')
      setNotice(uiCopy.execution.done)
    })
  }

  const workout = data?.mainWorkout
  const day = data?.currentDay
  const session = data?.session
  const replacing = !!session && !!day && !!session.trainingPlanRunDayId && session.workoutContentId !== day.primaryWorkoutId
  const future = !!day && !!service && day.scheduledLocalDate > service.today()
  const explicit = !!workout && data?.pendingWorkoutId === workout.id
  const sourceUrl = safeWorkoutUrl(workout?.sourceUrl)
  const intensity = workout?.estimatedIntensity
    ? uiCopy.training.intensities[workout.estimatedIntensity as keyof typeof uiCopy.training.intensities] : undefined
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())

  return <div className="today-screen">
    <header className="today-header"><div><span className="today-header__date">{date}</span>
      <h1>{uiCopy.navigation.today}</h1></div><div className="orbital-mark" aria-hidden="true"><span /></div></header>
    <section className="workout-card" aria-labelledby="today-workout-title">
      <svg className="workout-card__botanical" viewBox="0 0 170 250" aria-hidden="true">
        <path d="M145 258C124 212 117 172 124 132c7-40 22-73 45-98" />
        <path d="M123 151c-29-12-49-32-58-61 28 3 49 23 58 61Z" />
        <path d="M129 116c28-10 45-29 51-56-25 5-42 24-51 56Z" />
      </svg>
      <div className="workout-card__content">
        <span className="eyebrow">{uiCopy.execution.title}</span>
        <h2 id="today-workout-title">{!data ? error || uiCopy.plan.loading
          : session ? uiCopy.execution.inProgress : data.run?.status === 'PAUSED' && !explicit
          ? uiCopy.execution.paused : workout ? displayWorkoutTitle(workout)
            : day?.isRestDay ? uiCopy.execution.rest : uiCopy.execution.noTask}</h2>
        {day ? <p>{uiCopy.execution.planDay} · {uiCopy.plan.day}{day.dayIndex}{uiCopy.plan.dayUnit}
          {future ? ` · ${day.scheduledLocalDate}` : ''}</p> : null}
        {workout ? <div className="workout-card__meta">
          {workout.durationMinutes !== null ? <span><AppIcon name="clock" />
            {workout.durationMinutes} {uiCopy.training.minutes}</span> : null}
          {intensity ? <span>{intensity}</span> : null}
          <span>{uiCopy.training.sources[workout.sourceType]}</span>
        </div> : null}
        {data?.pendingWorkoutId && !session ? <p>{uiCopy.execution.pending}</p> : null}
        {session ? <p>{uiCopy.execution.startedAt} · {new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(session.startedAt))}</p>
          : workout && (data?.run?.status !== 'PAUSED' || explicit) && (!future || explicit) ? <button type="button" disabled={busy}
            onClick={() => void act(async (current) => { await current.startWorkout(data!) })}>
            {uiCopy.execution.start} <AppIcon name="arrow" /></button> : null}
        {session ? <button type="button" disabled={busy} onClick={() => setFinishStage('CONFIRM')}>
          {uiCopy.execution.complete} <AppIcon name="arrow" /></button> : null}
        {session && sourceUrl ? <a className="workout-card__source" href={sourceUrl} target="_blank"
          rel="noopener noreferrer">{uiCopy.execution.openWorkout}</a> : null}
      </div>
    </section>
    {data?.run ? <section className="today-execution__progress" aria-label={uiCopy.execution.progress}>
      <span className="eyebrow">{uiCopy.execution.progress}</span>
      <strong>{data.runDays.filter((item) => !['SCHEDULED', 'IN_PROGRESS'].includes(item.status)).length}
        <small> / {data.runDays.length} {uiCopy.plan.dayUnit}</small></strong>
      <span>{data.plans.find((item) => item.id === data.run?.trainingPlanId)?.title}</span>
    </section> : null}
    {error ? <p className="today-execution__error" role="alert">{error}</p> : null}
    {notice ? <p className="today-execution__notice" role="status">{notice}</p> : null}
    {session && finishStage === 'CONFIRM' ? <section className="today-execution today-execution__confirm"
      aria-labelledby="today-finish-question">
      <h2 id="today-finish-question">{uiCopy.execution.finishQuestion}</h2>
      <button type="button" disabled={busy} onClick={() => {
        setDuration(String(elapsedMinutes(session.startedAt)))
        setFinishStage('DETAILS')
      }}>{uiCopy.execution.finishedYes}</button>
      <button type="button" className="today-execution__secondary" onClick={() => setFinishStage('IDLE')}>
        {uiCopy.execution.notYet}</button>
      <button type="button" className="today-execution__secondary" disabled={busy}
        onClick={() => void act(async (current) => {
          await current.abandonWorkout(session.id)
          setFinishStage('IDLE')
        })}>{uiCopy.execution.abandon}</button>
    </section> : null}
    {session && finishStage === 'DETAILS' ? <form className="today-execution" onSubmit={(event) => void complete(event)}>
      <h2>{uiCopy.execution.confirmWorkout}</h2>
      <label>{uiCopy.execution.duration} · {uiCopy.execution.minutes}<input type="number" min="0" step="any"
        inputMode="decimal" value={duration} placeholder={String(elapsedMinutes(session.startedAt))}
        onChange={(event) => setDuration(event.target.value)} /></label>
      <label>{uiCopy.execution.status}<select value={status} onChange={(event) => setStatus(event.target.value as CompletionStatus)}>
        {completionOptions.map((value) => <option value={value} key={value}>{value === 'COMPLETE' ? uiCopy.execution.completeStatus
          : value === 'MOSTLY_COMPLETE' ? uiCopy.execution.mostlyStatus : uiCopy.execution.partialStatus}</option>)}
      </select></label>
      {replacing ? <label>{uiCopy.execution.equivalence}<select required value={equivalence}
        onChange={(event) => setEquivalence(event.target.value as PlanEquivalence | '')}>
        <option value="">{uiCopy.execution.equivalence}</option>
        {equivalenceOptions.map((value) => <option value={value} key={value}>{value === 'FULL' ? uiCopy.execution.full
          : value === 'PARTIAL' ? uiCopy.execution.partial : uiCopy.execution.none}</option>)}
      </select></label> : null}
      <button type="submit" disabled={busy || (replacing && !equivalence)}>{uiCopy.execution.saveWorkout}</button>
      <button type="button" className="today-execution__secondary" onClick={() => setFinishStage('IDLE')}>
        {uiCopy.execution.notYet}</button>
    </form> : null}
    {feedbackId ? <section className="today-execution" aria-label={uiCopy.execution.feedback}>
      <h2>{uiCopy.execution.feedback}</h2>
      <div className="today-execution__choice"><span>{uiCopy.execution.effort}</span>
        {(['EASY', 'JUST_RIGHT', 'HARD'] as const).map((value) => <button type="button" key={value}
          aria-pressed={effort === value} onClick={() => setEffort(value)}>{value === 'EASY' ? uiCopy.execution.easy
            : value === 'JUST_RIGHT' ? uiCopy.execution.justRight : uiCopy.execution.hard}</button>)}</div>
      <div className="today-execution__choice"><span>{uiCopy.execution.feeling}</span>
        {reactionOptions.map((value) => <button type="button" key={value} aria-label={uiCopy.training.reactionLabels[value]}
          aria-pressed={reaction === value} onClick={() => setReaction(value)}>{uiCopy.training.reactions[value]}</button>)}</div>
      <button type="button" disabled={busy || (!effort && !reaction)} onClick={() => void act(async (current) => {
        await current.saveFeedback(feedbackId, { exertion: effort || null, preference: reaction || null })
        setFeedbackId(null); setNotice(uiCopy.execution.feedbackSaved)
      })}>{uiCopy.execution.saveFeedback}</button>
      <button type="button" className="today-execution__secondary" onClick={() => setFeedbackId(null)}>
        {uiCopy.execution.skipFeedback}</button>
    </section> : null}
    <div className="today-execution__links"><Link to="/training/plan" state={{ from: '/' }}>{uiCopy.execution.viewPlan}</Link>
      <Link to="/training">{uiCopy.execution.selectInLibrary}</Link></div>
  </div>
}
