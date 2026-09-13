import { addLocalDays } from '@motion/domain'
import type { ActivityCandidate, ExplicitPreference, RecommendationContext, RecommendationResult,
  RecentTraining } from '@motion/recommendation'
import type { LibraryWorkout } from './WorkoutRepository'
import type { Database, SqlRow } from '../sqlite/Database'

interface ActivityRow extends SqlRow {
  id: string; name: string; system_key: string | null; is_active: number
  explicit_preference: ExplicitPreference | null; inferred_score: number | null
  times_completed: number | null; times_recommended: number | null; times_accepted: number | null
  last_completed_at: string | null; temporarily_suppressed_until: string | null
}

interface RecentRow extends SqlRow {
  workout_content_id: string | null; activity_type_id: string | null; local_date: string
  duration_minutes: number | null; completion_status: RecentTraining['completionStatus']; exertion: RecentTraining['exertion']
}

interface AttemptRow extends SqlRow { workout_content_id: string; attempt_count: number }

export interface StoredRecommendation {
  id: string
  localDate: string
  result: RecommendationResult
  recommendationSource: 'PLAN' | 'LIBRARY' | 'EXPLORATION' | 'RESCUE' | 'FREE_ACTIVITY'
  status: 'SUGGESTED' | 'ACCEPTED' | 'REJECTED' | 'REPLACED' | 'COMPLETED'
}

interface RecommendationRow extends SqlRow {
  id: string; local_date: string; recommendation_mode: RecommendationResult['mode']
  recommendation_source: StoredRecommendation['recommendationSource']
  selected_workout_content_id: string | null; suggested_activity_type_id: string | null
  score_breakdown_json: string | null; reason_codes_json: string | null
  status: StoredRecommendation['status']; novelty_preference: string | null
}

export class RecommendationRepository {
  constructor(private readonly db: Database) {}

  async context(today: string, workouts: LibraryWorkout[]): Promise<Pick<RecommendationContext, 'today' | 'workouts' | 'activities' | 'recent' | 'streak'>> {
    const [activityRows, recentRows, attemptRows, streakRows] = await Promise.all([
      this.db.query<ActivityRow>(`SELECT at.id,at.name,at.system_key,at.is_active,
        ap.explicit_preference,ap.inferred_score,ap.times_recommended,ap.times_accepted,
        COALESCE(history.times_completed,0) AS times_completed,history.last_completed_at,
        ap.temporarily_suppressed_until FROM activity_types at
        LEFT JOIN activity_preferences ap ON ap.activity_type_id=at.id
        LEFT JOIN (SELECT activity_type_id,COUNT(*) AS times_completed,MAX(ended_at) AS last_completed_at
          FROM training_sessions WHERE lifecycle_status='COMPLETED' AND activity_type_id IS NOT NULL
          GROUP BY activity_type_id) history ON history.activity_type_id=at.id`),
      this.db.query<RecentRow>(`SELECT s.workout_content_id,s.activity_type_id,s.local_date,
        s.duration_minutes,s.completion_status,f.exertion FROM training_sessions s
        LEFT JOIN workout_feedback f ON f.training_session_id=s.id
        WHERE s.lifecycle_status='COMPLETED' AND s.local_date>=? AND s.local_date<=?
        ORDER BY s.local_date DESC,s.ended_at DESC`, [addLocalDays(today, -7), today]),
      this.db.query<AttemptRow>(`SELECT workout_content_id,COUNT(*) AS attempt_count FROM training_sessions
        WHERE workout_content_id IS NOT NULL AND lifecycle_status IN ('COMPLETED','ABANDONED')
        GROUP BY workout_content_id`),
      this.db.query<{ current_streak: number }>('SELECT current_streak FROM streak_state WHERE singleton_key=1'),
    ])
    const attempts = new Map(attemptRows.map((row) => [row.workout_content_id, row.attempt_count]))
    const activities: ActivityCandidate[] = activityRows.map((row) => ({ id: row.id, name: row.name,
      systemKey: row.system_key, isActive: row.is_active === 1, preference: row.explicit_preference ?? 'NEUTRAL',
      inferredScore: row.inferred_score ?? 0, timesCompleted: row.times_completed ?? 0,
      timesRecommended: row.times_recommended ?? 0, timesAccepted: row.times_accepted ?? 0,
      lastCompletedAt: row.last_completed_at, suppressedUntil: row.temporarily_suppressed_until }))
    return { today, activities, streak: streakRows[0] ? { current: streakRows[0].current_streak } : null,
    recent: recentRows.map((row) => ({ workoutContentId: row.workout_content_id,
      activityTypeId: row.activity_type_id, localDate: row.local_date, durationMinutes: row.duration_minutes,
      completionStatus: row.completion_status, exertion: row.exertion })),
    workouts: workouts.map((workout) => ({ id: workout.id, activityTypeId: workout.primaryActivityTypeId,
      durationMinutes: workout.durationMinutes, intensity: workout.estimatedIntensity,
      requiresEquipment: workout.requiresEquipment, visibility: workout.userVisibility,
      preference: workout.userPreference, completionCount: workout.completionCount,
      attemptCount: attempts.get(workout.id) ?? 0,
      lastCompletedAt: workout.lastCompletedAt })) }
  }

