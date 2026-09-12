import type { Database, SqlRow } from '../sqlite/Database'

export interface ActivityType extends SqlRow {
  id: string
  system_key: string | null
  name: string
  is_system: number
  is_active: number
}

export interface ActivityPreference extends SqlRow {
  id: string
  activity_type_id: string
  explicit_preference: 'LOVE' | 'LIKE' | 'NEUTRAL' | 'DISLIKE' | 'AVOID'
  inferred_score: number
  times_completed: number
}

export class ActivityRepository {
  constructor(private readonly db: Database) {}

  listTypes(): Promise<ActivityType[]> {
    return this.db.query<ActivityType>('SELECT * FROM activity_types ORDER BY is_system DESC,name')
  }

  async createType(name: string): Promise<ActivityType> {
    if (!name.trim()) throw new Error('Activity type name is required')
    const id = crypto.randomUUID()
    await this.db.run('INSERT INTO activity_types (id,name,is_system,is_active) VALUES (?,?,0,1)', [id, name.trim()])
    return (await this.db.query<ActivityType>('SELECT * FROM activity_types WHERE id=?', [id]))[0]!
  }

  async deactivateType(id: string): Promise<void> {
    await this.db.run('UPDATE activity_types SET is_active=0 WHERE id=? AND is_system=0', [id])
  }

  async getPreference(activityTypeId: string): Promise<ActivityPreference | null> {
    return (await this.db.query<ActivityPreference>('SELECT * FROM activity_preferences WHERE activity_type_id=?', [activityTypeId]))[0] ?? null
  }

  async setExplicitPreference(activityTypeId: string, preference: ActivityPreference['explicit_preference']): Promise<void> {
    await this.db.run(`INSERT INTO activity_preferences (id,activity_type_id,explicit_preference) VALUES (?,?,?)
      ON CONFLICT(activity_type_id) DO UPDATE SET explicit_preference=excluded.explicit_preference`,
      [crypto.randomUUID(), activityTypeId, preference])
  }
}
