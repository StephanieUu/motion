import type { BodyConfidenceLevel, BodyMeasurement, BodyMetricValues, BodySourceType,
  HealthDailySummary } from '@motion/domain'
import type { Database, SqlAccess, SqlRow } from '../sqlite/Database'

export interface BodyMeasurementRow extends SqlRow {
  id: string; measured_at: string; local_date: string; source_type: BodySourceType
  weight_kg: number | null; body_fat_percent: number | null; bmi: number | null; fat_mass_kg: number | null
  muscle_mass_kg: number | null; skeletal_muscle: number | null; body_water_percent: number | null
  visceral_fat_level: number | null; bone_mass_kg: number | null; bmr_kcal: number | null; body_age: number | null
  raw_data_json: string | null; confidence_level: BodyConfidenceLevel | null; user_verified: number
  external_record_id: string | null; source_app: string | null; created_at: string; updated_at: string
}
export interface HealthDailySummaryRow extends SqlRow {
  local_date: string; steps: number | null; active_calories_kcal: number | null; exercise_minutes: number | null
  sleep_minutes: number | null; resting_heart_rate: number | null; average_heart_rate: number | null
  source_summary_json: string | null; last_synced_at: string
}
export interface BodyMeasurementInput extends Partial<BodyMetricValues> {
  measuredAt: string; localDate: string; sourceType: BodySourceType; rawDataJson?: string | null
  confidenceLevel?: BodyConfidenceLevel | null; userVerified: boolean; externalRecordId?: string | null
  sourceApp?: string | null
}

const metricColumns = `weight_kg,body_fat_percent,bmi,fat_mass_kg,muscle_mass_kg,skeletal_muscle,
  body_water_percent,visceral_fat_level,bone_mass_kg,bmr_kcal,body_age`
const columns = `id,measured_at,local_date,source_type,${metricColumns},raw_data_json,confidence_level,
  user_verified,external_record_id,source_app,created_at,updated_at`

function domain(row: BodyMeasurementRow): BodyMeasurement {
  return { id: row.id, measuredAt: row.measured_at, localDate: row.local_date, sourceType: row.source_type,
    weightKg: row.weight_kg, bodyFatPercent: row.body_fat_percent, bmi: row.bmi, fatMassKg: row.fat_mass_kg,
    muscleMassKg: row.muscle_mass_kg, skeletalMuscle: row.skeletal_muscle,
    bodyWaterPercent: row.body_water_percent, visceralFatLevel: row.visceral_fat_level,
    boneMassKg: row.bone_mass_kg, bmrKcal: row.bmr_kcal, bodyAge: row.body_age,
    rawDataJson: row.raw_data_json, confidenceLevel: row.confidence_level, userVerified: row.user_verified === 1,
    externalRecordId: row.external_record_id, sourceApp: row.source_app, createdAt: row.created_at,
    updatedAt: row.updated_at }
}
function metrics(input: Partial<BodyMetricValues>): Array<number | null> {
  return [input.weightKg ?? null, input.bodyFatPercent ?? null, input.bmi ?? null, input.fatMassKg ?? null,
    input.muscleMassKg ?? null, input.skeletalMuscle ?? null, input.bodyWaterPercent ?? null,
    input.visceralFatLevel ?? null, input.boneMassKg ?? null, input.bmrKcal ?? null, input.bodyAge ?? null]
}

export class BodyRepository {
  constructor(private readonly db: Database) {}
  transaction<T>(work: (tx: SqlAccess) => Promise<T>): Promise<T> { return this.db.transaction(work) }

  async measurements(from?: string, through?: string, tx: SqlAccess = this.db): Promise<BodyMeasurement[]> {
    const where = from && through ? 'WHERE local_date BETWEEN ? AND ?' : ''
    const rows = await tx.query<BodyMeasurementRow>(`SELECT ${columns} FROM body_measurements ${where}
      ORDER BY measured_at DESC,updated_at DESC`, from && through ? [from, through] : [])
    return rows.map(domain)
  }

  async measurement(id: string, tx: SqlAccess = this.db): Promise<BodyMeasurement | null> {
    const row = (await tx.query<BodyMeasurementRow>(`SELECT ${columns} FROM body_measurements WHERE id=?`, [id]))[0]
    return row ? domain(row) : null
  }

