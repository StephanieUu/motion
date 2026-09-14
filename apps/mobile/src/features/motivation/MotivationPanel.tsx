import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { MotivationRepository, type MotivationState } from '../../db/repositories/MotivationRepository'
import { getNativeDatabase } from '../../db/sqlite/nativeDatabase'
import { rescueNotifications } from '../../platform/notifications/rescueNotifications'
import { uiCopy } from '../../locales'
import { logger } from '../../app/logger'
import './motivation.css'

export function MotivationPanel({ motivation: supplied, refreshKey, sessionActive, onVideo, onMiniRoutine, onPostpone, onRest }:
  { motivation?: MotivationRepository; refreshKey: number; sessionActive: boolean;
    onVideo: () => Promise<void>; onMiniRoutine: () => Promise<void>;
    onPostpone: () => Promise<void>; onRest: () => Promise<void> }) {
  const [repository, setRepository] = useState<MotivationRepository | null>(supplied ?? null)
  const [state, setState] = useState<MotivationState | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (supplied || !Capacitor.isNativePlatform()) return
    let active = true
    void getNativeDatabase().then((db) => {
      if (active) setRepository(new MotivationRepository(db))
    }).catch((cause: unknown) => logger.error('Motivation load failed', cause))
    return () => { active = false }
  }, [supplied])

  useEffect(() => {
    if (!repository) return
    let active = true
    const load = () => void repository.state().then((next) => {
      if (!active) return
      setState(next)
      void rescueNotifications.synchronize(repository)
        .catch((cause: unknown) => logger.error('Rescue notification sync failed', cause))
    }).catch((cause: unknown) => logger.error('Motivation state failed', cause))
    load()
    document.addEventListener('visibilitychange', load)
    return () => { active = false; document.removeEventListener('visibilitychange', load) }
  }, [repository, refreshKey])

  async function run(action: () => Promise<void>) {
    if (!repository || busy) return
    setBusy(true); setNotice('')
    try { await action(); setState(await repository.state()); await rescueNotifications.synchronize(repository) }
    catch { setNotice(uiCopy.execution.error) }
    finally { setBusy(false) }
  }

  if (!state) return null
  const copy = uiCopy.motivation
  return <section className="motivation" aria-label={copy.title}>
    <div className="motivation__summary">
      <div className="motivation__week"><span>{copy.weeklyGoal}</span>
        <strong>{state.weeklyGoal.achieved} / {state.weeklyGoal.target}</strong>
        <div className="motivation__week-nodes" aria-hidden="true">
          {Array.from({ length: state.weeklyGoal.target }, (_, index) => <i key={index}
            className={index < state.weeklyGoal.achieved ? 'is-lit' : ''} />)}</div></div>
      <div className="motivation__streak"><span>{copy.streakCompact}</span>
        <strong>{state.currentStreak} <small>{copy.dayUnit}</small></strong></div>
    </div>
    {state.protectionBalance > 0 ? <div className={`motivation__protection${state.protectionEligibleDate ? ' is-actionable' : ''}`}>
      <span className="motivation__moon" aria-hidden="true" />
      <div><span>{copy.protection}</span><strong>{copy.protectionAvailable}</strong></div>
      {state.protectionEligibleDate ? <button type="button" disabled={busy}
        onClick={() => void run(async () => { await repository!.useProtection(state.protectionEligibleDate!);
          setNotice(copy.protectionUsed) })}>{state.protectionEligibleDate === state.localDate
            ? copy.useProtectionToday : copy.useProtection}</button> : null}</div> : null}
    {state.rescueActive && !sessionActive ? <div className="motivation__rescue">
      <h2>{copy.rescueTitle}</h2>
      <p>{copy.rescueHint}</p>
      <div className="motivation__actions">
        <button type="button" disabled={busy} onClick={() => void run(onVideo)}>{copy.rescueVideo}</button>
        <button type="button" disabled={busy} onClick={() => void run(onMiniRoutine)}>{copy.miniRoutine}</button>
        <button type="button" disabled={busy} onClick={() => void run(onPostpone)}>{copy.postpone}</button>
        <button type="button" disabled={busy} onClick={() => void run(onRest)}>{copy.rest}</button>
      </div></div> : null}
    {notice ? <p className="motivation__notice" role="status">{notice}</p> : null}
  </section>
}
