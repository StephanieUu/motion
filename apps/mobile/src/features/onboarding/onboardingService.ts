import type { NutritionSetup, NutritionService } from '../food/nutritionService'
import { openNutritionService } from '../food/nutritionService'
import { getInitialDatabaseVersion } from '../../db/sqlite/nativeDatabase'
import { getNativeDatabase } from '../../db/sqlite/nativeDatabase'
import { AppPreferencesRepository } from '../../db/repositories/AppPreferencesRepository'

export type OnboardingDisposition = 'PENDING' | 'COMPLETED' | 'SKIPPED'
const storageKey = 'onboarding.disposition'

export interface OnboardingPreferenceStore {
  get(): Promise<OnboardingDisposition | null>
  set(value: OnboardingDisposition): Promise<void>
}

class SqliteOnboardingPreferenceStore implements OnboardingPreferenceStore {
  constructor(private readonly preferences: AppPreferencesRepository) {}
  async get(): Promise<OnboardingDisposition | null> {
    const value = await this.preferences.get(storageKey)
    return value === 'PENDING' || value === 'COMPLETED' || value === 'SKIPPED' ? value : null
  }
  set(value: OnboardingDisposition): Promise<void> { return this.preferences.set(storageKey, value) }
}

export function initialOnboardingDisposition(stored: OnboardingDisposition | null,
  initialDatabaseVersion: number): OnboardingDisposition {
  if (stored) return stored
  return initialDatabaseVersion === 0 ? 'PENDING' : 'SKIPPED'
}

export class OnboardingService {
  constructor(readonly nutrition: NutritionService, private readonly store: OnboardingPreferenceStore,
    private readonly initialDatabaseVersion: number) {}

  async status(): Promise<OnboardingDisposition> {
    const status = initialOnboardingDisposition(await this.store.get(), this.initialDatabaseVersion)
    if (status === 'PENDING') await this.store.set(status)
    return status
  }
  skip(): Promise<void> { return this.store.set('SKIPPED') }
  complete(): Promise<void> { return this.store.set('COMPLETED') }
  saveSetup(input: NutritionSetup): Promise<void> { return this.nutrition.saveSetup(input) }
  daily() { return this.nutrition.daily() }
}

export async function openOnboardingService(): Promise<OnboardingService> {
  const [nutrition, db, version] = await Promise.all([
    openNutritionService(), getNativeDatabase(), getInitialDatabaseVersion(),
  ])
  return new OnboardingService(nutrition,
    new SqliteOnboardingPreferenceStore(new AppPreferencesRepository(db)), version)
}
