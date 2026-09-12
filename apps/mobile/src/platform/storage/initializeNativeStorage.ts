import { Capacitor } from '@capacitor/core'
import { logger } from '../../app/logger'
import { getNativeDatabase } from '../../db/sqlite/nativeDatabase'

const PROBE_KEY = 'installation'

export type StorageProbeResult =
  | { status: 'skipped'; reason: 'web' }
  | { status: 'ready'; reusedExistingRecord: boolean }

export async function initializeNativeStorage(): Promise<StorageProbeResult> {
  if (!Capacitor.isNativePlatform()) {
    logger.info('Native SQLite persistence probe skipped in web runtime')
    return { status: 'skipped', reason: 'web' }
  }

  const db = await getNativeDatabase()
  await db.execute(`CREATE TABLE IF NOT EXISTS m0_storage_probe (
    probe_key TEXT PRIMARY KEY NOT NULL,
    probe_value TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`)
  const existing = await db.query<{ present: number }>(
    'SELECT 1 AS present FROM m0_storage_probe WHERE probe_key=? LIMIT 1', [PROBE_KEY])
  const reusedExistingRecord = existing.length === 1
  if (!reusedExistingRecord) {
    await db.run('INSERT INTO m0_storage_probe (probe_key,probe_value,created_at) VALUES (?,?,?)',
      [PROBE_KEY, crypto.randomUUID(), new Date().toISOString()])
  }
  const verification = await db.query<{ probe_key: string }>(
    'SELECT probe_key FROM m0_storage_probe WHERE probe_key=? LIMIT 1', [PROBE_KEY])
  if (verification.length !== 1) throw new Error('SQLite persistence probe could not read its test record')
  logger.info('Native SQLite persistence probe passed', { reusedExistingRecord })
  return { status: 'ready', reusedExistingRecord }
}
