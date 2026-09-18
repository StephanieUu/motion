import { registerPlugin } from '@capacitor/core'
import type { HealthConnectAvailability, HealthDailySummary } from '@motion/domain'

export type HealthRecordType = 'Weight' | 'BodyFat' | 'Steps' | 'ExerciseSession' | 'ActiveCaloriesBurned' |
  'SleepSession' | 'RestingHeartRate' | 'HeartRate'
export interface NativeBodyRecord {
  externalRecordId: string; recordType: 'Weight' | 'BodyFat'; measuredAt: string; localDate: string
  value: number; sourceApp: string | null
}
export interface HealthSyncResult {
  upserts: NativeBodyRecord[]; deletions: string[]; summaries: HealthDailySummary[]
  nextToken: string | null; tokenExpired?: boolean
}
export interface HealthConnectPlugin {
  availability(): Promise<{ status: HealthConnectAvailability }>
  grantedPermissions(): Promise<{ recordTypes: HealthRecordType[] }>
  requestHealthPermissions(options: { recordTypes: HealthRecordType[] }): Promise<{ recordTypes: HealthRecordType[] }>
  syncRecord(options: { recordType: HealthRecordType; changesToken?: string; from: string; through: string
    zoneId: string; summaryZones: Record<string, string> }): Promise<HealthSyncResult>
}
export interface BodyOcrPlugin {
  chooseAndRecognize(): Promise<{ text: string }>
}
export const HealthConnect = registerPlugin<HealthConnectPlugin>('MotionHealthConnect')
export const BodyOcr = registerPlugin<BodyOcrPlugin>('MotionBodyOcr')
