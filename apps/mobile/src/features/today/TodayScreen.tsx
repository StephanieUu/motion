import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { CompletionStatus, PlanEquivalence } from '@motion/domain'
import { logger } from '../../app/logger'
import { AppIcon } from '../../components/AppIcon'
import { ChoiceSelect } from '../../components/ChoiceSelect'
import celestialComposition from '../../assets/motion-art/today-artwork.png'
import interludeArt from '../../assets/motion-art/today-interlude.png'
import { uiCopy } from '../../locales'
import { displayWorkoutTitle } from '../training/libraryModel'
import { openTrainingExecution, type ExecutionSnapshot, type TrainingExecution } from '../training/trainingExecution'
import { openTodayRecommendations, type RecommendationRequest, type RecommendationView,
  type TodayRecommendations } from './todayRecommendations'
import { TodayPlanPath } from './TodayPlanPath'
import { deriveCurrentPlanProgress, deriveTodayProvenance } from './todayModel'
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

function RecommendationChoices({ label, options, value, onChoose }: {
  label: string; options: Record<string, string>; value: string; onChoose: (value: string) => void
}) {
  return <fieldset className="today-recommendation__group"><legend>{label}</legend>
    <div className="today-recommendation__chips">{Object.entries(options).map(([key, copy]) =>
      <button key={key} type="button" aria-pressed={value === key}
        onClick={() => onChoose(key)}>{copy}</button>)}</div>
  </fieldset>
}

