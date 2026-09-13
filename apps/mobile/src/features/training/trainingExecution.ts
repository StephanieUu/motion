import { Capacitor } from '@capacitor/core'
import { localDateAtStart, type CompletionStatus, type PlanDayInput, type PlanEquivalence,
  type TrainingPlan, type TrainingSession } from '@motion/domain'
import { TrainingPlanRepository, type PlanRun, type PlanRunDayView } from '../../db/repositories/TrainingPlanRepository'
import { TrainingSessionRepository, type SessionFeedback } from '../../db/repositories/TrainingSessionRepository'
import { WorkoutImportRepository } from '../../db/repositories/WorkoutImportRepository'
import { WorkoutRepository, type LibraryWorkout } from '../../db/repositories/WorkoutRepository'
import type { Database } from '../../db/sqlite/Database'
import { getNativeDatabase } from '../../db/sqlite/nativeDatabase'

export interface ExecutionSnapshot {
  plans: TrainingPlan[]
  run: PlanRun | null
  runDays: PlanRunDayView[]
  currentDay: PlanRunDayView | null
  workouts: LibraryWorkout[]
  pendingWorkoutId: string | null
  mainWorkout: LibraryWorkout | null
  session: TrainingSession | null
}

export class TrainingExecution {
  readonly plans: TrainingPlanRepository
  readonly sessions: TrainingSessionRepository
  private readonly imports: WorkoutImportRepository
  private readonly workouts: WorkoutRepository

  constructor(db: Database, private readonly clock: () => Date = () => new Date()) {
    this.plans = new TrainingPlanRepository(db)
    this.sessions = new TrainingSessionRepository(db)
    this.imports = new WorkoutImportRepository(db)
    this.workouts = new WorkoutRepository(db)
  }

  today(): string { return localDateAtStart(this.clock()) }

  async load(): Promise<ExecutionSnapshot> {
    const today = this.today()
    await this.plans.reconcileMissed(today)
    const [plans, run, workouts, pendingWorkoutId, session] = await Promise.all([
      this.plans.listPlans(), this.plans.getCurrentRun(), this.workouts.listLibrary(),
      this.imports.pendingToday(today), this.sessions.getInProgress(),
    ])
    const runDays = run ? await this.plans.getRunDayViews(run.id) : []
    const currentDay = [...runDays].filter((day) => day.status === 'SCHEDULED' || day.status === 'IN_PROGRESS')
      .sort((a, b) => a.scheduledLocalDate.localeCompare(b.scheduledLocalDate))[0] ?? null
    const selectablePending = workouts.find((workout) => workout.id === pendingWorkoutId && workout.userVisibility !== 'ARCHIVED')
    const chosenId = session?.workoutContentId ?? selectablePending?.id ?? currentDay?.primaryWorkoutId ?? null
    const mainWorkout = workouts.find((workout) => workout.id === chosenId && workout.userVisibility !== 'ARCHIVED') ?? null
    return { plans, run, runDays, currentDay, workouts, pendingWorkoutId: selectablePending?.id ?? null, mainWorkout, session }
  }

  async createPlan(title: string, days: PlanDayInput[]): Promise<TrainingPlan> {
    if (days.some((day) => !day.isRestDay && day.items?.filter((item) => item.role === 'PRIMARY').length !== 1)) {
      throw new Error('Each training day needs one primary workout')
    }
    return this.plans.create({ title, sourceType: 'MANUAL', days })
  }

  async startPlan(planId: string): Promise<string> { return this.plans.startRun(planId, this.today()) }
  async pause(runId: string): Promise<void> { return this.plans.pause(runId, this.clock()) }
  async resume(runId: string): Promise<void> { return this.plans.resume(runId, this.today()) }
  async end(runId: string): Promise<void> { return this.plans.end(runId) }
  async completeRun(runId: string): Promise<void> { return this.plans.completeRun(runId) }
  async reschedule(dayId: string, date: string): Promise<void> { return this.plans.reschedule(dayId, date) }
  async skip(dayId: string): Promise<void> { return this.plans.skip(dayId) }
  async rest(dayId: string): Promise<void> { return this.plans.completePlannedRest(dayId, this.today()) }
  async swapRest(restId: string, otherId: string): Promise<void> { return this.plans.swapPlannedRest(restId, otherId) }

  async selectWorkout(id: string): Promise<void> { return this.imports.selectToday(id, this.today()) }

  async startWorkout(snapshot: ExecutionSnapshot): Promise<TrainingSession> {
    if (snapshot.session) return snapshot.session
    const day = snapshot.currentDay
    const workout = snapshot.mainWorkout
    if (!workout && !(day && !day.isRestDay)) throw new Error('No workout selected')
    const explicit = !!workout && snapshot.pendingWorkoutId === workout.id
    if (snapshot.run?.status === 'PAUSED' && !explicit) throw new Error('Plan is paused')
    if (day && day.scheduledLocalDate > this.today() && !explicit) throw new Error('Training day has not arrived')
    const planDayId = day && !day.isRestDay && day.scheduledLocalDate <= this.today()
      && snapshot.run?.status === 'ACTIVE' ? day.id : undefined
    const replacing = !!planDayId && !!workout && workout.id !== day?.primaryWorkoutId
    return this.sessions.start({ ...(workout ? { workoutContentId: workout.id } : {}),
      ...(workout?.primaryActivityTypeId ? { activityTypeId: workout.primaryActivityTypeId } : {}),
      ...(planDayId ? { trainingPlanRunDayId: planDayId } : {}),
      sessionOrigin: planDayId && !replacing ? 'PLAN' : workout?.contentKind === 'FREE_ACTIVITY'
        ? 'FREE_ACTIVITY' : 'EXISTING_LIBRARY', startedAt: this.clock() })
  }

  async completeWorkout(sessionId: string, durationMinutes: number, completionStatus: CompletionStatus,
    planEquivalence?: PlanEquivalence): Promise<TrainingSession> {
    return this.sessions.complete(sessionId, { durationMinutes, completionStatus,
      ...(planEquivalence ? { planEquivalence } : {}), endedAt: this.clock() })
  }

  async abandonWorkout(sessionId: string): Promise<TrainingSession> { return this.sessions.abandon(sessionId) }
  async saveFeedback(sessionId: string, feedback: SessionFeedback): Promise<void> {
    return this.sessions.saveFeedback(sessionId, feedback)
  }
}

export async function openTrainingExecution(): Promise<TrainingExecution> {
  if (!Capacitor.isNativePlatform()) throw new Error('Training execution requires native SQLite')
  return new TrainingExecution(await getNativeDatabase())
}
