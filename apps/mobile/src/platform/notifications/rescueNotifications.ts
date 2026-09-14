import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { MotivationRepository } from '../../db/repositories/MotivationRepository'
import { uiCopy } from '../../locales'

function idForDate(date: string): number { return Number(date.replaceAll('-', '')) }
let syncQueue: Promise<void> = Promise.resolve()

async function synchronizeNow(motivation: MotivationRepository): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  // Keep an eligible alarm already pending for today through Android's inexact
  // delivery window. A newly saved time in the past must never be scheduled.
  const desired = await motivation.notificationDates(7, true)
  const desiredIds = new Set(desired.map((item) => idForDate(item.localDate)))
  const pending = (await LocalNotifications.getPending()).notifications
    .filter((item) => item.extra?.motionRescue === true)
  const desiredTimes = new Map(desired.map((item) => [idForDate(item.localDate), item.at.getTime()]))
  const obsolete = pending.filter((item) => !desiredIds.has(item.id)
    || new Date(item.schedule?.at ?? 0).getTime() !== desiredTimes.get(item.id))
  if (obsolete.length) await LocalNotifications.cancel({ notifications: obsolete.map((item) => ({ id: item.id })) })
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return
  const existing = new Set(pending.filter((item) => !obsolete.includes(item)).map((item) => item.id))
  const toSchedule = desired.filter((item) => item.at.getTime() > Date.now()
    && !existing.has(idForDate(item.localDate)))
  if (!toSchedule.length) return
  // Checking the exact-alarm setting is silent. Explicitly choose inexact
  // fallback when denied so a routine app restart never opens Settings.
  const exact = Capacitor.getPlatform() === 'android'
    && (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted'
  await LocalNotifications.schedule({ notifications: toSchedule.map((item) => ({
    id: idForDate(item.localDate), title: uiCopy.motivation.rescueTitle,
    body: uiCopy.motivation.notificationBody, schedule: { at: item.at, allowWhileIdle: true },
    isExactNotification: exact,
    extra: { motionRescue: true, localDate: item.localDate },
  })) })
}

export const rescueNotifications = {
  async requestPermission(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false
    const existing = await LocalNotifications.checkPermissions()
    if (existing.display === 'granted') return true
    return (await LocalNotifications.requestPermissions()).display === 'granted'
  },

  synchronize(motivation: MotivationRepository): Promise<void> {
    const next = syncQueue.then(() => synchronizeNow(motivation))
    syncQueue = next.catch(() => undefined)
    return next
  },

  async listen(onTap: () => void): Promise<() => void> {
    if (!Capacitor.isNativePlatform()) return () => undefined
    const handle = await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      if (event.notification.extra?.motionRescue === true) onTap()
    })
    return () => { void handle.remove() }
  },
}
