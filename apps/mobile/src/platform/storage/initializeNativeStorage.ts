import { Capacitor } from '@capacitor/core'
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'

import { logger } from '../../app/logger'

const DATABASE_NAME = 'motion'
const PROBE_KEY = 'installation'

export type StorageProbeResult =
  | { status: 'skipped'; reason: 'web' }
  | { status: 'ready'; reusedExistingRecord: boolean }

export async function initializeNativeStorage(): Promise<StorageProbeResult> {
  if (!Capacitor.isNativePlatform()) {
    logger.info('Native SQLite persistence probe skipped in web runtime')
    return { status: 'skipped', reason: 'web' }
  }

  const sqlite = new SQLiteConnection(CapacitorSQLite)
  let database: SQLiteDBConnection | undefined

  try {
    const existingConnection = await sqlite.isConnection(DATABASE_NAME, false)
    database = existingConnection.result
      ? await sqlite.retrieveConnection(DATABASE_NAME, false)
      : await sqlite.createConnection(
          DATABASE_NAME,
          false,
          'no-encryption',
          1,
          false,
        )

    const isOpen = await database.isDBOpen()
    if (!isOpen.result) {
      await database.open()
    }

    await database.execute(`
      CREATE TABLE IF NOT EXISTS m0_storage_probe (
        probe_key TEXT PRIMARY KEY NOT NULL,
        probe_value TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)

    const existing = await database.query(
      'SELECT probe_value FROM m0_storage_probe WHERE probe_key = ? LIMIT 1;',
      [PROBE_KEY],
    )
    const reusedExistingRecord = existing.values?.length === 1

    if (!reusedExistingRecord) {
      await database.run(
        `INSERT INTO m0_storage_probe (probe_key, probe_value, created_at)
         VALUES (?, ?, ?);`,
        [PROBE_KEY, crypto.randomUUID(), new Date().toISOString()],
      )
    }

    const verification = await database.query(
      'SELECT probe_key FROM m0_storage_probe WHERE probe_key = ? LIMIT 1;',
      [PROBE_KEY],
    )

    if (verification.values?.length !== 1) {
      throw new Error('SQLite persistence probe could not read its test record')
    }

    logger.info('Native SQLite persistence probe passed', {
      reusedExistingRecord,
    })

    return { status: 'ready', reusedExistingRecord }
  } finally {
    if (database) {
      const isOpen = await database.isDBOpen()
      if (isOpen.result) {
        await database.close()
      }
      await sqlite.closeConnection(DATABASE_NAME, false)
    }
  }
}
