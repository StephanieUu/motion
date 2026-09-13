import { useEffect, useRef, useState } from 'react'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'

import { AppShell } from '../components/AppShell'
import { BodyScreen } from '../features/body/BodyScreen'
import { FoodScreen } from '../features/food/FoodScreen'
import { MeScreen } from '../features/me/MeScreen'
import { TodayScreen } from '../features/today/TodayScreen'
import { TrainingScreen } from '../features/training/TrainingScreen'
import { TrainingPlanScreen } from '../features/training/TrainingPlanScreen'
import { openTrainingLibrary, type TrainingLibrary } from '../features/training/trainingLibrary'
import type { WorkoutImportResult } from '../db/repositories/WorkoutImportRepository'
import type { SharedWorkoutPayload } from '@motion/integrations'
import { MotionShare } from '../platform/share/motionShare'
import { logger } from './logger'

interface AppProps { trainingLibrary?: TrainingLibrary }

export function App({ trainingLibrary }: AppProps) {
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  const [importResult, setImportResult] = useState<WorkoutImportResult | null>(null)

  useEffect(() => { navigateRef.current = navigate }, [navigate])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let disposed = false
    let listener: PluginListenerHandle | undefined
    const inFlight = new Set<string>()
    async function handle(share: SharedWorkoutPayload) {
      if (!share?.eventId || inFlight.has(share.eventId)) return
      inFlight.add(share.eventId)
      try {
        const library = trainingLibrary ?? await openTrainingLibrary()
        const result = await library.importShare(share)
        try { await MotionShare.acknowledgeShare({ eventId: share.eventId }) }
        catch (cause) { logger.error('Share acknowledgement failed', cause) }
        if (!disposed) {
          setImportResult(result)
          navigateRef.current('/training')
        }
      } catch (cause) {
        logger.error('Share import failed', cause)
      } finally {
        inFlight.delete(share.eventId)
      }
    }
    void (async () => {
      try {
        listener = await MotionShare.addListener('shareReceived', (share) => { void handle(share) })
        if (disposed) { await listener.remove(); return }
        const pending = await MotionShare.getPendingShares()
        for (const share of pending.shares) await handle(share)
      } catch (cause) { logger.error('Share bridge initialization failed', cause) }
    })()
    return () => { disposed = true; if (listener) void listener.remove() }
  }, [trainingLibrary])

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<TodayScreen />} />
        <Route path="/training" element={<TrainingScreen library={trainingLibrary} importResult={importResult}
          onImportResultDismiss={() => setImportResult(null)} />} />
        <Route path="/training/plan" element={<TrainingPlanScreen />} />
        <Route path="/food" element={<FoodScreen />} />
        <Route path="/body" element={<BodyScreen />} />
        <Route path="/me" element={<MeScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
