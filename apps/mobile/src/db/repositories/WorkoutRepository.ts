import type { ContentKind, SourceType, WorkoutContent, WorkoutVisibility } from '@motion/domain'
import type { Database, SqlRow } from '../sqlite/Database'

interface WorkoutRow extends SqlRow {
  id: string; content_kind: ContentKind; title: string | null; description: string | null
  source_type: SourceType; source_url: string | null; duration_minutes: number | null
  primary_activity_type_id: string | null; user_visibility: WorkoutVisibility
  created_at: string; updated_at: string
}

function fromRow(row: WorkoutRow): WorkoutContent {
  return {
    id: row.id, contentKind: row.content_kind, title: row.title, description: row.description,
    sourceType: row.source_type, sourceUrl: row.source_url, durationMinutes: row.duration_minutes,
    primaryActivityTypeId: row.primary_activity_type_id, userVisibility: row.user_visibility,
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
}

export class WorkoutRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewWorkout): Promise<WorkoutContent> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await this.db.run(
      `INSERT INTO workout_contents (id, content_kind, title, description, source_type, source_url,
        duration_minutes, primary_activity_type_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.contentKind, input.title ?? null, input.description ?? null, input.sourceType,
        input.sourceUrl ?? null, input.durationMinutes ?? null, input.primaryActivityTypeId ?? null, now, now],
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

  async update(id: string, changes: Partial<NewWorkout> & { userVisibility?: WorkoutVisibility }): Promise<WorkoutContent> {
    const current = await this.get(id)
    if (!current) throw new Error('Workout not found')
    const now = new Date().toISOString()
    await this.db.run(
      `UPDATE workout_contents SET content_kind=?, title=?, description=?, source_type=?, source_url=?,
       duration_minutes=?, primary_activity_type_id=?, user_visibility=?, updated_at=? WHERE id=?`,
      [changes.contentKind ?? current.contentKind, changes.title === undefined ? current.title : changes.title,
        changes.description === undefined ? current.description : changes.description,
        changes.sourceType ?? current.sourceType, changes.sourceUrl === undefined ? current.sourceUrl : changes.sourceUrl,
        changes.durationMinutes === undefined ? current.durationMinutes : changes.durationMinutes,
        changes.primaryActivityTypeId === undefined ? current.primaryActivityTypeId : changes.primaryActivityTypeId,
        changes.userVisibility ?? current.userVisibility, now, id],
    )
    return (await this.get(id))!
  }

  async remove(id: string): Promise<'deleted' | 'archived'> {
    return this.db.transaction(async (tx) => {
      const referenced = await tx.query<{ used: number }>(`SELECT (
        (SELECT COUNT(*) FROM training_plan_day_items WHERE workout_content_id=?) +
        (SELECT COUNT(*) FROM training_sessions WHERE workout_content_id=?) +
        (SELECT COUNT(*) FROM mini_routine_versions WHERE workout_content_id=?) +
        (SELECT COUNT(*) FROM workout_imports WHERE workout_content_id=?) +
        (SELECT COUNT(*) FROM content_analyses WHERE workout_content_id=?) +
        (SELECT COUNT(*) FROM daily_recommendations WHERE selected_workout_content_id=?) +
        (SELECT COUNT(*) FROM exploration_recommendations WHERE resulting_workout_content_id=?)) AS used`,
      Array(7).fill(id))
      if ((referenced[0]?.used ?? 0) > 0) {
        await tx.run("UPDATE workout_contents SET user_visibility='ARCHIVED', updated_at=? WHERE id=?", [new Date().toISOString(), id])
        return 'archived'
      }
      await tx.run('DELETE FROM workout_contents WHERE id=?', [id])
      return 'deleted'
    })
  }
}