  async insert(input: BodyMeasurementInput, tx: SqlAccess = this.db): Promise<BodyMeasurement> {
    if (!metrics(input).some((value) => value !== null)) throw new Error('At least one body metric is required')
    const id = crypto.randomUUID(), now = new Date().toISOString()
    await tx.run(`INSERT INTO body_measurements (${columns}) VALUES (${Array(22).fill('?').join(',')})`,
      [id, input.measuredAt, input.localDate, input.sourceType, ...metrics(input), input.rawDataJson ?? null,
        input.confidenceLevel ?? null, Number(input.userVerified), input.externalRecordId ?? null,
        input.sourceApp ?? null, now, now])
    return (await this.measurement(id, tx))!
  }

  async upsertHealth(input: Omit<BodyMeasurementInput, 'sourceType' | 'userVerified'> &
    { externalRecordId: string }, tx: SqlAccess = this.db): Promise<BodyMeasurement> {
    const existing = (await tx.query<BodyMeasurementRow>(`SELECT ${columns} FROM body_measurements
      WHERE source_type='HEALTH_CONNECT' AND external_record_id=?`, [input.externalRecordId]))[0]
    if (existing?.user_verified === 1) return domain(existing)
    const now = new Date().toISOString()
    if (!existing) return this.insert({ ...input, sourceType: 'HEALTH_CONNECT', userVerified: false }, tx)
    await tx.run(`UPDATE body_measurements SET measured_at=?,local_date=?,${metricColumns.split(',').map((c) => `${c.trim()}=?`).join(',')},
      raw_data_json=?,confidence_level=?,source_app=?,updated_at=? WHERE id=?`,
    [input.measuredAt, input.localDate, ...metrics(input), input.rawDataJson ?? null, input.confidenceLevel ?? null,
      input.sourceApp ?? null, now, existing.id])
    return (await this.measurement(existing.id, tx))!
  }

