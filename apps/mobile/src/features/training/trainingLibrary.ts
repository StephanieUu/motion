import { Capacitor } from '@capacitor/core'
import type { SourceType, WorkoutPreference, WorkoutVisibility } from '@motion/domain'
import { ActivityRepository, type ActivityType } from '../../db/repositories/ActivityRepository'
import { WorkoutRepository, type LibraryWorkout, type NewWorkout } from '../../db/repositories/WorkoutRepository'
import { getNativeDatabase } from '../../db/sqlite/nativeDatabase'
import type { Database } from '../../db/sqlite/Database'
import { WorkoutImportRepository, type WorkoutImportResult } from '../../db/repositories/WorkoutImportRepository'
import { localDateAtStart } from '@motion/domain'
import type { SharedWorkoutPayload } from '@motion/integrations'

export interface LibrarySnapshot {
  workouts: LibraryWorkout[]
  activityTypes: ActivityType[]
  pendingTodayWorkoutId: string | null
}

export interface WorkoutDetailsChange {
  title: string | null
  sourceUrl?: string | null
  durationMinutes: number | null
  primaryActivityTypeId: string | null
  estimatedIntensity: string | null
}

export interface TrainingLibrary {
  load(): Promise<LibrarySnapshot>
  addUrl(url: string): Promise<LibraryWorkout>
  addFreeActivity(title: string): Promise<LibraryWorkout>
  update(id: string, changes: WorkoutDetailsChange): Promise<void>
  setPreference(id: string, preference: WorkoutPreference | null): Promise<void>
  setVisibility(id: string, visibility: Extract<WorkoutVisibility, 'ACTIVE' | 'TEMPORARILY_HIDDEN'>): Promise<void>
  remove(id: string): Promise<'deleted' | 'archived'>
  importShare(payload: SharedWorkoutPayload): Promise<WorkoutImportResult>
  selectToday(id: string): Promise<void>
}

export class InvalidWorkoutUrlError extends Error {
  constructor() { super('A valid HTTP or HTTPS workout URL is required') }
}

export class TrainingLibraryUnavailableError extends Error {
  constructor() { super('Training library requires native SQLite') }
}

export function parseWorkoutUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new InvalidWorkoutUrlError()
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new InvalidWorkoutUrlError()
  return url
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

export function sourceTypeFromUrl(url: URL): SourceType {
  const host = url.hostname.toLowerCase()
  if (hostMatches(host, 'bilibili.com') || hostMatches(host, 'b23.tv')) return 'BILIBILI'
  if (hostMatches(host, 'xiaohongshu.com') || hostMatches(host, 'xhslink.com')) return 'XIAOHONGSHU'
  if (hostMatches(host, 'quark.cn')) return 'QUARK'
  if (hostMatches(host, 'youtube.com') || hostMatches(host, 'youtu.be')) return 'YOUTUBE'
  return 'WEB'
}

export class SqliteTrainingLibrary implements TrainingLibrary {
  private readonly workouts: WorkoutRepository
  private readonly activities: ActivityRepository
  private readonly imports: WorkoutImportRepository

  constructor(db: Database) {
    this.workouts = new WorkoutRepository(db)
    this.activities = new ActivityRepository(db)
    this.imports = new WorkoutImportRepository(db)
  }

  async load(): Promise<LibrarySnapshot> {
    const [workouts, activityTypes, pendingTodayWorkoutId] = await Promise.all([
      this.workouts.listLibrary(), this.activities.listTypes(),
      this.imports.pendingToday(localDateAtStart(new Date())),
    ])
    return { workouts, activityTypes, pendingTodayWorkoutId }
  }

  async addUrl(input: string): Promise<LibraryWorkout> {
    const url = parseWorkoutUrl(input)
    const workout = await this.workouts.create({ contentKind: 'FOLLOW_ALONG',
      sourceType: sourceTypeFromUrl(url), sourceUrl: url.toString() })
    return (await this.workouts.listLibrary()).find((item) => item.id === workout.id)!
  }

  async addFreeActivity(title: string): Promise<LibraryWorkout> {
    if (!title.trim()) throw new Error('Free activity title is required')
    const workout = await this.workouts.create({ contentKind: 'FREE_ACTIVITY',
      sourceType: 'MANUAL', title: title.trim() })
    return (await this.workouts.listLibrary()).find((item) => item.id === workout.id)!
  }

  async update(id: string, changes: WorkoutDetailsChange): Promise<void> {
    const update: Partial<NewWorkout> = {
      title: changes.title?.trim() || null,
      durationMinutes: changes.durationMinutes,
      primaryActivityTypeId: changes.primaryActivityTypeId,
      estimatedIntensity: changes.estimatedIntensity,
    }
    if (changes.durationMinutes !== null && (!Number.isFinite(changes.durationMinutes) || changes.durationMinutes < 0)) {
      throw new Error('Invalid workout duration')
    }
    if (changes.sourceUrl !== undefined) {
      if (!changes.sourceUrl?.trim()) {
        update.sourceUrl = null
      } else {
        const url = parseWorkoutUrl(changes.sourceUrl)
        update.sourceUrl = url.toString()
        update.sourceType = sourceTypeFromUrl(url)
      }
    }
    await this.workouts.update(id, update)
  }

  setPreference(id: string, preference: WorkoutPreference | null): Promise<void> {
    return this.workouts.setPreference(id, preference)
  }

  async setVisibility(id: string, visibility: 'ACTIVE' | 'TEMPORARILY_HIDDEN'): Promise<void> {
    await this.workouts.update(id, { userVisibility: visibility })
  }

  remove(id: string): Promise<'deleted' | 'archived'> {
    return this.workouts.remove(id)
  }

  importShare(payload: SharedWorkoutPayload): Promise<WorkoutImportResult> {
    return this.imports.importShare(payload)
  }

  selectToday(id: string): Promise<void> {
    return this.imports.selectToday(id, localDateAtStart(new Date()))
  }
}

export async function openTrainingLibrary(): Promise<TrainingLibrary> {
  if (!Capacitor.isNativePlatform()) throw new TrainingLibraryUnavailableError()
  return new SqliteTrainingLibrary(await getNativeDatabase())
}
