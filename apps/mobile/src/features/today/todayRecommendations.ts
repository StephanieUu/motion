import { Capacitor } from '@capacitor/core'
import { addLocalDays, localDateAtStart } from '@motion/domain'
import { modeForContext, recommendActivity, recommendWorkout, type DesiredIntensity,
  type Mood, type Novelty, type RecommendationContext, type RecommendationMode } from '@motion/recommendation'
import { RecommendationRepository, type StoredRecommendation } from '../../db/repositories/RecommendationRepository'
import { MotivationRepository } from '../../db/repositories/MotivationRepository'
import { WorkoutRepository, type LibraryWorkout } from '../../db/repositories/WorkoutRepository'
import type { Database } from '../../db/sqlite/Database'
import { getNativeDatabase } from '../../db/sqlite/nativeDatabase'
import { TrainingExecution } from '../training/trainingExecution'

export interface RecommendationRequest {
  mood: Mood
  intensity: DesiredIntensity
  duration: '5_15' | '15_30' | '30_45' | '45_PLUS'
  novelty: Novelty
  equipmentAvailable?: boolean
}

const durationBands = {
  '5_15': [5, 15], '15_30': [15, 30], '30_45': [30, 45], '45_PLUS': [45, undefined],
} as const

export interface RecommendationView extends StoredRecommendation {
  workout: LibraryWorkout | null
  activityName: string | null
}

export class TodayRecommendations {
  private readonly repository: RecommendationRepository
  private readonly execution: TrainingExecution
  private readonly workouts: WorkoutRepository
  private readonly motivation: MotivationRepository

  constructor(db: Database, private readonly clock: () => Date = () => new Date(),
    private readonly rng: () => number = Math.random) {
    this.repository = new RecommendationRepository(db)
    this.execution = new TrainingExecution(db, clock)
    this.workouts = new WorkoutRepository(db)
    this.motivation = new MotivationRepository(db, clock)
  }

  today(): string { return localDateAtStart(this.clock()) }

  async latest(): Promise<RecommendationView | null> {
    const stored = await this.repository.latest(this.today())
    if (!stored) return null
    const [workouts, context] = await Promise.all([this.workouts.listLibrary(),
      this.repository.context(this.today(), [])])
    const workout = workouts.find((item) => item.id === stored.result.workoutContentId) ?? null
    return { ...stored, result: { ...stored.result, durationMinutes: workout?.durationMinutes ?? null,
      intensity: workout?.estimatedIntensity ?? null }, workout,
      activityName: context.activities.find((item) => item.id === stored.result.activityTypeId)?.name ?? null }
  }

  async suggest(request: RecommendationRequest, inspiration = false,
    previousActivityTypeId?: string | null): Promise<RecommendationView | null> {
    const snapshot = await this.execution.load()
    if (snapshot.session) throw new Error('Finish the current session before changing workout')
    const base = await this.repository.context(this.today(), snapshot.workouts)
    const [durationMin, durationMax] = durationBands[request.duration]
    const activeDay = snapshot.run?.status === 'ACTIVE' && snapshot.currentDay &&
      !snapshot.currentDay.isRestDay && snapshot.currentDay.scheduledLocalDate <= this.today()
      ? snapshot.currentDay : null
    const recentHard = base.recent.some((item) => item.localDate >= addLocalDays(this.today(), -2)
      && item.exertion === 'HARD')
    const context: RecommendationContext = { ...base, mood: request.mood, desiredIntensity: request.intensity,
      durationMin, ...(durationMax !== undefined ? { durationMax } : {}), novelty: request.novelty,
      planActive: !!activeDay, currentWorkoutId: activeDay?.primaryWorkoutId ?? snapshot.mainWorkout?.id ?? null,
      excludedWorkoutIds: snapshot.mainWorkout && snapshot.mainWorkout.id !== activeDay?.primaryWorkoutId
        ? [snapshot.mainWorkout.id] : [],
      recoveryConstrained: recentHard || request.mood === 'TIRED' }
    if (request.equipmentAvailable === false) context.equipmentAvailable = false
    const mode: RecommendationMode = inspiration ? 'EXPLORATION' : modeForContext(context)
    const ideaContext = inspiration && previousActivityTypeId ? { ...context,
      activities: context.activities.filter((item) => item.id !== previousActivityTypeId) } : context
    const idea = inspiration ? recommendActivity(ideaContext, this.rng) : null
    const matchingWorkout = idea?.activityTypeId ? recommendWorkout({ ...context,
      workouts: context.workouts.filter((item) => item.activityTypeId === idea.activityTypeId) },
    'EXPLORATION', this.rng) : null
    const result = inspiration ? matchingWorkout ? { ...matchingWorkout,
      reasonCodes: [...(idea?.reasonCodes ?? []), ...matchingWorkout.reasonCodes.filter(
        (code) => !idea?.reasonCodes.includes(code))].slice(0, 3) } : idea : recommendWorkout(context, mode, this.rng)
    if (!result) return null
    const stored = await this.repository.save(context, result, activeDay && snapshot.run
      ? { runId: snapshot.run.id, originalPlanDayId: activeDay.trainingPlanDayId } : null, inspiration)
    return { ...stored, workout: snapshot.workouts.find((item) => item.id === result.workoutContentId) ?? null,
      activityName: base.activities.find((item) => item.id === result.activityTypeId)?.name ?? null }
  }

  async suggestRescue(): Promise<RecommendationView | null> {
    const state = await this.motivation.state()
    if (!state.rescueActive) return null
    const snapshot = await this.execution.load()
    if (snapshot.session) throw new Error('Finish the current session before changing workout')
    const base = await this.repository.context(this.today(), snapshot.workouts)
    const activeDay = snapshot.run?.status === 'ACTIVE' && snapshot.currentDay &&
      !snapshot.currentDay.isRestDay && snapshot.currentDay.scheduledLocalDate <= this.today()
      ? snapshot.currentDay : null
    const context: RecommendationContext = { ...base, mood: 'TIRED', desiredIntensity: 'LIGHT',
      durationMin: 5, durationMax: 10, novelty: 'FAMILIAR', equipmentAvailable: false,
      planActive: !!activeDay, currentWorkoutId: activeDay?.primaryWorkoutId ?? null,
      recoveryConstrained: true }
    const mode: RecommendationMode = state.neverMissTwice ? 'RESTART' : 'RESCUE'
    const result = recommendWorkout(context, mode, this.rng)
    if (!result) return null
    const stored = await this.repository.save(context, result, activeDay && snapshot.run
      ? { runId: snapshot.run.id, originalPlanDayId: activeDay.trainingPlanDayId } : null)
    return { ...stored, workout: snapshot.workouts.find((item) => item.id === result.workoutContentId) ?? null,
      activityName: base.activities.find((item) => item.id === result.activityTypeId)?.name ?? null }
  }

  async accept(view: RecommendationView): Promise<void> {
    await this.repository.accept(view.id, this.today())
  }

  async findNew(view: RecommendationView): Promise<void> {
    await this.repository.acceptExploration(view.id, this.today())
  }

  async chooseActivity(view: RecommendationView): Promise<RecommendationView> {
    await this.repository.selectActivityAsFreeWorkout(view.id, this.today())
    const selected = await this.latest()
    if (!selected || selected.id !== view.id || !selected.workout) throw new Error('Selected activity is unavailable')
    return selected
  }
}

export async function openTodayRecommendations(): Promise<TodayRecommendations> {
  if (!Capacitor.isNativePlatform()) throw new Error('Recommendations require native SQLite')
  return new TodayRecommendations(await getNativeDatabase())
}
