import type { AiTaskType } from '@motion/domain'
import type { Database, SqlRow } from '../../db/sqlite/Database'
import type { AiSettings } from './aiSettings'

export interface CoachContext extends Record<string, unknown> {
  localDate: string
  training?: Record<string, unknown>
  nutrition?: Record<string, unknown>
  plans?: Record<string, unknown>
  bodyTrend?: Record<string, unknown>
  health?: Record<string, unknown>
}

function minusDays(localDate: string, days: number): string {
  const value = new Date(`${localDate}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - days)
  return value.toISOString().slice(0, 10)
}

export class AiContextBuilder {
  constructor(private readonly db: Database) {}
  async build(task: AiTaskType, localDate: string, settings: AiSettings): Promise<Record<string, unknown>> {
    if (task !== 'COACH') return { localDate }
    const context: CoachContext = { localDate }
    if (settings.context.trainingToday) context.training = await this.training(localDate)
    if (settings.context.nutritionToday) context.nutrition = await this.nutrition(localDate)
    if (settings.context.currentPlans) context.plans = await this.plans()
    if (settings.context.bodyTrend) context.bodyTrend = await this.body(localDate)
    if (settings.context.healthSummary) context.health = await this.health(localDate)
    return context
  }

  private async training(localDate: string) {
    const session = (await this.db.query<{ lifecycle_status: string; duration_minutes: number | null }>(
      `SELECT lifecycle_status,duration_minutes FROM training_sessions
       WHERE local_date=? ORDER BY started_at DESC LIMIT 1`, [localDate]))[0]
    const planned = (await this.db.query<{ status: string; title: string | null; day_index: number }>(`SELECT rd.status,pd.title,pd.day_index
      FROM training_plan_run_days rd JOIN training_plan_days pd ON pd.id=rd.training_plan_day_id
      JOIN training_plan_runs r ON r.id=rd.training_plan_run_id
      WHERE rd.scheduled_local_date=? AND r.status IN ('ACTIVE','PAUSED') LIMIT 1`, [localDate]))[0]
    const streak = (await this.db.query<{ current_streak: number }>('SELECT current_streak FROM streak_state WHERE singleton_key=1'))[0]
    const weekly = (await this.db.query<{ achieved_active_days: number; target_active_days: number }>(
      "SELECT achieved_active_days,target_active_days FROM weekly_goals WHERE status='ACTIVE' ORDER BY week_start_date DESC LIMIT 1"))[0]
    return { latestSessionStatus: session?.lifecycle_status ?? 'NONE',
      completedMinutes: session?.duration_minutes == null ? null : Math.round(session.duration_minutes),
      plannedDay: planned ? { status: planned.status, title: planned.title, dayIndex: planned.day_index } : null,
      currentStreakDays: streak?.current_streak ?? 0,
      weeklyGoal: weekly ? { achieved: weekly.achieved_active_days, target: weekly.target_active_days } : null }
  }

  private async nutrition(localDate: string) {
    const summary = (await this.db.query<{ calories: number | null; protein: number | null;
      calorie_unknown: number; protein_unknown: number; entries: number }>(`SELECT SUM(f.calories_kcal) AS calories,
      SUM(f.protein_g) AS protein,SUM(CASE WHEN f.calories_kcal IS NULL THEN 1 ELSE 0 END) AS calorie_unknown,
      SUM(CASE WHEN f.protein_g IS NULL THEN 1 ELSE 0 END) AS protein_unknown,COUNT(f.id) AS entries
      FROM meals m LEFT JOIN food_entries f ON f.meal_id=m.id WHERE m.local_date=?`, [localDate]))[0]
    const target = (await this.db.query<{ calories_min: number; calories_max: number; protein_min_g: number; protein_max_g: number }>(
      'SELECT calories_min,calories_max,protein_min_g,protein_max_g FROM daily_nutrition_targets WHERE local_date=?', [localDate]))[0]
    return { knownCaloriesKcal: summary?.calories ?? null, knownProteinG: summary?.protein ?? null,
      calorieUnknownEntries: summary?.calorie_unknown ?? 0, proteinUnknownEntries: summary?.protein_unknown ?? 0,
      entryCount: summary?.entries ?? 0, target: target ?? null,
      loggingComplete: !!summary?.entries && summary.calorie_unknown === 0 && summary.protein_unknown === 0 }
  }

  private async plans() {
    const training = (await this.db.query<{ title: string; current_day_index: number | null; status: string }>(`SELECT p.title,r.current_day_index,r.status
      FROM training_plan_runs r JOIN training_plans p ON p.id=r.training_plan_id
      WHERE r.status IN ('ACTIVE','PAUSED') LIMIT 1`))[0]
    const nutrition = (await this.db.query<{ base_strategy: string; high_protein: number; tre_enabled: number;
      tre_start_local_time: string | null; tre_window_minutes: number | null }>(`SELECT base_strategy,high_protein,tre_enabled,
      tre_start_local_time,tre_window_minutes FROM nutrition_plan_runs WHERE status='ACTIVE' LIMIT 1`))[0]
    return { training: training ?? null, nutrition: nutrition ? { ...nutrition,
      high_protein: nutrition.high_protein === 1, tre_enabled: nutrition.tre_enabled === 1 } : null }
  }

  private async body(localDate: string) {
    const rows = await this.db.query<{ measured_at: string; local_date: string; weight_kg: number }>(`SELECT measured_at,local_date,weight_kg
      FROM body_measurements WHERE weight_kg IS NOT NULL AND local_date BETWEEN ? AND ?
      ORDER BY measured_at DESC,created_at DESC`, [minusDays(localDate, 30), localDate])
    const latest = rows[0], earliest = rows.at(-1)
    return { latestWeightKg: latest?.weight_kg ?? null, latestDate: latest?.local_date ?? null,
      change30dKg: latest && earliest ? Math.round((latest.weight_kg - earliest.weight_kg) * 10) / 10 : null,
      measurementCount: rows.length }
  }

  private async health(localDate: string) {
    const row = (await this.db.query<SqlRow>(`SELECT local_date,steps,active_calories_kcal,exercise_minutes,
      sleep_minutes,resting_heart_rate,average_heart_rate FROM health_daily_summaries
      WHERE local_date<=? ORDER BY local_date DESC LIMIT 1`, [localDate]))[0]
    return row ?? { localDate: null, available: false }
  }
}
