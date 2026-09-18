import { addLocalDays, bodyTrend, bodyTrendRange, localDateAtStart, parseBodyMeasurementOcr,
  resolveBodyMetricSnapshot, type BodyMeasurement, type BodyMetricKey, type BodyMetricSnapshot,
  type BodyMetricValues, type BodyTrendPoint, type HealthConnectAvailability,
  type HealthDailySummary } from '@motion/domain'
import { BodyRepository, type BodyMeasurementInput } from '../../db/repositories/BodyRepository'
import { getNativeDatabase } from '../../db/sqlite/nativeDatabase'
import { BodyOcr, HealthConnect, type BodyOcrPlugin, type HealthConnectPlugin,
  type HealthRecordType } from '../../platform/body/bodyNative'

export interface BodyOverview {
  snapshot: BodyMetricSnapshot; weightTrend: BodyTrendPoint[]; bodyFatTrend: BodyTrendPoint[]
  yesterdaySummary: HealthDailySummary | null; records: BodyMeasurement[]
}
export interface OcrDraft { importId: string; rawText: string; values: Partial<BodyMetricValues> }
const healthTypes: readonly HealthRecordType[] = ['Weight', 'BodyFat', 'Steps', 'ExerciseSession',
  'ActiveCaloriesBurned', 'SleepSession', 'RestingHeartRate', 'HeartRate']

export class BodyService {
  constructor(private readonly repository: BodyRepository, private readonly health: HealthConnectPlugin = HealthConnect,
    private readonly ocr: BodyOcrPlugin = BodyOcr, private readonly now: () => Date = () => new Date(),
    private readonly zoneId: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone) {}

  async overview(): Promise<BodyOverview> {
    const today = localDateAtStart(this.now()), range = bodyTrendRange(today, '30D')
    const [records, yesterdaySummary] = await Promise.all([this.repository.measurements(),
      this.repository.summary(addLocalDays(today, -1))])
    return { snapshot: resolveBodyMetricSnapshot(records),
      weightTrend: bodyTrend(records, 'weightKg', range.from, range.through),
      bodyFatTrend: bodyTrend(records, 'bodyFatPercent', range.from, range.through),
      yesterdaySummary, records }
  }
  async summary(localDate = localDateAtStart(this.now())): Promise<HealthDailySummary | null> {
    return this.repository.summary(localDate)
  }
  async trends(metric: BodyMetricKey, range: '30D' | '3M' | '1Y'): Promise<BodyTrendPoint[]> {
    const dates = bodyTrendRange(localDateAtStart(this.now()), range)
    return bodyTrend(await this.repository.measurements(dates.from, dates.through), metric, dates.from, dates.through)
  }
  saveManual(input: Omit<BodyMeasurementInput, 'sourceType' | 'userVerified'>): Promise<BodyMeasurement> {
    return this.repository.insert({ ...input, sourceType: 'MANUAL', userVerified: true })
  }
  edit(id: string, input: Partial<BodyMetricValues> & { measuredAt: string; localDate: string }): Promise<void> {
    return this.repository.updateUserRecord(id, input)
  }
  delete(id: string): Promise<void> { return this.repository.deleteUserRecord(id) }

  async recognizeScreenshot(): Promise<OcrDraft> {
    const importId = await this.repository.createImport()
    try {
      const result = await this.ocr.chooseAndRecognize()
      const values = parseBodyMeasurementOcr(result.text)
      await this.repository.parsedImport(importId, result.text, values)
      return { importId, rawText: result.text, values }
    } catch (cause) {
      const category = cause instanceof Error && cause.message.includes('IMAGE_NOT_SELECTED')
        ? 'IMAGE_NOT_SELECTED' : 'OCR_FAILED'
      if (category === 'IMAGE_NOT_SELECTED') await this.repository.rejectImport(importId, category)
      else await this.repository.failImport(importId, category)
      throw cause
    }
  }
  confirmScreenshot(draft: OcrDraft, input: Omit<BodyMeasurementInput, 'sourceType' | 'userVerified'>) {
    return this.repository.confirmImport(draft.importId, { ...input, rawDataJson: JSON.stringify({ ocr: draft.values }) })
  }
  availability(): Promise<{ status: HealthConnectAvailability }> { return this.health.availability() }
  grantedPermissions() { return this.health.grantedPermissions() }
  requestPermissions(recordTypes: HealthRecordType[]) { return this.health.requestHealthPermissions({ recordTypes }) }

  async sync(): Promise<void> {
    const availability = await this.health.availability()
    if (availability.status !== 'AVAILABLE') {
      for (const type of healthTypes) await this.repository.setSyncState(type, 'UNAVAILABLE', null, null)
      return
    }
    const granted = new Set((await this.health.grantedPermissions()).recordTypes)
    const today = localDateAtStart(this.now()), from = bodyTrendRange(today, '30D').from
    const zoneId = this.zoneId()
    const summaryZones = await this.repository.summaryZones(from, today)
    for (const recordType of healthTypes) {
      if (!granted.has(recordType)) { await this.repository.setSyncState(recordType, 'PERMISSION_MISSING', null, null); continue }
      try {
        const token = await this.repository.syncToken(recordType)
        let result = await this.health.syncRecord({ recordType, from, through: today, zoneId, summaryZones,
          ...(token ? { changesToken: token } : {}) })
        if (result.tokenExpired) result = await this.health.syncRecord({ recordType, from, through: today,
          zoneId, summaryZones })
        if (result.tokenExpired || !result.nextToken) throw new Error('HEALTH_SYNC_TOKEN_UNAVAILABLE')
        await this.repository.transaction(async (tx) => {
          for (const item of result.upserts) await this.repository.upsertHealth({ measuredAt: item.measuredAt,
            localDate: item.localDate, externalRecordId: item.externalRecordId, sourceApp: item.sourceApp,
            ...(item.recordType === 'Weight' ? { weightKg: item.value } : { bodyFatPercent: item.value }) }, tx)
          if (recordType === 'Weight' || recordType === 'BodyFat')
            for (const id of result.deletions) await this.repository.deleteHealthExternal(id, tx)
          for (const summary of result.summaries) await this.repository.upsertSummary(summary, tx, recordType)
          await this.repository.setSyncState(recordType, 'SYNCED', result.nextToken, null, tx)
        })
      } catch {
        await this.repository.setSyncState(recordType, 'ERROR', null, 'SYNC_FAILED')
      }
    }
  }
}

export async function openBodyService(): Promise<BodyService> {
  return new BodyService(new BodyRepository(await getNativeDatabase()))
}
