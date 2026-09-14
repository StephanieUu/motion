import type { Database } from '../sqlite/Database'
import { composeMiniRoutine, type Movement } from '../../features/motivation/miniRoutine'

export interface MiniRoutineVersion {
  id: string
  workoutContentId: string
  items: readonly Movement[]
  durationMinutes: number
}

export class MiniRoutineRepository {
  constructor(private readonly db: Database) {}

  async create(variation = 0, targetMinutes = 5): Promise<MiniRoutineVersion> {
    const items = composeMiniRoutine(variation, targetMinutes)
    const workoutContentId = 'motion-mini-routine-v1'
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const durationMinutes = items.reduce((sum, item) => sum + item.seconds, 0) / 60
    await this.db.transaction(async (tx) => {
      await tx.run(`INSERT OR IGNORE INTO workout_contents
        (id,content_kind,title,source_type,duration_minutes,estimated_intensity,requires_equipment,
          has_jumping,psychological_barrier,created_at,updated_at)
        VALUES (?,'MINI_ROUTINE','轻量动作','APP_BUILTIN',?,'LOW',0,0,'LOW',?,?)`,
      [workoutContentId, durationMinutes, now, now])
      const version = (await tx.query<{ next_version: number }>(
        'SELECT COALESCE(MAX(version_number),0)+1 AS next_version FROM mini_routine_versions WHERE workout_content_id=?',
        [workoutContentId]))[0]?.next_version ?? 1
      await tx.run(`INSERT INTO mini_routine_versions (id,workout_content_id,version_number,created_at)
        VALUES (?,?,?,?)`, [id, workoutContentId, version, now])
      for (const [order, item] of items.entries()) await tx.run(`INSERT INTO mini_routine_items
        (id,mini_routine_version_id,sort_order,movement_name,duration_seconds,instructions,is_required)
        VALUES (?,?,?,?,?,?,1)`, [crypto.randomUUID(), id, order, item.name, item.seconds, item.instructions])
    })
    return { id, workoutContentId, items, durationMinutes }
  }

  async get(id: string): Promise<MiniRoutineVersion | null> {
    const version = (await this.db.query<{ workout_content_id: string }>(
      'SELECT workout_content_id FROM mini_routine_versions WHERE id=?', [id]))[0]
    if (!version) return null
    const rows = await this.db.query<{ movement_name: string; duration_seconds: number; instructions: string }>(
      'SELECT movement_name,duration_seconds,instructions FROM mini_routine_items WHERE mini_routine_version_id=? ORDER BY sort_order', [id])
    const items = rows.map((row, index) => ({ id: `${id}:${index}`, name: row.movement_name,
      instructions: row.instructions, seconds: row.duration_seconds,
      phase: (index === 0 ? 'WARM_UP' : index === rows.length - 1 ? 'COOL_DOWN' : 'MAIN') as Movement['phase'] }))
    return { id, workoutContentId: version.workout_content_id, items,
      durationMinutes: items.reduce((sum, item) => sum + item.seconds, 0) / 60 }
  }
}