  async save(context: RecommendationContext, result: RecommendationResult, plan?: {
    runId: string; originalPlanDayId: string } | null, inspiration = false): Promise<StoredRecommendation> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    let recommendationSource: StoredRecommendation['recommendationSource'] = inspiration ? 'EXPLORATION' : 'LIBRARY'
    await this.db.transaction(async (tx) => {
      const kind = result.workoutContentId ? (await tx.query<{ content_kind: string }>(
        "SELECT content_kind FROM workout_contents WHERE id=? AND user_visibility='ACTIVE'",
        [result.workoutContentId]))[0]?.content_kind : null
      if (result.workoutContentId && !kind) throw new Error('Workout is no longer active')
      if (!inspiration) recommendationSource = result.mode === 'RESCUE' || result.mode === 'RESTART'
        ? 'RESCUE' : kind === 'FREE_ACTIVITY' ? 'FREE_ACTIVITY' : 'LIBRARY'
      if (result.activityTypeId) {
        const activity = (await tx.query<{ is_active: number; explicit_preference: string | null }>(
          `SELECT at.is_active,ap.explicit_preference FROM activity_types at
          LEFT JOIN activity_preferences ap ON ap.activity_type_id=at.id WHERE at.id=?`, [result.activityTypeId]))[0]
        if (!activity || activity.is_active !== 1 || activity.explicit_preference === 'AVOID')
          throw new Error('Activity is no longer recommendable')
      }
      await tx.run("UPDATE daily_recommendations SET status='REPLACED' WHERE local_date=? AND status='SUGGESTED'",
        [context.today])
      await tx.run(`UPDATE daily_recommendations SET status='REPLACED' WHERE local_date=?
        AND status='ACCEPTED' AND selected_workout_content_id IS NULL`, [context.today])
      await tx.run(`INSERT INTO daily_recommendations (id,local_date,recommendation_mode,recommendation_source,
        training_plan_run_id,original_plan_day_id,selected_workout_content_id,suggested_activity_type_id,
        mood,requested_intensity,requested_duration_min,requested_duration_max,novelty_preference,
        score_breakdown_json,reason_codes_json,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SUGGESTED',?)`,
      [id, context.today, result.mode, recommendationSource,
      plan?.runId ?? null, plan?.originalPlanDayId ?? null, result.workoutContentId, result.activityTypeId,
      context.mood ?? null, context.desiredIntensity ?? null, context.durationMin ?? null,
      context.durationMax ?? null, context.novelty ?? null, JSON.stringify(result.scoreBreakdown),
      JSON.stringify(result.reasonCodes), now])
      if (result.workoutContentId === null && result.activityTypeId) {
        await tx.run(`INSERT INTO exploration_recommendations (id,local_date,activity_type_id,mood,
          desired_intensity,duration_min,duration_max,novelty_level) VALUES (?,?,?,?,?,?,?,?)`,
        [id, context.today, result.activityTypeId, context.mood ?? null, context.desiredIntensity ?? null,
          context.durationMin ?? null, context.durationMax ?? null, result.novelty])
      }
      if (result.activityTypeId) await tx.run(`INSERT INTO activity_preferences
        (id,activity_type_id,times_recommended) VALUES (?,?,1)
        ON CONFLICT(activity_type_id) DO UPDATE SET times_recommended=times_recommended+1`,
      [crypto.randomUUID(), result.activityTypeId])
    })
    return { id, localDate: context.today, result, recommendationSource, status: 'SUGGESTED' }
  }

  async accept(id: string, today: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rec = (await tx.query<RecommendationRow>('SELECT * FROM daily_recommendations WHERE id=?', [id]))[0]
      if (!rec || rec.local_date !== today || !rec.selected_workout_content_id ||
        !['SUGGESTED', 'ACCEPTED'].includes(rec.status)) throw new Error('Recommendation is not selectable')
      const workout = (await tx.query<{ user_visibility: string }>(
        'SELECT user_visibility FROM workout_contents WHERE id=?', [rec.selected_workout_content_id]))[0]
      if (workout?.user_visibility !== 'ACTIVE') throw new Error('Workout is not selectable')
      if (rec.suggested_activity_type_id) {
        const activity = (await tx.query<{ explicit_preference: string | null }>(
          'SELECT explicit_preference FROM activity_preferences WHERE activity_type_id=?',
          [rec.suggested_activity_type_id]))[0]
        if (activity?.explicit_preference === 'AVOID') throw new Error('Activity is not selectable')
      }
      await tx.run(`INSERT INTO today_pending_selections (local_date,workout_content_id,selected_at)
        VALUES (?,?,?) ON CONFLICT(local_date) DO UPDATE SET
        workout_content_id=excluded.workout_content_id,selected_at=excluded.selected_at`,
      [today, rec.selected_workout_content_id, new Date().toISOString()])
      await tx.run("UPDATE daily_recommendations SET status='ACCEPTED' WHERE id=?", [id])
      await tx.run("UPDATE daily_recommendations SET status='REPLACED' WHERE local_date=? AND status='ACCEPTED' AND id<>?",
        [today, id])
      if (rec.suggested_activity_type_id && rec.status !== 'ACCEPTED') await tx.run(
        'UPDATE activity_preferences SET times_accepted=times_accepted+1 WHERE activity_type_id=?',
        [rec.suggested_activity_type_id])
    })
  }

  async acceptExploration(id: string, today: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rec = (await tx.query<RecommendationRow>('SELECT * FROM daily_recommendations WHERE id=?', [id]))[0]
      if (!rec || rec.local_date !== today || rec.recommendation_mode !== 'EXPLORATION' ||
        !['SUGGESTED', 'ACCEPTED'].includes(rec.status)) throw new Error('Exploration is not available')
      if (rec.suggested_activity_type_id) {
        const activity = (await tx.query<{ is_active: number; explicit_preference: string | null }>(
          `SELECT at.is_active,ap.explicit_preference FROM activity_types at
          LEFT JOIN activity_preferences ap ON ap.activity_type_id=at.id WHERE at.id=?`,
          [rec.suggested_activity_type_id]))[0]
        if (!activity || activity.is_active !== 1 || activity.explicit_preference === 'AVOID')
          throw new Error('Activity is not selectable')
      }
      await tx.run('UPDATE exploration_recommendations SET accepted=1 WHERE id=?', [id])
      await tx.run("UPDATE daily_recommendations SET status='ACCEPTED' WHERE id=?", [id])
      await tx.run("UPDATE daily_recommendations SET status='REPLACED' WHERE local_date=? AND status='ACCEPTED' AND id<>?",
        [today, id])
      if (rec.suggested_activity_type_id && rec.status !== 'ACCEPTED') await tx.run(
        'UPDATE activity_preferences SET times_accepted=times_accepted+1 WHERE activity_type_id=?',
        [rec.suggested_activity_type_id])
    })
  }

  async selectActivityAsFreeWorkout(id: string, today: string): Promise<string> {
    return this.db.transaction(async (tx) => {
      const rec = (await tx.query<RecommendationRow>('SELECT * FROM daily_recommendations WHERE id=?', [id]))[0]
      if (!rec || rec.local_date !== today || rec.recommendation_source !== 'EXPLORATION' ||
        rec.recommendation_mode !== 'EXPLORATION' || !rec.suggested_activity_type_id ||
        !['SUGGESTED', 'ACCEPTED'].includes(rec.status)) throw new Error('Activity is not selectable')
      const activity = (await tx.query<{ name: string; is_active: number; explicit_preference: string | null }>(
        `SELECT at.name,at.is_active,ap.explicit_preference FROM activity_types at
        LEFT JOIN activity_preferences ap ON ap.activity_type_id=at.id WHERE at.id=?`,
        [rec.suggested_activity_type_id]))[0]
      if (!activity || activity.is_active !== 1 || activity.explicit_preference === 'AVOID')
        throw new Error('Activity is not selectable')
      if (rec.selected_workout_content_id) {
        const selected = (await tx.query<{ content_kind: string; user_visibility: string }>(
          'SELECT content_kind,user_visibility FROM workout_contents WHERE id=?',
          [rec.selected_workout_content_id]))[0]
        if (selected?.content_kind !== 'FREE_ACTIVITY' || selected.user_visibility !== 'ACTIVE')
          throw new Error('Free Activity is not selectable')
      }
      const existing = (await tx.query<{ id: string }>(`SELECT id FROM workout_contents
        WHERE content_kind='FREE_ACTIVITY' AND primary_activity_type_id=? AND user_visibility='ACTIVE'
        ORDER BY created_at DESC,id DESC LIMIT 1`, [rec.suggested_activity_type_id]))[0]
      const workoutId = rec.selected_workout_content_id ?? existing?.id ?? crypto.randomUUID()
      if (!rec.selected_workout_content_id && !existing) {
        const now = new Date().toISOString()
        await tx.run(`INSERT INTO workout_contents
          (id,content_kind,title,source_type,primary_activity_type_id,created_at,updated_at)
          VALUES (?,'FREE_ACTIVITY',?,'MANUAL',?,?,?)`,
        [workoutId, activity.name, rec.suggested_activity_type_id, now, now])
      }
      await tx.run(`INSERT INTO today_pending_selections (local_date,workout_content_id,selected_at)
        VALUES (?,?,?) ON CONFLICT(local_date) DO UPDATE SET
        workout_content_id=excluded.workout_content_id,selected_at=excluded.selected_at`,
      [today, workoutId, new Date().toISOString()])
      await tx.run(`UPDATE daily_recommendations SET selected_workout_content_id=?,status='ACCEPTED' WHERE id=?`,
        [workoutId, id])
      await tx.run(`UPDATE exploration_recommendations SET accepted=1,resulting_workout_content_id=? WHERE id=?`,
        [workoutId, id])
      await tx.run("UPDATE daily_recommendations SET status='REPLACED' WHERE local_date=? AND status='ACCEPTED' AND id<>?",
        [today, id])
      if (rec.status !== 'ACCEPTED') await tx.run(
        'UPDATE activity_preferences SET times_accepted=times_accepted+1 WHERE activity_type_id=?',
        [rec.suggested_activity_type_id])
      return workoutId
    })
  }

  async linkImportedWorkout(today: string, workoutContentId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rec = (await tx.query<{ id: string }>(`SELECT e.id FROM exploration_recommendations e
        JOIN daily_recommendations d ON d.id=e.id WHERE e.local_date=? AND e.accepted=1
        AND e.resulting_workout_content_id IS NULL AND d.status='ACCEPTED'
        AND EXISTS (SELECT 1 FROM workout_imports wi WHERE wi.workout_content_id=?
          AND wi.imported_at>=d.created_at)
        ORDER BY d.created_at DESC,d.rowid DESC LIMIT 1`, [today, workoutContentId]))[0]
      if (!rec) return
      await tx.run('UPDATE exploration_recommendations SET resulting_workout_content_id=? WHERE id=?',
        [workoutContentId, rec.id])
      await tx.run('UPDATE daily_recommendations SET selected_workout_content_id=? WHERE id=?',
        [workoutContentId, rec.id])
    })
  }

  async acceptedForWorkout(today: string, workoutContentId: string): Promise<string | null> {
    const row = (await this.db.query<{ id: string }>(`SELECT id FROM daily_recommendations WHERE local_date=?
      AND selected_workout_content_id=? AND status='ACCEPTED' ORDER BY created_at DESC,rowid DESC LIMIT 1`,
    [today, workoutContentId]))[0]
    return row?.id ?? null
  }

  async sessionWasRecommended(sessionId: string): Promise<boolean> {
    const row = (await this.db.query<{ daily_recommendation_id: string | null }>(
      'SELECT daily_recommendation_id FROM training_sessions WHERE id=?', [sessionId]))[0]
    return !!row?.daily_recommendation_id
  }

  async latest(today: string): Promise<StoredRecommendation | null> {
    const row = (await this.db.query<RecommendationRow>(`SELECT * FROM daily_recommendations
      WHERE local_date=? AND status IN ('SUGGESTED','ACCEPTED') ORDER BY created_at DESC,rowid DESC LIMIT 1`, [today]))[0]
    if (!row) return null
    return { id: row.id, localDate: row.local_date, status: row.status,
      recommendationSource: row.recommendation_source,
      result: { mode: row.recommendation_mode, workoutContentId: row.selected_workout_content_id,
        activityTypeId: row.suggested_activity_type_id, score: Object.values(JSON.parse(row.score_breakdown_json ?? '{}') as Record<string, number>)
          .reduce((sum, value) => sum + value, 0), scoreBreakdown: JSON.parse(row.score_breakdown_json ?? '{}'),
        reasonCodes: JSON.parse(row.reason_codes_json ?? '[]'), durationMinutes: null, intensity: null,
        novelty: row.novelty_preference === 'FAMILIAR' || row.novelty_preference === 'FRESH' ? row.novelty_preference : 'MIXED' } }
  }
}