  async updateUserRecord(id: string, input: Partial<BodyMetricValues> & { measuredAt: string; localDate: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await this.measurement(id, tx)
      if (!existing || !['MANUAL', 'SCREENSHOT_OCR', 'HEALTH_CONNECT'].includes(existing.sourceType))
        throw new Error('Record is source-managed')
      const next: Partial<BodyMetricValues> = { weightKg: existing.weightKg, bodyFatPercent: existing.bodyFatPercent,
        bmi: existing.bmi, fatMassKg: existing.fatMassKg, muscleMassKg: existing.muscleMassKg,
        skeletalMuscle: existing.skeletalMuscle, bodyWaterPercent: existing.bodyWaterPercent,
        visceralFatLevel: existing.visceralFatLevel, boneMassKg: existing.boneMassKg,
        bmrKcal: existing.bmrKcal, bodyAge: existing.bodyAge, ...input }
      if (!metrics(next).some((value) => value !== null)) throw new Error('At least one body metric is required')
      await tx.run(`UPDATE body_measurements SET measured_at=?,local_date=?,${metricColumns.split(',').map((c) => `${c.trim()}=?`).join(',')},
        user_verified=1,updated_at=? WHERE id=?`, [input.measuredAt, input.localDate, ...metrics(next),
        new Date().toISOString(), id])
    })
  }

  async deleteUserRecord(id: string): Promise<void> {
    await this.db.run("DELETE FROM body_measurements WHERE id=? AND source_type IN ('MANUAL','SCREENSHOT_OCR')", [id])
  }
  async deleteHealthExternal(externalRecordId: string, tx: SqlAccess = this.db): Promise<void> {
    await tx.run(`DELETE FROM body_measurements WHERE source_type='HEALTH_CONNECT' AND external_record_id=?
      AND user_verified=0`, [externalRecordId])
  }

  async createImport(): Promise<string> {
    const id = crypto.randomUUID()
    await this.db.run(`INSERT INTO measurement_imports (id,source_type,status,imported_at)
      VALUES (?,'SCREENSHOT_OCR','RECEIVED',?)`, [id, new Date().toISOString()])
    return id
  }
  async parsedImport(id: string, rawText: string, parsed: Partial<BodyMetricValues>): Promise<void> {
    await this.db.run(`UPDATE measurement_imports SET raw_ocr_text=?,parsed_data_json=?,status='PARSED',error_message=NULL
      WHERE id=?`, [rawText, JSON.stringify(parsed), id])
  }
  async failImport(id: string, message: string): Promise<void> {
    await this.db.run("UPDATE measurement_imports SET status='FAILED',error_message=? WHERE id=?", [message, id])
  }
  async rejectImport(id: string, reason: string): Promise<void> {
    await this.db.run("UPDATE measurement_imports SET status='REJECTED',error_message=? WHERE id=?", [reason, id])
  }
  async confirmImport(id: string, input: Omit<BodyMeasurementInput, 'sourceType' | 'userVerified'>): Promise<BodyMeasurement> {
    return this.db.transaction(async (tx) => {
      const measurement = await this.insert({ ...input, sourceType: 'SCREENSHOT_OCR', userVerified: true }, tx)
      await tx.run(`UPDATE measurement_imports SET status='CONFIRMED',resulting_measurement_id=?,confirmed_at=? WHERE id=?`,
        [measurement.id, new Date().toISOString(), id])
      return measurement
    })
  }

  async upsertSummary(summary: HealthDailySummary, tx: SqlAccess = this.db, recordType?: string): Promise<void> {
    const metricColumn: Record<string, string> = { Steps:'steps', ActiveCaloriesBurned:'active_calories_kcal',
      ExerciseSession:'exercise_minutes', SleepSession:'sleep_minutes', RestingHeartRate:'resting_heart_rate',
      HeartRate:'average_heart_rate' }
    const changed = recordType ? metricColumn[recordType] : undefined
    const updates = changed
      ? `${changed}=excluded.${changed},`
      : `steps=COALESCE(excluded.steps,steps),active_calories_kcal=COALESCE(excluded.active_calories_kcal,active_calories_kcal),
      exercise_minutes=COALESCE(excluded.exercise_minutes,exercise_minutes),sleep_minutes=COALESCE(excluded.sleep_minutes,sleep_minutes),
      resting_heart_rate=COALESCE(excluded.resting_heart_rate,resting_heart_rate),
      average_heart_rate=COALESCE(excluded.average_heart_rate,average_heart_rate),`
    await tx.run(`INSERT INTO health_daily_summaries
      (local_date,steps,active_calories_kcal,exercise_minutes,sleep_minutes,resting_heart_rate,
      average_heart_rate,source_summary_json,last_synced_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(local_date) DO UPDATE SET
      ${updates}
      source_summary_json=json_patch(COALESCE(source_summary_json,'{}'),COALESCE(excluded.source_summary_json,'{}')),
      last_synced_at=excluded.last_synced_at`,
    [summary.localDate, summary.steps, summary.activeCaloriesKcal, summary.exerciseMinutes, summary.sleepMinutes,
      summary.restingHeartRate, summary.averageHeartRate, summary.sourceSummaryJson, summary.lastSyncedAt])
  }
  async summary(localDate: string): Promise<HealthDailySummary | null> {
    const row = (await this.db.query<HealthDailySummaryRow>('SELECT * FROM health_daily_summaries WHERE local_date=?', [localDate]))[0]
    return row ? { localDate: row.local_date, steps: row.steps, activeCaloriesKcal: row.active_calories_kcal,
      exerciseMinutes: row.exercise_minutes, sleepMinutes: row.sleep_minutes,
      restingHeartRate: row.resting_heart_rate, averageHeartRate: row.average_heart_rate,
      sourceSummaryJson: row.source_summary_json, lastSyncedAt: row.last_synced_at } : null
  }
  async setSyncState(recordType: string, status: string, changesToken: string | null, error: string | null,
    tx: SqlAccess = this.db): Promise<void> {
    const now = new Date().toISOString()
    await tx.run(`INSERT INTO health_sync_state
      (provider,record_type,last_sync_at,changes_token,status,last_error,updated_at) VALUES ('HEALTH_CONNECT',?,?,?,?,?,?)
      ON CONFLICT(provider,record_type) DO UPDATE SET last_sync_at=excluded.last_sync_at,
      changes_token=CASE WHEN excluded.status='SYNCED' THEN excluded.changes_token ELSE health_sync_state.changes_token END,
      status=excluded.status,last_error=excluded.last_error,updated_at=excluded.updated_at`,
    [recordType, status === 'SYNCED' ? now : null, changesToken, status, error, now])
  }
  async syncToken(recordType: string): Promise<string | null> {
    return (await this.db.query<{ changes_token: string | null }>(`SELECT changes_token FROM health_sync_state
      WHERE provider='HEALTH_CONNECT' AND record_type=?`, [recordType]))[0]?.changes_token ?? null
  }

  async summaryZones(from: string, through: string): Promise<Record<string, string>> {
    const rows = await this.db.query<{ local_date: string; source_summary_json: string | null }>(
      `SELECT local_date,source_summary_json FROM health_daily_summaries WHERE local_date BETWEEN ? AND ?`,
      [from, through])
    const result: Record<string, string> = {}
    for (const row of rows) {
      try {
        const zoneId = (JSON.parse(row.source_summary_json ?? '{}') as { zoneId?: unknown }).zoneId
        if (typeof zoneId === 'string' && zoneId) result[row.local_date] = zoneId
      } catch { /* Invalid JSON cannot enter through the schema constraint. */ }
    }
    return result
  }
}
