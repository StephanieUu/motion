import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import type { SourceType, WorkoutPreference, WorkoutVisibility } from '@motion/domain'
import { logger } from '../../app/logger'
import type { LibraryWorkout } from '../../db/repositories/WorkoutRepository'
import { uiCopy } from '../../locales'
import { defaultLibraryFilters, displayWorkoutTitle, filterLibrary, workoutTags,
  type DurationFilter, type HistoryFilter, type LibraryFilters, type PreferenceFilter } from './libraryModel'
import { InvalidWorkoutUrlError, openTrainingLibrary, TrainingLibraryUnavailableError,
  type LibrarySnapshot, type TrainingLibrary } from './trainingLibrary'
import './training.css'

interface TrainingScreenProps { library?: TrainingLibrary | undefined }
type ScreenMode = 'LIST' | 'DETAIL' | 'ADD_URL' | 'ADD_FREE' | 'EDIT'

function TrainingBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <div className="training-library__back-nav">
    <button type="button" className="training-library__back" aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m14.5 5-7 7 7 7" />
      </svg>
    </button>
  </div>
}

const sourceTypes = Object.keys(uiCopy.training.sources) as SourceType[]
const durations = Object.keys(uiCopy.training.durationOptions) as DurationFilter[]
const preferences = Object.keys(uiCopy.training.preferenceOptions) as PreferenceFilter[]
const histories = Object.keys(uiCopy.training.historyOptions) as HistoryFilter[]
const reactions: WorkoutPreference[] = ['LOVE', 'LIKE', 'NEUTRAL', 'DISLIKE']

function displayDate(value: string | null): string {
  if (!value) return uiCopy.training.neverDone
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? uiCopy.training.unknown
    : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

function displayIntensity(value: string | null): string {
  if (!value) return uiCopy.training.unknown
  return uiCopy.training.intensities[value as keyof typeof uiCopy.training.intensities]
    ?? uiCopy.training.unknown
}

function safeSourceUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch { return null }
}

