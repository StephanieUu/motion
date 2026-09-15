import type { Database } from '../sqlite/Database'

export class AppPreferencesRepository {
  constructor(private readonly db: Database) {}

  async get(preferenceKey: string): Promise<string | null> {
    return (await this.db.query<{ preference_value: string }>(
      'SELECT preference_value FROM app_preferences WHERE preference_key=? LIMIT 1',
    [preferenceKey]))[0]?.preference_value ?? null
  }

  async set(preferenceKey: string, preferenceValue: string): Promise<void> {
    if (!preferenceKey.trim()) throw new Error('Preference key is required')
    await this.db.run(`INSERT INTO app_preferences (preference_key,preference_value,updated_at) VALUES (?,?,?)
      ON CONFLICT(preference_key) DO UPDATE SET preference_value=excluded.preference_value,
      updated_at=excluded.updated_at`, [preferenceKey, preferenceValue, new Date().toISOString()])
  }
}
