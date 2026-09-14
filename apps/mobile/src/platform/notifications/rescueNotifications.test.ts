import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { MotivationRepository } from '../../db/repositories/MotivationRepository'
import { rescueNotifications } from './rescueNotifications'

vi.mock('@capacitor/core', () => ({ Capacitor: {
  isNativePlatform: vi.fn(() => true), getPlatform: vi.fn(() => 'android'),
} }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {
  getPending: vi.fn(), cancel: vi.fn(), checkPermissions: vi.fn(),
  checkExactNotificationSetting: vi.fn(), schedule: vi.fn(), requestPermissions: vi.fn(),
} }))

interface Candidate { localDate: string; at: Date }
interface Pending { id: number; title: string; body: string; schedule: { at: Date };
  extra: { motionRescue: boolean; localDate: string } }
const at = (day: number, hour = 14, minute = 30) => new Date(2026, 8, day, hour, minute)
const pendingFor = (atTime: Date): Pending => ({ id: 20260916, title: 'Rescue', body: 'Motion',
  schedule: { at: atTime }, extra: { motionRescue: true, localDate: '2026-09-16' } })
function repository(candidates: Candidate[]): MotivationRepository {
  return { notificationDates: vi.fn(async () => candidates) } as unknown as MotivationRepository
}

let pending: Pending[]
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at(16, 14, 20))
  pending = []
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
  vi.mocked(LocalNotifications.getPending).mockImplementation(async () => ({ notifications: pending }))
  vi.mocked(LocalNotifications.cancel).mockImplementation(async ({ notifications }) => {
    const ids = new Set(notifications.map((item) => item.id))
    pending = pending.filter((item) => !ids.has(item.id))
  })
  vi.mocked(LocalNotifications.schedule).mockImplementation(async ({ notifications }) => {
    pending.push(...notifications.map((item) => ({ id: item.id, title: item.title, body: item.body,
      schedule: { at: item.schedule!.at! },
      extra: { motionRescue: true, localDate: String(item.extra!.localDate) } })))
    return { notifications: notifications.map((item) => ({ id: item.id })) }
  })
  vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' })
  vi.mocked(LocalNotifications.checkExactNotificationSetting).mockResolvedValue({ exact_alarm: 'denied' })
})
afterEach(() => { vi.useRealTimers() })

describe('Rescue Android pending reconciliation', () => {
  it('schedules an eligible future local reminder once using the date id and inexact fallback', async () => {
    const motivation = repository([{ localDate: '2026-09-16', at: at(16) }])
    await rescueNotifications.synchronize(motivation)
    expect(motivation.notificationDates).toHaveBeenCalledWith(7, true)
    expect(LocalNotifications.schedule).toHaveBeenCalledWith({ notifications: [expect.objectContaining({
      id: 20260916, isExactNotification: false, schedule: { at: at(16), allowWhileIdle: true },
      extra: { motionRescue: true, localDate: '2026-09-16' },
    })] })
    expect(pending).toHaveLength(1)
    await rescueNotifications.synchronize(motivation)
    expect(LocalNotifications.schedule).toHaveBeenCalledTimes(1)
    expect(LocalNotifications.cancel).not.toHaveBeenCalled()
  })

  it('keeps an eligible inexact alarm pending after its nominal time', async () => {
    const motivation = repository([{ localDate: '2026-09-16', at: at(16) }])
    await rescueNotifications.synchronize(motivation)
    vi.setSystemTime(at(16, 14, 35))
    await rescueNotifications.synchronize(motivation)
    expect(LocalNotifications.cancel).not.toHaveBeenCalled()
    expect(LocalNotifications.schedule).toHaveBeenCalledTimes(1)
    expect(pending).toHaveLength(1)
  })

  it('does not schedule an already elapsed time that was never pending', async () => {
    vi.setSystemTime(at(16, 14, 35))
    await rescueNotifications.synchronize(repository([{ localDate: '2026-09-16', at: at(16) }]))
    expect(LocalNotifications.schedule).not.toHaveBeenCalled()
  })

  it('cancels a pending alarm when repository eligibility disappears', async () => {
    pending = [pendingFor(at(16))]
    await rescueNotifications.synchronize(repository([]))
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 20260916 }] })
    expect(pending).toEqual([])
  })

  it('replaces a pending alarm when the configured local time changes', async () => {
    pending = [pendingFor(at(16))]
    await rescueNotifications.synchronize(repository([{ localDate: '2026-09-16', at: at(16, 15) }]))
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 20260916 }] })
    expect(pending).toEqual([{ ...pendingFor(at(16, 15)), title: expect.any(String), body: expect.any(String) }])
  })

  it('reconciles a device date change and the plugin local-time pending format', async () => {
    pending = [{ ...pendingFor(at(14)), id: 20260914,
      extra: { motionRescue: true, localDate: '2026-09-14' } }]
    await rescueNotifications.synchronize(repository([{ localDate: '2026-09-16', at: at(16) }]))
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 20260914 }] })
    expect(pending.map((item) => item.id)).toEqual([20260916])
    pending[0]!.schedule.at = at(16).toString() as unknown as Date
    await rescueNotifications.synchronize(repository([{ localDate: '2026-09-16', at: at(16) }]))
    expect(LocalNotifications.schedule).toHaveBeenCalledTimes(1)
    expect(LocalNotifications.cancel).toHaveBeenCalledTimes(1)
  })

  it('does not schedule when notification permission is denied', async () => {
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'denied' })
    await rescueNotifications.synchronize(repository([{ localDate: '2026-09-16', at: at(16) }]))
    expect(LocalNotifications.schedule).not.toHaveBeenCalled()
  })

  it('does not request a permission already granted on Android 15', async () => {
    expect(await rescueNotifications.requestPermission()).toBe(true)
    expect(LocalNotifications.requestPermissions).not.toHaveBeenCalled()
  })

  it('returns denied when Android refuses notification permission', async () => {
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'denied' })
    vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'denied' })
    expect(await rescueNotifications.requestPermission()).toBe(false)
  })
})
