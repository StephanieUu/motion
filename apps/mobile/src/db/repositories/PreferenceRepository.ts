import type { Database, SqlRow } from '../sqlite/Database'
import { rebuildTrainingState } from './rebuildTrainingState'

export interface AppPreference extends SqlRow {
  theme: string
  locale: string
  first_day_of_week: number
  minimum_effective_minutes: number
  default_novelty_preference: string
  coach_tone: string
}

export interface UserProfile extends SqlRow {
  id: string
  birth_date: string | null
  sex: string | null
  height_cm: number | null
  goal_type: string
  target_weight_kg: number | null
  desired_weight_loss_rate: number | null
  created_at: string
}

export class PreferenceRepository {
  constructor(private readonly db: Database) {}

  async get(): Promise<AppPreference> {
    const rows = await this.db.query<AppPreference>('SELECT * FROM app_preference WHERE singleton_key=1')
    if (!rows[0]) throw new Error('App preferences are missing')
    return rows[0]
  }

  async setMinimumEffectiveMinutes(minutes: number): Promise<void> {
    if (!Number.isInteger(minutes) || minutes <= 0) throw new Error('Minutes must be positive')
    await this.db.transaction(async (tx) => {
      await tx.run('UPDATE app_preference SET minimum_effective_minutes=? WHERE singleton_key=1', [minutes])
      const dates = await tx.query<{ local_date: string }>("SELECT DISTINCT local_date FROM training_sessions WHERE lifecycle_status='COMPLETED'")
      await rebuildTrainingState(tx, dates.map((row) => row.local_date))
    })
  }

  async update(changes: Partial<Pick<AppPreference, 'theme' | 'locale' | 'first_day_of_week' | 'default_novelty_preference' | 'coach_tone'>>): Promise<AppPreference> {
    const current = await this.get()
    await this.db.run(`UPDATE app_preference SET theme=?,locale=?,first_day_of_week=?,default_novelty_preference=?,coach_tone=?
      WHERE singleton_key=1`, [changes.theme ?? current.theme, changes.locale ?? current.locale,
      changes.first_day_of_week ?? current.first_day_of_week,
      changes.default_novelty_preference ?? current.default_novelty_preference,
      changes.coach_tone ?? current.coach_tone])
    return this.get()
  }

  async getUserProfile(): Promise<UserProfile | null> {
    return (await this.db.query<UserProfile>('SELECT * FROM user_profile WHERE singleton_key=1'))[0] ?? null
  }

  async saveUserProfile(input: { id?: string; goalType: string; birthDate?: string | null; sex?: string | null;
    heightCm?: number | null; targetWeightKg?: number | null; desiredWeightLossRate?: number | null }): Promise<void> {
    await this.db.run(`INSERT INTO user_profile
      (singleton_key,id,birth_date,sex,height_cm,goal_type,target_weight_kg,desired_weight_loss_rate,created_at)
      VALUES (1,?,?,?,?,?,?,?,?) ON CONFLICT(singleton_key) DO UPDATE SET
      birth_date=excluded.birth_date,sex=excluded.sex,height_cm=excluded.height_cm,goal_type=excluded.goal_type,
      target_weight_kg=excluded.target_weight_kg,desired_weight_loss_rate=excluded.desired_weight_loss_rate`,
    [input.id ?? crypto.randomUUID(), input.birthDate ?? null, input.sex ?? null, input.heightCm ?? null,
      input.goalType, input.targetWeightKg ?? null, input.desiredWeightLossRate ?? null, new Date().toISOString()])
  }
}
