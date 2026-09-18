export type BodySourceType = 'BOOHEE' | 'HEALTH_CONNECT' | 'SCREENSHOT_OCR' | 'MANUAL' | 'OTHER'
export type BodyConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'ROUGH'
export type BodyMetricKey = 'weightKg' | 'bodyFatPercent' | 'bmi' | 'fatMassKg' | 'muscleMassKg' |
  'skeletalMuscle' | 'bodyWaterPercent' | 'visceralFatLevel' | 'boneMassKg' | 'bmrKcal' | 'bodyAge'

export interface BodyMeasurement {
  id: string; measuredAt: string; localDate: string; sourceType: BodySourceType
  weightKg: number | null; bodyFatPercent: number | null; bmi: number | null; fatMassKg: number | null
  muscleMassKg: number | null; skeletalMuscle: number | null; bodyWaterPercent: number | null
  visceralFatLevel: number | null; boneMassKg: number | null; bmrKcal: number | null; bodyAge: number | null
  rawDataJson: string | null; confidenceLevel: BodyConfidenceLevel | null; userVerified: boolean
  externalRecordId: string | null; sourceApp: string | null; createdAt: string; updatedAt: string
}

export type BodyMetricValues = Pick<BodyMeasurement, BodyMetricKey>
export interface BodyMetricValue { value: number; measurementId: string; measuredAt: string; sourceType: BodySourceType }
export type BodyMetricSnapshot = Partial<Record<BodyMetricKey, BodyMetricValue>>
export interface BodyTrendPoint { localDate: string; measuredAt: string; value: number; measurementId: string }
export interface HealthDailySummary {
  localDate: string; steps: number | null; activeCaloriesKcal: number | null; exerciseMinutes: number | null
  sleepMinutes: number | null; restingHeartRate: number | null; averageHeartRate: number | null
  sourceSummaryJson: string | null; lastSyncedAt: string
}
export type HealthPermissionGroup = 'BODY' | 'ACTIVITY' | 'RECOVERY'
export type HealthConnectAvailability = 'AVAILABLE' | 'PROVIDER_UPDATE_REQUIRED' | 'UNAVAILABLE' | 'UNSUPPORTED'

export const bodyMetricKeys: readonly BodyMetricKey[] = ['weightKg', 'bodyFatPercent', 'bmi', 'fatMassKg',
  'muscleMassKg', 'skeletalMuscle', 'bodyWaterPercent', 'visceralFatLevel', 'boneMassKg', 'bmrKcal', 'bodyAge']

function preferred(a: BodyMeasurement, b: BodyMeasurement): BodyMeasurement {
  if (a.measuredAt !== b.measuredAt) return a.measuredAt > b.measuredAt ? a : b
  if (a.userVerified !== b.userVerified) return a.userVerified ? a : b
  const sourcePriority: Record<BodySourceType, number> = {
    MANUAL: 5, SCREENSHOT_OCR: 4, HEALTH_CONNECT: 3, BOOHEE: 2, OTHER: 1,
  }
  if (a.sourceType !== b.sourceType) return sourcePriority[a.sourceType] > sourcePriority[b.sourceType] ? a : b
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  return a.id >= b.id ? a : b
}

export function resolveBodyMetricSnapshot(records: readonly BodyMeasurement[]): BodyMetricSnapshot {
  const result: BodyMetricSnapshot = {}
  for (const metric of bodyMetricKeys) {
    const candidates = records.filter((record) => record[metric] !== null)
    if (!candidates.length) continue
    const record = candidates.reduce(preferred)
    result[metric] = { value: record[metric] as number, measurementId: record.id,
      measuredAt: record.measuredAt, sourceType: record.sourceType }
  }
  return result
}

export function bodyTrend(records: readonly BodyMeasurement[], metric: BodyMetricKey,
  fromDate: string, throughDate: string): BodyTrendPoint[] {
  const byDay = new Map<string, BodyMeasurement>()
  for (const record of records) {
    if (record.localDate < fromDate || record.localDate > throughDate || record[metric] === null) continue
    const current = byDay.get(record.localDate)
    byDay.set(record.localDate, current ? preferred(current, record) : record)
  }
  return [...byDay.values()].sort((a, b) => a.localDate.localeCompare(b.localDate))
    .map((record) => ({ localDate: record.localDate, measuredAt: record.measuredAt,
      value: record[metric] as number, measurementId: record.id }))
}

