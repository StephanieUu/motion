import { useEffect, useRef, useState } from 'react'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { AppShell } from '../components/AppShell'
import { BodyScreen } from '../features/body/BodyScreen'
import { FoodScreen } from '../features/food/FoodScreen'
import { NutritionProfileScreen, NutritionReferenceScreen } from '../features/food/NutritionReferenceScreen'
import { NutritionPlanManagementScreen, NutritionPlanSelectionScreen } from '../features/food/NutritionPlanScreens'
import { OnboardingFlow } from '../features/onboarding/OnboardingFlow'
import { openOnboardingService, type OnboardingService } from '../features/onboarding/onboardingService'
import { MeScreen } from '../features/me/MeScreen'
import { TodayScreen } from '../features/today/TodayScreen'
import { TrainingScreen } from '../features/training/TrainingScreen'
import { TrainingPlanScreen } from '../features/training/TrainingPlanScreen'
import { openTrainingLibrary, type TrainingLibrary } from '../features/training/trainingLibrary'
import type { WorkoutImportResult } from '../db/repositories/WorkoutImportRepository'
import type { SharedWorkoutPayload } from '@motion/integrations'
import { MotionShare } from '../platform/share/motionShare'
import { rescueNotifications } from '../platform/notifications/rescueNotifications'
import { MotivationRepository } from '../db/repositories/MotivationRepository'
import { getNativeDatabase } from '../db/sqlite/nativeDatabase'
import { logger } from './logger'

interface AppProps { trainingLibrary?: TrainingLibrary; onboardingService?: OnboardingService }

export function App({ trainingLibrary, onboardingService }: AppProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const navigateRef = useRef(navigate)
  const [importResult, setImportResult] = useState<WorkoutImportResult | null>(null)
  const [onboarding, setOnboarding] = useState<'LOADING' | 'SHOW' | 'HIDE'>(() =>
    onboardingService || Capacitor.isNativePlatform() ? 'LOADING' : 'HIDE')
  const [activeOnboardingService, setActiveOnboardingService] = useState<OnboardingService | null>(onboardingService ?? null)

  useEffect(() => { navigateRef.current = navigate }, [navigate])

  useEffect(() => {
    if (!onboardingService && !Capacitor.isNativePlatform()) return
    let active = true
    void (async () => {
      try { const current = onboardingService ?? await openOnboardingService(); if (!active) return
        setActiveOnboardingService(current); setOnboarding(await current.status() === 'PENDING' ? 'SHOW' : 'HIDE') }
      catch (cause) { logger.error('Onboarding state load failed', cause); if (active) setOnboarding('HIDE') }
    })()
    return () => { active = false }
  }, [onboardingService])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let disposed = false
    let removeTap: (() => void) | undefined
    const synchronize = () => {
      if (document.visibilityState !== 'visible') return
      void getNativeDatabase().then((db) => rescueNotifications.synchronize(new MotivationRepository(db)))
        .catch((cause: unknown) => logger.error('Rescue notification sync failed', cause))
    }
    void rescueNotifications.listen(() => navigateRef.current('/')).then((remove) => {
      if (disposed) remove()
      else removeTap = remove
    }).catch((cause: unknown) => logger.error('Rescue notification listener failed', cause))
    synchronize()
    document.addEventListener('visibilitychange', synchronize)
    window.addEventListener('motion:training-changed', synchronize)
    return () => { disposed = true; removeTap?.(); document.removeEventListener('visibilitychange', synchronize)
      window.removeEventListener('motion:training-changed', synchronize) }
  }, [])

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

  if (onboarding === 'LOADING') return <main className="onboarding-loading" aria-label="正在打开 Motion" />
  if (onboarding === 'SHOW' && activeOnboardingService) return <OnboardingFlow service={activeOnboardingService}
    onExit={() => setOnboarding('HIDE')} />

  if (location.pathname.startsWith('/food/reference') || location.pathname.startsWith('/food/profile') ||
    location.pathname.startsWith('/food/plan')) return <Routes>
    <Route path="/food/reference" element={<NutritionReferenceScreen />} />
    <Route path="/food/profile" element={<NutritionProfileScreen />} />
    <Route path="/food/plan" element={<NutritionPlanManagementScreen />} />
    <Route path="/food/plan/select" element={<NutritionPlanSelectionScreen />} />
  </Routes>

  return <AppShell>
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
}
