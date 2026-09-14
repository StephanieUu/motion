import { useEffect, useState, type FormEvent } from 'react'
import { Capacitor } from '@capacitor/core'
import { MotivationRepository, type MotivationState } from '../../db/repositories/MotivationRepository'
import { getNativeDatabase } from '../../db/sqlite/nativeDatabase'
import { rescueNotifications } from '../../platform/notifications/rescueNotifications'
import { uiCopy } from '../../locales'
import { logger } from '../../app/logger'
import './me.css'

function toTime(minutes: number | null): string {
  const value = minutes ?? 18 * 60
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

export function MeScreen({ motivation: supplied }: { motivation?: MotivationRepository }) {
  const [repository, setRepository] = useState<MotivationRepository | null>(supplied ?? null)
  const [state, setState] = useState<MotivationState | null>(null)
  const [time, setTime] = useState('18:00')
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (supplied || !Capacitor.isNativePlatform()) return
    let active = true
    void getNativeDatabase().then((db) => {
      if (active) setRepository(new MotivationRepository(db))
    }).catch((cause: unknown) => logger.error('Reminder settings load failed', cause))
    return () => { active = false }
  }, [supplied])

  useEffect(() => {
    if (!repository) return
    let active = true
    const load = () => void repository.state().then((next) => {
      if (!active) return
      setState(next)
      setTime(toTime(next.rescueTime))
      setEnabled(next.notificationsEnabled)
    }).catch((cause: unknown) => logger.error('Reminder settings state failed', cause))
    load()
    document.addEventListener('visibilitychange', load)
    return () => { active = false; document.removeEventListener('visibilitychange', load) }
  }, [repository])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!repository || !state || busy) return
    setBusy(true); setNotice('')
    try {
      const [hour, minute] = time.split(':').map(Number)
      const minuteOfDay = hour! * 60 + minute!
      let notificationsEnabled = enabled
      if (enabled)
        notificationsEnabled = await rescueNotifications.requestPermission()
      await repository.configureRescue(minuteOfDay, notificationsEnabled)
      setState(await repository.state())
      setEnabled(notificationsEnabled)
      await rescueNotifications.synchronize(repository)
      setNotice(enabled && !notificationsEnabled ? uiCopy.motivation.permissionDenied : uiCopy.me.reminderSaved)
    } catch (cause) {
      logger.error('Reminder settings save failed', cause)
      setNotice(uiCopy.execution.error)
    } finally { setBusy(false) }
  }

  return <div className="me-screen">
    <header className="me-screen__header"><span className="eyebrow">{uiCopy.placeholders.me.eyebrow}</span>
      <h1>{uiCopy.placeholders.me.title}</h1><span className="motif-profile" aria-hidden="true" /></header>
    {state ? <section className="me-reminders" aria-labelledby="me-reminders-title">
      <h2 id="me-reminders-title">{uiCopy.me.remindersTitle}</h2>
      <form onSubmit={(event) => void save(event)}>
        <label className="me-reminders__toggle"><span>{uiCopy.motivation.notifications}</span>
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /></label>
        <label className="me-reminders__time">{uiCopy.motivation.rescueTime}
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
        <button type="submit" disabled={busy}>{uiCopy.motivation.saveTime}</button>
      </form>
      {notice ? <p role="status">{notice}</p> : null}
    </section> : null}
  </div>
}