export function bodyTrendRange(today: string, range: '30D' | '3M' | '1Y'): { from: string; through: string } {
  const date = new Date(`${today}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== today) throw new Error('Invalid local date')
  date.setUTCDate(date.getUTCDate() + (range === '30D' ? -29 : range === '3M' ? -89 : -364))
  return { from: date.toISOString().slice(0, 10), through: today }
}

export type ParsedBodyMeasurement = Partial<BodyMetricValues>
const number = String.raw`([0-9]+(?:[.,][0-9]+)?)`
function ocrMeasurementText(raw: string): string {
  const currentMeasurement = raw.split(/\n\s*(?:标准指标|理想指标|同龄人对比)\s*(?:\n|$)/u, 1)[0] ?? raw
  return currentMeasurement.replace(/\u00a0/g, ' ').replace(/[｜|]/g, ' ').replace(/[．。]/g, '.').replace(/公斤/g, 'kg')
    .split(/\r?\n/).map((line) => line.replace(/(?:标准|参考|正常范围|同龄|平均|建议|目标).*$/, '').trim())
    .filter(Boolean).join('\n')
}
function match(text: string, labels: string, unit = ''): number | null {
  const suffix = unit ? `\\s*(?:${unit})?` : ''
  const found = text.match(new RegExp(`(?:${labels})\\s*[:：]?\\s*${number}${suffix}`, 'iu'))
  return found?.[1] ? Number(found[1].replace(',', '.')) : null
}

function matchLastValueOnRow(text: string, labels: string): number | null {
  const found = text.match(new RegExp(`(?:${labels})([^\\n]*)`, 'iu'))
  if (!found) return null
  let candidates = [...(found[1] ?? '').matchAll(new RegExp(number, 'gu'))]
  if (!candidates.length) {
    const followingLine = text.slice((found.index ?? 0) + found[0].length).split('\n').find((line) => line.trim()) ?? ''
    candidates = [...followingLine.matchAll(new RegExp(number, 'gu'))]
  }
  const value = candidates.at(-1)?.[1]
  return value ? Number(value.replace(',', '.')) : null
}

function matchBooheeHeroWeight(text: string): number | null {
  if (!/身体报告/u.test(text)) return null
  const introduction = text.split(/脂肪数据/u, 1)[0] ?? ''
  const found = introduction.match(new RegExp(`${number}\\s*(?:kg|千克)`, 'iu'))
  return found?.[1] ? Number(found[1].replace(',', '.')) : null
}

export function parseBodyMeasurementOcr(raw: string): ParsedBodyMeasurement {
  const text = ocrMeasurementText(raw)
  const parsed: ParsedBodyMeasurement = {}
  const values: Array<[BodyMetricKey, number | null]> = [
    ['weightKg', match(text, '当前体重|体重', 'kg|千克') ?? matchBooheeHeroWeight(text)],
    ['bodyFatPercent', match(text, '体脂肪率|体脂率|体脂', '%|％')],
    ['bmi', match(text, 'B\\s*M\\s*I')],
    ['fatMassKg', match(text, '脂肪量|脂肪重量|脂肪(?!率)', 'kg|千克')],
    ['muscleMassKg', match(text, '肌肉量|肌肉重量|肌肉重', 'kg|千克')],
    ['skeletalMuscle', match(text, '骨骼肌率', '%|％')],
    ['bodyWaterPercent', matchLastValueOnRow(text, '体水分|水分率|身体水分')],
    ['visceralFatLevel', match(text, '内脏脂肪等级|内脏脂肪', '级')],
    ['boneMassKg', match(text, '骨量', 'kg|千克')],
    ['bmrKcal', match(text, '基础代谢|B\\s*M\\s*R', 'kcal|千卡')],
    ['bodyAge', match(text, '身体年龄|体年龄', '岁')],
  ]
  for (const [key, value] of values) {
    if (value !== null && Number.isFinite(value) && (key !== 'bodyAge' || value > 0)) parsed[key] = value
  }
  return parsed
}
