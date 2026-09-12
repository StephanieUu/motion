import type { ContentKind, SourceType, WorkoutContent, WorkoutPreference, WorkoutVisibility } from '@motion/domain'
import type { Database, SqlRow } from '../sqlite/Database'

interface WorkoutRow extends SqlRow {
  id: string; content_kind: ContentKind; title: string | null; description: string | null
  source_type: SourceType; source_url: string | null; duration_minutes: number | null
  primary_activity_type_id: string | null; user_visibility: WorkoutVisibility
  estimated_intensity: string | null; impact_level: string | null
  requires_equipment: number | null; has_jumping: number | null; body_areas_json: string | null
  created_at: string; updated_at: string
}

interface LibraryRow extends WorkoutRow {
  activity_type_name: string | null
  user_preference: WorkoutPreference | null
  completion_count: number
  last_completed_at: string | null
}

export interface LibraryWorkout extends WorkoutContent {
  activityTypeName: string | null
  userPreference: WorkoutPreference | null
  completionCount: number
  lastCompletedAt: string | null
}

function parseBodyAreas(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((area): area is string => typeof area === 'string') : []
  } catch {
    return []
  }
}

function fromRow(row: WorkoutRow): WorkoutContent {
  return {
    id: row.id, contentKind: row.content_kind, title: row.title, description: row.description,
    sourceType: row.source_type, sourceUrl: row.source_url, durationMinutes: row.duration_minutes,
    primaryActivityTypeId: row.primary_activity_type_id, userVisibility: row.user_visibility,
    estimatedIntensity: row.estimated_intensity, impactLevel: row.impact_level,
    requiresEquipment: row.requires_equipment === null ? null : row.requires_equipment === 1,
    hasJumping: row.has_jumping === null ? null : row.has_jumping === 1,
    bodyAreas: parseBodyAreas(row.body_areas_json),
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export interface NewWorkout {
  contentKind: ContentKind
  sourceType: SourceType
  title?: string | null
  description?: string | null
  sourceUrl?: string | null
  durationMinutes?: number | null
  primaryActivityTypeId?: string | null
  estimatedIntensity?: string | null
  impactLevel?: string | null
  requiresEquipment?: boolean | null
  hasJumping?: boolean | null
  bodyAreas?: string[]
}

export class WorkoutRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewWorkout): Promise<WorkoutContent> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await this.db.run(
      `INSERT INTO workout_contents (id, content_kind, title, description, source_type, source_url,
        duration_minutes, primary_activity_type_id, estimated_intensity, impact_level,
        requires_equipment, has_jumping, body_areas_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.contentKind, input.title ?? null, input.description ?? null, input.sourceType,
        input.sourceUrl ?? null, input.durationMinutes ?? null, input.primaryActivityTypeId ?? null,
        input.estimatedIntensity ?? null, input.impactLevel ?? null,
        input.requiresEquipment === undefined || input.requiresEquipment === null ? null : Number(input.requiresEquipment),
        input.hasJumping === undefined || input.hasJumping === null ? null : Number(input.hasJumping),
        input.bodyAreas ? JSON.stringify(input.bodyAreas) : null, now, now],
    )
    return (await this.get(id))!
  }

  async get(id: string): Promise<WorkoutContent | null> {
    const rows = await this.db.query<WorkoutRow>('SELECT * FROM workout_contents WHERE id = ?', [id])
    return rows[0] ? fromRow(rows[0]) : null
  }

  async list(): Promise<WorkoutContent[]> {
    return (await this.db.query<WorkoutRow>('SELECT * FROM workout_contents ORDER BY created_at DESC')).map(fromRow)
  }

  async listLibrary(): Promise<LibraryWorkout[]> {
    const rows = await this.db.query<LibraryRow>(`SELECT wc.*, at.name AS activity_type_name,
      wp.explicit_preference AS user_preference,
      COALESCE(history.completion_count, 0) AS completion_count,
      history.last_completed_at
      FROM workout_contents wc
      LEFT JOIN activity_types at ON at.id = wc.primary_activity_type_id
      LEFT JOIN workout_preferences wp ON wp.workout_content_id = wc.id
      LEFT JOIN (
        SELECT workout_content_id, COUNT(*) AS completion_count, MAX(ended_at) AS last_completed_at
        FROM training_sessions
        WHERE workout_content_id IS NOT NULL AND lifecycle_status = 'COMPLETED'
        GROUP BY workout_content_id
      ) history ON history.workout_content_id = wc.id
      ORDER BY wc.created_at DESC, wc.id DESC`)
    return rows.map((row) => ({ ...fromRow(row), activityTypeName: row.activity_type_name,
      userPreference: row.user_preference, completionCount: row.completion_count,
      lastCompletedAt: row.last_completed_at }))
  }

  async update(id: string, changes: Partial<NewWorkout> & { userVisibility?: WorkoutVisibility }): Promise<WorkoutContent> {
    const row = (await this.db.query<WorkoutRow>('SELECT * FROM workout_contents WHERE id=?', [id]))[0]
    if (!row) throw new Error('Workout not found')
    const current = fromRow(row)
    const now = new Date().toISOString()
    await this.db.run(
      `UPDATE workout_contents SET content_kind=?, title=?, description=?, source_type=?, source_url=?,
       duration_minutes=?, primary_activity_type_id=?, estimated_intensity=?, impact_level=?,
       requires_equipment=?, has_jumping=?, body_areas_json=?, user_visibility=?, updated_at=? WHERE id=?`,
      [changes.contentKind ?? current.contentKind, changes.title === undefined ? current.title : changes.title,
        changes.description === undefined ? current.description : changes.description,
        changes.sourceType ?? current.sourceType, changes.sourceUrl === undefined ? current.sourceUrl : changes.sourceUrl,
        changes.durationMinutes === undefined ? current.durationMinutes : changes.durationMinutes,
        changes.primaryActivityTypeId === undefined ? current.primaryActivityTypeId : changes.primaryActivityTypeId,
        changes.estimatedIntensity === undefined ? current.estimatedIntensity : changes.estimatedIntensity,
        changes.impactLevel === undefined ? current.impactLevel : changes.impactLevel,
        changes.requiresEquipment === undefined ? row.requires_equipment
          : changes.requiresEquipment === null ? null : Number(changes.requiresEquipment),
        changes.hasJumping === undefined ? row.has_jumping
          : changes.hasJumping === null ? null : Number(changes.hasJumping),
        changes.bodyAreas === undefined ? row.body_areas_json : JSON.stringify(changes.bodyAreas),
        changes.userVisibility ?? current.userVisibility, now, id],
    )
    return (await this.get(id))!
  }

  async setPreference(id: string, preference: WorkoutPreference | null): Promise<void> {
    if (!(await this.get(id))) throw new Error('Workout not found')
    if (preference === null) {
      await this.db.run('DELETE FROM workout_preferences WHERE workout_content_id=?', [id])
      return
    }
    await this.db.run(`INSERT INTO workout_preferences (workout_content_id,explicit_preference,updated_at)
      VALUES (?,?,?) ON CONFLICT(workout_content_id) DO UPDATE SET
      explicit_preference=excluded.explicit_preference, updated_at=excluded.updated_at`,
    [id, preference, new Date().toISOString()])
  }

  async remove(id: string): Promise<'deleted' | 'archived'> {
    return this.db.transaction(async (tx) => {
      const referenced = await tx.query<{ used: number }>(`SELECT (
        (SELECT COUNT(*) FROM training_plan_day_items WHERE workout_content_id=?) +
        (SELECT COUNT(*) FROM training_sessions WHERE workout_content_id=?) +
        (SELECT COUNT(*) FROM mini_routine_versions WHERE workout_content_id=?) +
        (SELECT COUNT(*) FROM workout_imports WHERE workout_content_id=?) +
        (SELECT COUNT(*) FROM today_pending_selections WHERE workout_content_id=?) +
        (SELECT COUNT(*) FROM content_analyses WHERE workout_content_id=?) +
        (SELECT COUNT(*) FROM daily_recommendations WHERE selected_workout_content_id=?) +
        (SELECT COUNT(*) FROM exploration_recommendations WHERE resulting_workout_content_id=?)) AS used`,
      Array(8).fill(id))
      if ((referenced[0]?.used ?? 0) > 0) {
        await tx.run("UPDATE workout_contents SET user_visibility='ARCHIVED', updated_at=? WHERE id=?", [new Date().toISOString(), id])
        return 'archived'
      }
      await tx.run('DELETE FROM workout_contents WHERE id=?', [id])
      return 'deleted'
    })
  }
}