export function TodayScreen({ execution: supplied, recommendations: suppliedRecommendations }:
  { execution?: TrainingExecution; recommendations?: TodayRecommendations }) {
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
  const [recommendations, setRecommendations] = useState<TodayRecommendations | null>(suppliedRecommendations ?? null)
  const [recommendation, setRecommendation] = useState<RecommendationView | null>(null)
  const [recommendationFlow, setRecommendationFlow] = useState<'IDLE' | 'FORM' | 'RESULT'>('IDLE')
  const [recommendationKind, setRecommendationKind] = useState<'LIBRARY' | 'ACTIVITY'>('LIBRARY')
  const [recommendationRequest, setRecommendationRequest] = useState<RecommendationRequest>({
    mood: 'NORMAL', intensity: 'AUTO', duration: '15_30', novelty: 'MIXED' })
  const [recommendationEmpty, setRecommendationEmpty] = useState(false)

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
    if (supplied && !suppliedRecommendations) return
    let active = true
    void (async () => {
      try {
        const current = suppliedRecommendations ?? await openTodayRecommendations()
        const latest = await current.latest()
        if (active) { setRecommendations(current); setRecommendation(latest); if (latest) {
          setRecommendationKind(latest.recommendationSource === 'EXPLORATION' ? 'ACTIVITY' : 'LIBRARY')
          setRecommendationFlow('RESULT')
        } }
      } catch (cause) { logger.error('Today recommendation load failed', cause) }
    })()
    return () => { active = false }
  }, [supplied, suppliedRecommendations])

  useEffect(() => {
    if (!service) return
    const reload = () => {
      if (document.visibilityState !== 'visible') return
      void service.load().then(setData).catch((cause: unknown) => {
        logger.error('Today training resume failed', cause)
        setError(uiCopy.execution.unavailable)
      })
      if (recommendations) void recommendations.latest().then((latest) => {
        setRecommendation(latest)
        if (latest) setRecommendationKind(latest.recommendationSource === 'EXPLORATION' ? 'ACTIVITY' : 'LIBRARY')
        else setRecommendationFlow('IDLE')
      }).catch((cause: unknown) => logger.error('Today recommendation resume failed', cause))
    }
    document.addEventListener('visibilitychange', reload)
    return () => document.removeEventListener('visibilitychange', reload)
  }, [service, recommendations])

  async function act(work: (current: TrainingExecution) => Promise<void>) {
    if (!service || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await work(service); setData(await service.load())
      if (recommendations) {
        try {
          const latest = await recommendations.latest()
          setRecommendation(latest)
          if (latest) setRecommendationKind(latest.recommendationSource === 'EXPLORATION' ? 'ACTIVITY' : 'LIBRARY')
          else setRecommendationFlow('IDLE')
        } catch (cause) { logger.error('Today recommendation refresh failed', cause) }
      }
    }
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

  async function suggest(kind: 'LIBRARY' | 'ACTIVITY', previousActivityTypeId?: string | null) {
    if (!recommendations || busy) return
    setBusy(true); setError(''); setRecommendationEmpty(false)
    try {
      const next = await recommendations.suggest(recommendationRequest, kind === 'ACTIVITY',
        previousActivityTypeId)
      setRecommendationKind(kind)
      setRecommendation(next)
      setRecommendationEmpty(!next)
      setRecommendationFlow('RESULT')
    } catch (cause) { logger.error('Today recommendation failed', cause); setError(uiCopy.recommendation.error) }
    finally { setBusy(false) }
  }

  async function acceptRecommendation(findNew: boolean) {
    if (!recommendations || !recommendation || busy) return
    setBusy(true); setError('')
    try {
      if (findNew) await recommendations.findNew(recommendation)
      else await recommendations.accept(recommendation)
      setRecommendation({ ...recommendation, status: 'ACCEPTED' })
      if (service) setData(await service.load())
    } catch (cause) { logger.error('Today recommendation acceptance failed', cause); setError(uiCopy.recommendation.error) }
    finally { setBusy(false) }
  }

  async function chooseActivity() {
    if (!recommendations || !recommendation || busy) return
    setBusy(true); setError('')
    try {
      setRecommendation(await recommendations.chooseActivity(recommendation))
      if (service) setData(await service.load())
    } catch (cause) { logger.error('Today activity selection failed', cause); setError(uiCopy.recommendation.error) }
    finally { setBusy(false) }
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
  const provenance = data && service ? deriveTodayProvenance(data, service.today()) : null
  const planProgress = data ? deriveCurrentPlanProgress(data) : null
  const provenanceCopy = provenance?.kind === 'PLAN_ORIGINAL'
    ? `${uiCopy.todayProvenance.planned} · ${uiCopy.todayProvenance.day}${provenance.planDayIndex}${uiCopy.todayProvenance.dayUnit}`
    : provenance?.kind === 'RECOMMENDED_REPLACEMENT' ? uiCopy.todayProvenance.recommendedReplacement
      : provenance?.kind === 'REST_EXTRA' ? uiCopy.todayProvenance.restExtra
        : provenance?.kind === 'TODAY_RECOMMENDED' ? uiCopy.todayProvenance.todayRecommended
          : provenance?.kind === 'MANUAL' ? uiCopy.todayProvenance.manual : null

  return <div className="today-screen">
    <div className="today-feature" data-rest={!!day?.isRestDay && !workout}>
      <div className="today-feature__art" aria-hidden="true">
        <img src={celestialComposition} alt="" />
      </div>
      <header className="today-header"><div><span className="today-header__date">{date}</span>
        <h1>{uiCopy.navigation.today}</h1>
        {provenanceCopy ? <p className="today-header__status">{provenanceCopy}</p>
          : day ? <p className="today-header__status">{day.isRestDay ? uiCopy.todayProvenance.plannedRest
            : uiCopy.execution.planDay}{' · '}{uiCopy.todayProvenance.day}{day.dayIndex}
            {uiCopy.todayProvenance.dayUnit}{future ? ` · ${day.scheduledLocalDate}` : ''}</p> : null}
      </div></header>
    <section className="workout-card" aria-labelledby="today-workout-title"
      data-composition={provenance?.kind ?? 'NONE'}>
      <div className="workout-card__content">
        <span className="eyebrow">{uiCopy.execution.title}</span>
        <h2 id="today-workout-title">{!data ? error || uiCopy.plan.loading
          : session ? uiCopy.execution.inProgress : data.run?.status === 'PAUSED' && !explicit
          ? uiCopy.execution.paused : workout ? displayWorkoutTitle(workout)
            : day?.isRestDay ? uiCopy.execution.rest : uiCopy.execution.noTask}</h2>
        {session && workout ? <p className="workout-card__current-title">{displayWorkoutTitle(workout)}</p> : null}
        {provenance?.kind === 'REST_EXTRA' ? <p className="workout-card__original">
          {uiCopy.todayProvenance.original}{uiCopy.todayProvenance.rest}</p>
          : provenance?.originalWorkout ? <p className="workout-card__original">
            {uiCopy.todayProvenance.original}{displayWorkoutTitle(provenance.originalWorkout)}</p> : null}
        {workout ? <div className="workout-card__meta">
          {workout.durationMinutes !== null ? <span><AppIcon name="clock" />
            {workout.durationMinutes} {uiCopy.training.minutes}</span> : null}
          {intensity ? <span>{intensity}</span> : null}
          <span>{uiCopy.training.sources[workout.sourceType]}</span>
        </div> : null}
        {session ? <p>{uiCopy.execution.startedAt} · {new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(session.startedAt))}</p>
          : workout && (data?.run?.status !== 'PAUSED' || explicit) && (!future || explicit) ? <button
            className="workout-card__start" type="button" aria-label={uiCopy.execution.start} disabled={busy}
            onClick={() => void act(async (current) => { await current.startWorkout(data!) })}>
            <AppIcon name="arrow" /></button> : null}
        {session ? <button className="workout-card__complete" type="button" disabled={busy}
          onClick={() => setFinishStage('CONFIRM')}>
          {uiCopy.execution.complete} <AppIcon name="arrow" /></button> : null}
        {session && sourceUrl ? <a className="workout-card__source" href={sourceUrl} target="_blank"
          rel="noopener noreferrer">{uiCopy.execution.openWorkout}</a> : null}
      </div>
    </section>
    </div>
    {planProgress ? <section className="today-execution__progress" aria-label={uiCopy.currentPlanProgress.title}>
      <div className="today-execution__progress-heading">
        <div><span className="eyebrow">{uiCopy.currentPlanProgress.shortTitle} · {uiCopy.currentPlanProgress.day}
          {' '}{planProgress.position} / {planProgress.totalDays} {uiCopy.currentPlanProgress.dayUnit}</span>
          <strong>{data?.plans.find((item) => item.id === planProgress.planId)?.title}</strong></div>
        <Link to="/training/plan" state={{ from: '/' }}>{uiCopy.execution.viewPlan}<AppIcon name="arrow" /></Link>
      </div>
      <TodayPlanPath progress={planProgress} branch={provenance?.kind === 'RECOMMENDED_REPLACEMENT'
        ? 'REPLACEMENT' : provenance?.kind === 'REST_EXTRA' ? 'REST_EXTRA' : null} />
      <div className="today-execution__progress-stats">
        <span>{uiCopy.currentPlanProgress.complete} {planProgress.completedTraining} / {planProgress.totalTraining} {uiCopy.currentPlanProgress.trainingUnit}</span>
      </div>
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
      <ChoiceSelect label={uiCopy.execution.status} value={status}
        onChange={(value) => setStatus(value as CompletionStatus)}
        options={completionOptions.map((value) => ({ value, label: value === 'COMPLETE'
          ? uiCopy.execution.completeStatus : value === 'MOSTLY_COMPLETE'
            ? uiCopy.execution.mostlyStatus : uiCopy.execution.partialStatus }))} />
      {replacing ? <ChoiceSelect label={uiCopy.execution.equivalence} value={equivalence}
        onChange={(value) => setEquivalence(value as PlanEquivalence | '')} options={[
          { value: '', label: uiCopy.execution.equivalence },
          ...equivalenceOptions.map((value) => ({ value, label: value === 'FULL' ? uiCopy.execution.full
            : value === 'PARTIAL' ? uiCopy.execution.partial : uiCopy.execution.none })),
        ]} /> : null}
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
    {!session && data && recommendations ? <div className="today-interlude" aria-hidden="true">
      <img src={interludeArt} alt="" />
    </div> : null}
    {!session && data && recommendations ? <section className="today-recommendation" aria-label={uiCopy.recommendation.sectionTitle}>
      {recommendationFlow !== 'IDLE' ? <span className="eyebrow">{uiCopy.recommendation.sectionTitle}</span> : null}
      {recommendationFlow === 'IDLE' ? <div className="today-recommendation__actions">
        <button type="button" className="today-recommendation__entry today-recommendation__entry--library"
          disabled={busy} onClick={() => { setRecommendationKind('LIBRARY');
          setRecommendationFlow('FORM'); setRecommendationEmpty(false) }}>
          <span>{uiCopy.recommendation.libraryEntry}</span><AppIcon name="arrow" /></button>
        <button type="button" className="today-recommendation__entry today-recommendation__entry--activity" disabled={busy}
          onClick={() => void suggest('ACTIVITY')}><span>{uiCopy.recommendation.activityEntry}</span>
          <AppIcon name="arrow" /></button>
      </div> : null}
      {recommendationFlow === 'FORM' ? <form className="today-recommendation__form" onSubmit={(event) => {
        event.preventDefault(); void suggest('LIBRARY')
      }}>
        <h2>{uiCopy.recommendation.title}</h2>
        <RecommendationChoices label={uiCopy.recommendation.mood} options={uiCopy.recommendation.moods}
          value={recommendationRequest.mood} onChoose={(value) => setRecommendationRequest({
            ...recommendationRequest, mood: value as RecommendationRequest['mood'] })} />
        <RecommendationChoices label={uiCopy.recommendation.intensity} options={uiCopy.recommendation.intensities}
          value={recommendationRequest.intensity} onChoose={(value) => setRecommendationRequest({
            ...recommendationRequest, intensity: value as RecommendationRequest['intensity'] })} />
        <RecommendationChoices label={uiCopy.recommendation.duration} options={uiCopy.recommendation.durations}
          value={recommendationRequest.duration} onChoose={(value) => setRecommendationRequest({
            ...recommendationRequest, duration: value as RecommendationRequest['duration'] })} />
        <RecommendationChoices label={uiCopy.recommendation.novelty} options={uiCopy.recommendation.novelties}
          value={recommendationRequest.novelty} onChoose={(value) => setRecommendationRequest({
            ...recommendationRequest, novelty: value as RecommendationRequest['novelty'] })} />
        <label className="today-recommendation__checkbox"><input type="checkbox"
          checked={recommendationRequest.equipmentAvailable === false}
          onChange={(event) => setRecommendationRequest({ ...recommendationRequest,
            ...(event.target.checked ? { equipmentAvailable: false } : { equipmentAvailable: true }) })} />
          {uiCopy.recommendation.noEquipment}</label>
        <button type="submit" disabled={busy}>{uiCopy.recommendation.suggest}</button>
        <button type="button" className="today-execution__secondary" onClick={() => setRecommendationFlow('IDLE')}>
          {uiCopy.recommendation.cancel}</button>
      </form> : null}
      {recommendationFlow === 'RESULT' ? <div className="today-recommendation__result" role="status"
        data-inspiration={recommendationKind === 'ACTIVITY' && !recommendation?.workout}>
        {recommendation ? <>
          <span className="eyebrow">{recommendation.workout ? uiCopy.recommendation.result : uiCopy.recommendation.activityResult}</span>
          <h2>{recommendation.workout ? displayWorkoutTitle(recommendation.workout) : recommendation.activityName}</h2>
          {recommendation.result.reasonCodes.length ? <p>{recommendation.result.reasonCodes.map(
            (code) => uiCopy.recommendation.reasons[code]).join(' · ')}</p> : null}
          {recommendation.workout ? <button type="button" disabled={busy || recommendation.status === 'ACCEPTED'}
            onClick={() => void acceptRecommendation(false)}>{recommendation.status === 'ACCEPTED'
              ? uiCopy.recommendation.selected : uiCopy.recommendation.accept}</button>
            : recommendation.status === 'ACCEPTED' ? <p>{uiCopy.recommendation.findHint}</p>
              : <><button type="button" className="today-recommendation__primary" disabled={busy}
                onClick={() => void chooseActivity()}>{uiCopy.recommendation.doActivity}</button>
                <button type="button" className="today-execution__secondary" disabled={busy}
                  onClick={() => void acceptRecommendation(true)}>{uiCopy.recommendation.findNew}</button></>}
        </> : recommendationEmpty ? <p>{uiCopy.recommendation.empty}</p> : null}
        <button type="button" className="today-recommendation__tertiary" disabled={busy}
          onClick={() => void suggest(recommendationKind, recommendationKind === 'ACTIVITY'
            ? recommendation?.result.activityTypeId : null)}>{uiCopy.recommendation.again}</button>
      </div> : null}
    </section> : null}
    <div className="today-execution__links">{!planProgress ? <Link to="/training/plan" state={{ from: '/' }}>
      {uiCopy.execution.viewPlan}</Link> : null}
      <Link to="/training">{uiCopy.execution.selectInLibrary}</Link></div>
  </div>
}
