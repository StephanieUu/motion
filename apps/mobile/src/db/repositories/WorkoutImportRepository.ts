import { classifyWorkoutTitle, durationFromTitle, parseSharedWorkout, retrievePageTitle,
  type SharedWorkoutPayload } from '@motion/integrations'
import type { SourceType } from '@motion/domain'
import type { Database, SqlRow } from '../sqlite/Database'

export interface WorkoutImportResult {
  eventId: string
  workoutContentId: string
  status: 'READY' | 'NEEDS_MORE_INFO'
}

interface ImportRow extends SqlRow {
  fingerprint: string
  workout_content_id: string | null
  import_status: string
}

export class WorkoutImportRepository {
  constructor(private readonly db: Database,
    private readonly pageTitle: (url: string) => Promise<string | null> = retrievePageTitle) {}

  private async existing(eventId: string): Promise<WorkoutImportResult | null> {
    const row = (await this.db.query<ImportRow>(
      'SELECT fingerprint,workout_content_id,import_status FROM workout_imports WHERE fingerprint=?', [eventId]))[0]
    return row?.workout_content_id ? { eventId, workoutContentId: row.workout_content_id,
      status: row.import_status === 'READY' ? 'READY' : 'NEEDS_MORE_INFO' } : null
  }

  async importShare(payload: SharedWorkoutPayload): Promise<WorkoutImportResult> {
    if (!payload.eventId.trim()) throw new Error('Share event ID is required')
    const previous = await this.existing(payload.eventId)
    if (previous) return previous
    const parsed = parseSharedWorkout(payload)
    if (!parsed.rawSharedText && !payload.subject?.trim()) throw new Error('Share is empty')

    // Network metadata is optional and deliberately skipped for ambiguous Quark shares.
    const pageTitle = parsed.rawUrl && parsed.sourceType !== 'QUARK'
      ? await this.pageTitle(parsed.rawUrl).catch(() => null) : null
    const title = parsed.title ?? pageTitle
    const activitySystemKey = parsed.sourceType === 'QUARK' ? null : classifyWorkoutTitle(title)
    const durationMinutes = parsed.sourceType === 'QUARK' ? null : durationFromTitle(title)
    const status = title && activitySystemKey && durationMinutes ? 'READY' : 'NEEDS_MORE_INFO'
    const now = new Date().toISOString()
    const workoutContentId = crypto.randomUUID()
    const importId = crypto.randomUUID()
    const rawMetadata = JSON.stringify({ subject: payload.subject, pageTitle })

    return this.db.transaction(async (tx) => {
      const prior = (await tx.query<ImportRow>(
        'SELECT fingerprint,workout_content_id,import_status FROM workout_imports WHERE fingerprint=?', [payload.eventId]))[0]
      if (prior?.workout_content_id) return { eventId: payload.eventId,
        workoutContentId: prior.workout_content_id,
        status: prior.import_status === 'READY' ? 'READY' as const : 'NEEDS_MORE_INFO' as const }
      const activity = activitySystemKey ? (await tx.query<{ id: string }>(
        'SELECT id FROM activity_types WHERE system_key=? AND is_active=1', [activitySystemKey]))[0] : null
      await tx.run(`INSERT INTO workout_contents
        (id,content_kind,title,source_type,source_url,duration_minutes,primary_activity_type_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      [workoutContentId, 'FOLLOW_ALONG', title, parsed.sourceType satisfies SourceType,
        parsed.rawUrl, durationMinutes, activity?.id ?? null, now, now])
      await tx.run(`INSERT INTO workout_imports
        (id,source_type,raw_url,raw_shared_text,raw_metadata_json,fingerprint,import_status,
          workout_content_id,imported_at,last_checked_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [importId, parsed.sourceType, parsed.rawUrl, parsed.rawSharedText, rawMetadata,
        payload.eventId, status, workoutContentId, now, now])
      if (title || activitySystemKey || durationMinutes) {
        await tx.run(`INSERT INTO content_analyses
          (id,workout_content_id,fingerprint,analysis_version,method,provider,confidence,
            extracted_data_json,analyzed_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), workoutContentId, payload.eventId, 1, 'RULES', 'LOCAL', 0.85,
          JSON.stringify({ title, activitySystemKey, durationMinutes,
            titleSource: parsed.title ? 'SHARE' : 'PAGE' }), now])
      }
      return { eventId: payload.eventId, workoutContentId, status }
    })
  }

  async selectToday(workoutContentId: string, localDate: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = (await tx.query<{ user_visibility: string }>(
        'SELECT user_visibility FROM workout_contents WHERE id=?', [workoutContentId]))[0]
      if (!row || row.user_visibility === 'ARCHIVED') throw new Error('Workout is not selectable')
      await tx.run(`INSERT INTO today_pending_selections (local_date,workout_content_id,selected_at)
        VALUES (?,?,?) ON CONFLICT(local_date) DO UPDATE SET
        workout_content_id=excluded.workout_content_id, selected_at=excluded.selected_at`,
      [localDate, workoutContentId, new Date().toISOString()])
      // A library selection supersedes a pending recommendation, including when the
      // user manually picks the same workout. An in-progress session keeps its link.
      await tx.run(`UPDATE daily_recommendations SET status='REPLACED'
        WHERE local_date=? AND status='ACCEPTED' AND NOT EXISTS (
          SELECT 1 FROM training_sessions s WHERE s.daily_recommendation_id=daily_recommendations.id
            AND s.lifecycle_status='IN_PROGRESS')`, [localDate])
    })
  }

  async pendingToday(localDate: string): Promise<string | null> {
    const row = (await this.db.query<{ workout_content_id: string }>(
      'SELECT workout_content_id FROM today_pending_selections WHERE local_date=?', [localDate]))[0]
    return row?.workout_content_id ?? null
  }
}