export function TrainingScreen({ library: suppliedLibrary }: TrainingScreenProps) {
  const [library, setLibrary] = useState<TrainingLibrary | null>(suppliedLibrary ?? null)
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mode, setMode] = useState<ScreenMode>('LIST')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<LibraryFilters>(defaultLibraryFilters)
  const [showFilters, setShowFilters] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [freeTitle, setFreeTitle] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editDuration, setEditDuration] = useState('')
  const [editActivityTypeId, setEditActivityTypeId] = useState('')
  const [editIntensity, setEditIntensity] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const listScrollY = useRef(0)

  const goBack = useCallback(() => {
    setMode((current) => current === 'EDIT' ? 'DETAIL' : 'LIST')
    setError('')
    setNotice('')
    setConfirmRemove(false)
  }, [])

  useLayoutEffect(() => {
    const scrollRoot = document.scrollingElement ?? document.documentElement
    scrollRoot.scrollTop = mode === 'LIST' ? listScrollY.current : 0
  }, [mode])

  useEffect(() => {
    if (mode === 'LIST' || !Capacitor.isNativePlatform()) return
    let disposed = false
    let listener: PluginListenerHandle | undefined
    void CapacitorApp.addListener('backButton', goBack).then((handle) => {
      if (disposed) void handle.remove()
      else listener = handle
    }).catch((cause: unknown) => logger.error('Training back listener failed', cause))
    return () => {
      disposed = true
      if (listener) void listener.remove()
    }
  }, [mode, goBack])

  function enterSubview(next: ScreenMode) {
    if (mode === 'LIST') {
      listScrollY.current = (document.scrollingElement ?? document.documentElement).scrollTop
    }
    setMode(next)
  }

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const service = suppliedLibrary ?? await openTrainingLibrary()
        const data = await service.load()
        if (!active) return
        setLibrary(service)
        setSnapshot(data)
        setError('')
      } catch (cause) {
        if (!active) return
        logger.error('Training library load failed', cause)
        setError(cause instanceof TrainingLibraryUnavailableError
          ? uiCopy.training.nativeOnly : uiCopy.training.loadError)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [suppliedLibrary])

  const selected = snapshot?.workouts.find((item) => item.id === selectedId) ?? null
  const visible = useMemo(() => filterLibrary(snapshot?.workouts ?? [], filters), [snapshot, filters])

  async function perform<T>(operation: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    if (!library) return { ok: false }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const value = await operation()
      setSnapshot(await library.load())
      return { ok: true, value }
    } catch (cause) {
      logger.error('Training library operation failed', cause)
      setError(cause instanceof InvalidWorkoutUrlError ? uiCopy.training.invalidUrl : uiCopy.training.saveError)
      return { ok: false }
    } finally {
      setSaving(false)
    }
  }

  function showDetail(workout: LibraryWorkout) {
    setSelectedId(workout.id)
    setConfirmRemove(false)
    setError('')
    enterSubview('DETAIL')
  }

  function openEdit(workout: LibraryWorkout) {
    setEditTitle(workout.title ?? '')
    setEditUrl(workout.sourceUrl ?? '')
    setEditDuration(workout.durationMinutes === null ? '' : String(workout.durationMinutes))
    setEditActivityTypeId(workout.primaryActivityTypeId ?? '')
    setEditIntensity(workout.estimatedIntensity ?? '')
    setError('')
    enterSubview('EDIT')
  }

  async function saveUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!library) return
    const result = await perform(() => library.addUrl(urlInput))
    if (result.ok) { setUrlInput(''); showDetail(result.value); setNotice(uiCopy.training.saved) }
  }

  async function saveFree(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!freeTitle.trim()) { setError(uiCopy.training.nameRequired); return }
    if (!library) return
    const result = await perform(() => library.addFreeActivity(freeTitle))
    if (result.ok) { setFreeTitle(''); showDetail(result.value); setNotice(uiCopy.training.saved) }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!library || !selected) return
    const duration = editDuration.trim() === '' ? null : Number(editDuration)
    if (duration !== null && (!Number.isFinite(duration) || duration < 0)) {
      setError(uiCopy.training.invalidDuration)
      return
    }
    const result = await perform(() => library.update(selected.id, {
      title: editTitle.trim() || null,
      ...(selected.contentKind === 'FOLLOW_ALONG' ? { sourceUrl: editUrl } : {}),
      durationMinutes: duration,
      primaryActivityTypeId: editActivityTypeId || null,
      estimatedIntensity: editIntensity || null,
    }))
    if (result.ok) { setMode('DETAIL'); setNotice(uiCopy.training.saved) }
  }

  async function changePreference(preference: WorkoutPreference) {
    if (!library || !selected) return
    await perform(() => library.setPreference(selected.id,
      selected.userPreference === preference ? null : preference))
  }

  async function changeVisibility(visibility: 'ACTIVE' | 'TEMPORARILY_HIDDEN') {
    if (!library || !selected) return
    await perform(() => library.setVisibility(selected.id, visibility))
  }

  async function removeWorkout() {
    if (!library || !selected) return
    const result = await perform(() => library.remove(selected.id))
    if (!result.ok) return
    setConfirmRemove(false)
    setSelectedId(null)
    setMode('LIST')
    setNotice(result.value === 'archived' ? uiCopy.training.archived : uiCopy.training.deleted)
    if (result.value === 'archived') setFilters({ ...defaultLibraryFilters, visibility: 'ARCHIVED' })
  }

  function setFilter<K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  if (loading) return <section className="training-library" aria-live="polite">{uiCopy.training.loading}</section>
  if (!snapshot || !library) return (
    <section className="training-library training-library__error" role="alert">
      <h1>{error || uiCopy.training.loadError}</h1>
      <button type="button" onClick={() => window.location.reload()}>{uiCopy.training.retry}</button>
    </section>
  )

  return (
    <section className="training-library">
      {mode === 'LIST' ? (
        <>
          <header className="training-library__header">
            <span className="eyebrow">{uiCopy.training.eyebrow}</span>
            <div className="training-library__heading-row">
              <h1>{uiCopy.training.title}</h1>
              <button type="button" className="training-library__add" onClick={() => enterSubview('ADD_URL')}>
                {uiCopy.training.add}</button>
            </div>
            <span className="training-library__header-mark" aria-hidden="true" />
          </header>

          <div className="training-library__views" role="group" aria-label={uiCopy.training.title}>
            {(['ACTIVE', 'TEMPORARILY_HIDDEN', 'ARCHIVED'] as WorkoutVisibility[]).map((visibility) => (
              <button type="button" key={visibility} aria-pressed={filters.visibility === visibility}
                onClick={() => setFilters({ ...defaultLibraryFilters, visibility })}>
                {visibility === 'ACTIVE' ? uiCopy.training.allWorkouts
                  : visibility === 'TEMPORARILY_HIDDEN' ? uiCopy.training.hiddenWorkouts : uiCopy.training.archivedWorkouts}
              </button>
            ))}
          </div>

          <div className="training-library__search-row">
            <label className="training-library__search">
              <span className="sr-only">{uiCopy.training.search}</span>
              <input type="search" value={filters.search} placeholder={uiCopy.training.searchPlaceholder}
                onChange={(event) => setFilter('search', event.target.value)} />
            </label>
            <button type="button" className="training-library__filter-toggle" aria-expanded={showFilters}
              onClick={() => setShowFilters(!showFilters)}>{uiCopy.training.filters}</button>
          </div>

          {showFilters ? (
            <div className="training-library__filters">
              <label>{uiCopy.training.activityType}
                <select value={filters.activityTypeId} onChange={(event) => setFilter('activityTypeId', event.target.value)}>
                  <option value="ALL">{uiCopy.training.all}</option>
                  <option value="UNCLASSIFIED">{uiCopy.training.unclassified}</option>
                  {snapshot.activityTypes.map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}
                </select></label>
              <label>{uiCopy.training.source}
                <select value={filters.sourceType} onChange={(event) => setFilter('sourceType', event.target.value as SourceType | 'ALL')}>
                  <option value="ALL">{uiCopy.training.all}</option>
                  {sourceTypes.map((source) => <option value={source} key={source}>{uiCopy.training.sources[source]}</option>)}
                </select></label>
              <label>{uiCopy.training.duration}
                <select value={filters.duration} onChange={(event) => setFilter('duration', event.target.value as DurationFilter)}>
                  {durations.map((duration) => <option value={duration} key={duration}>{uiCopy.training.durationOptions[duration]}</option>)}
                </select></label>
              <label>{uiCopy.training.preference}
                <select value={filters.preference} onChange={(event) => setFilter('preference', event.target.value as PreferenceFilter)}>
                  {preferences.map((preference) => <option value={preference} key={preference}>{uiCopy.training.preferenceOptions[preference]}</option>)}
                </select></label>
              <label>{uiCopy.training.history}
                <select value={filters.history} onChange={(event) => setFilter('history', event.target.value as HistoryFilter)}>
                  {histories.map((history) => <option value={history} key={history}>{uiCopy.training.historyOptions[history]}</option>)}
                </select></label>
              <button type="button" className="training-library__clear" onClick={() =>
                setFilters({ ...defaultLibraryFilters, visibility: filters.visibility })}>{uiCopy.training.clearFilters}</button>
            </div>
          ) : null}

          {notice ? <p className="training-library__notice" role="status">{notice}</p> : null}
          {error ? <p className="training-library__error" role="alert">{error}</p> : null}
          <div className="training-library__count">{visible.length} {uiCopy.training.countUnit}</div>
          {visible.length ? <div className="training-library__list">
            {visible.map((workout) => <button type="button" className="training-library__card" key={workout.id}
              onClick={() => showDetail(workout)}>
              <span className="training-library__card-source">{uiCopy.training.sources[workout.sourceType]}</span>
              <strong>{displayWorkoutTitle(workout)}</strong>
              <span className="training-library__card-meta">
                {workout.activityTypeName ?? uiCopy.training.unclassified}<span aria-hidden="true"> · </span>
                {workout.durationMinutes === null ? uiCopy.training.durationOptions.UNKNOWN
                  : `${workout.durationMinutes} ${uiCopy.training.minutes}`}
              </span>
              {workout.userPreference ? <span className="training-library__card-reaction"
                aria-label={uiCopy.training.reactionLabels[workout.userPreference]}>
                {uiCopy.training.reactions[workout.userPreference]}</span> : null}
            </button>)}
          </div> : (
            <div className="training-library__empty">
              <span className="training-library__empty-art" aria-hidden="true" />
              <p>{filters.visibility === 'TEMPORARILY_HIDDEN' ? uiCopy.training.emptyHidden
                : filters.visibility === 'ARCHIVED' ? uiCopy.training.emptyArchived
                  : snapshot.workouts.some((item) => item.userVisibility === 'ACTIVE')
                    ? uiCopy.training.noResults : uiCopy.training.empty}</p>
              {filters.visibility === 'ACTIVE' && snapshot.workouts.length === 0 ?
                <button type="button" onClick={() => enterSubview('ADD_URL')}>{uiCopy.training.addUrl}</button> : null}
            </div>
          )}
        </>
      ) : null}

      {mode === 'ADD_URL' || mode === 'ADD_FREE' ? (
        <>
          <TrainingBackButton label={uiCopy.training.back} onClick={goBack} />
          <header className="training-library__subheader"><span className="eyebrow">{uiCopy.training.add}</span>
            <h1>{mode === 'ADD_URL' ? uiCopy.training.addUrl : uiCopy.training.addFree}</h1></header>
          <div className="training-library__mode-switch" role="group" aria-label={uiCopy.training.add}>
            <button type="button" aria-pressed={mode === 'ADD_URL'} onClick={() => { setMode('ADD_URL'); setError('') }}>
              {uiCopy.training.addUrl}</button>
            <button type="button" aria-pressed={mode === 'ADD_FREE'} onClick={() => { setMode('ADD_FREE'); setError('') }}>
              {uiCopy.training.addFree}</button>
          </div>
          <form className="training-library__form" onSubmit={mode === 'ADD_URL' ? saveUrl : saveFree}>
            {mode === 'ADD_URL' ? <>
              <p>{uiCopy.training.urlOnlyHint}</p>
              <label>{uiCopy.training.urlField}
                <input value={urlInput} inputMode="url" autoComplete="url" onChange={(event) => setUrlInput(event.target.value)} />
              </label>
            </> : <label>{uiCopy.training.freeActivityName}
              <input value={freeTitle} onChange={(event) => setFreeTitle(event.target.value)} />
            </label>}
            {error ? <p role="alert" className="training-library__error">{error}</p> : null}
            <button type="submit" disabled={saving}>{uiCopy.training.save}</button>
          </form>
        </>
      ) : null}

      {selected && mode === 'DETAIL' ? (
        <>
          <TrainingBackButton label={uiCopy.training.back} onClick={goBack} />
          <header className="training-library__subheader">
            <span className="eyebrow">{uiCopy.training.details}</span>
            <h1>{displayWorkoutTitle(selected)}</h1>
            <span className="training-library__source-chip">{uiCopy.training.sources[selected.sourceType]}</span>
          </header>
          {notice ? <p role="status" className="training-library__notice">{notice}</p> : null}
          {error ? <p role="alert" className="training-library__error">{error}</p> : null}
          <dl className="training-library__details-grid">
            <div><dt>{uiCopy.training.source}</dt><dd>{uiCopy.training.sources[selected.sourceType]}</dd></div>
            <div><dt>{uiCopy.training.duration}</dt><dd>{selected.durationMinutes === null ? uiCopy.training.unknown
              : `${selected.durationMinutes} ${uiCopy.training.minutes}`}</dd></div>
            <div><dt>{uiCopy.training.activityType}</dt><dd>{selected.activityTypeName ?? uiCopy.training.unclassified}</dd></div>
            <div><dt>{uiCopy.training.intensity}</dt><dd>{displayIntensity(selected.estimatedIntensity)}</dd></div>
            <div><dt>{uiCopy.training.lastDone}</dt><dd>{displayDate(selected.lastCompletedAt)}</dd></div>
            <div><dt>{uiCopy.training.completedCount}</dt><dd>{selected.completionCount} {uiCopy.training.times}</dd></div>
          </dl>
          <div className="training-library__tags">
            <h2>{uiCopy.training.tagsLabel}</h2>
            {workoutTags(selected).length ? <div>{workoutTags(selected).map((tag) => <span key={tag}>{tag}</span>)}</div>
              : <p>{uiCopy.training.noTags}</p>}
          </div>
          {selected.sourceUrl ? <div className="training-library__source-link">
            <span>{uiCopy.training.sourceUrl}</span>
            {safeSourceUrl(selected.sourceUrl) ? <a href={safeSourceUrl(selected.sourceUrl)!} target="_blank" rel="noopener noreferrer">
              {uiCopy.training.openSource}</a> : <span>{selected.sourceUrl}</span>}
          </div> : null}
          <div className="training-library__reaction-panel">
            <h2>{uiCopy.training.preference}</h2>
            {selected.completionCount === 0 ? <p>{uiCopy.training.reactionAfterCompletion}</p>
              : <div className="training-library__reactions" role="group" aria-label={uiCopy.training.preference}>
              {reactions.map((reaction) => <button type="button" key={reaction}
                aria-label={uiCopy.training.reactionLabels[reaction]}
                aria-pressed={selected.userPreference === reaction} disabled={saving}
                onClick={() => void changePreference(reaction)}>{uiCopy.training.reactions[reaction]}</button>)}
              </div>}
          </div>
          <div className="training-library__actions">
            <button type="button" onClick={() => openEdit(selected)}>{uiCopy.training.edit}</button>
            {selected.userVisibility !== 'ARCHIVED' ? <button type="button" disabled={saving}
              onClick={() => void changeVisibility(selected.userVisibility === 'TEMPORARILY_HIDDEN' ? 'ACTIVE' : 'TEMPORARILY_HIDDEN')}>
              {selected.userVisibility === 'TEMPORARILY_HIDDEN' ? uiCopy.training.unhide : uiCopy.training.hide}
            </button> : <button type="button" disabled={saving} onClick={() => void changeVisibility('ACTIVE')}>
              {uiCopy.training.restore}</button>}
            {selected.userVisibility !== 'ARCHIVED' ? <button type="button" className="training-library__danger"
              onClick={() => setConfirmRemove(true)}>{uiCopy.training.remove}</button> : null}
          </div>
          {confirmRemove ? <div className="training-library__confirm" role="group" aria-label={uiCopy.training.remove}>
            <p>{uiCopy.training.removeHint}</p>
            <button type="button" disabled={saving} onClick={() => void removeWorkout()}>{uiCopy.training.confirmRemove}</button>
            <button type="button" onClick={() => setConfirmRemove(false)}>{uiCopy.training.cancel}</button>
          </div> : null}
        </>
      ) : null}

      {selected && mode === 'EDIT' ? (
        <>
          <TrainingBackButton label={uiCopy.training.backToDetail} onClick={goBack} />
          <header className="training-library__subheader"><span className="eyebrow">{uiCopy.training.details}</span>
            <h1>{uiCopy.training.edit}</h1></header>
          <form className="training-library__form" onSubmit={saveEdit}>
            <label>{uiCopy.training.titleField}
              <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label>
            {selected.contentKind === 'FOLLOW_ALONG' ? <label>{uiCopy.training.urlField}
              <input value={editUrl} inputMode="url" onChange={(event) => setEditUrl(event.target.value)} /></label> : null}
            <label>{uiCopy.training.duration}
              <input type="number" min="0" step="any" value={editDuration}
                onChange={(event) => setEditDuration(event.target.value)} /></label>
            <label>{uiCopy.training.activityType}
              <select value={editActivityTypeId} onChange={(event) => setEditActivityTypeId(event.target.value)}>
                <option value="">{uiCopy.training.unclassified}</option>
                {snapshot.activityTypes.map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}
              </select></label>
            <label>{uiCopy.training.intensity}
              <select value={editIntensity} onChange={(event) => setEditIntensity(event.target.value)}>
                <option value="">{uiCopy.training.unknown}</option>
                {Object.entries(uiCopy.training.intensities).map(([value, label]) =>
                  <option value={value} key={value}>{label}</option>)}</select></label>
            {error ? <p role="alert" className="training-library__error">{error}</p> : null}
            <button type="submit" disabled={saving}>{uiCopy.training.save}</button>
          </form>
        </>
      ) : null}
    </section>
  )
}
