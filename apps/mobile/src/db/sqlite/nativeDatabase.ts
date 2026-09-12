import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import { Database, type SqlDriver, type SqlRow, type SqlValue } from './Database'
import { migrateDatabase } from '../migrations'

const DATABASE_NAME = 'motion'
let databasePromise: Promise<Database> | undefined

class NativeDriver implements SqlDriver {
  constructor(private readonly connection: SQLiteDBConnection) {}

  async query<T extends SqlRow>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    const result = await this.connection.query(sql, values)
    return (result.values ?? []) as T[]
  }
  async run(sql: string, values: SqlValue[] = []): Promise<void> {
    await this.connection.run(sql, values, false)
  }
  async execute(sql: string): Promise<void> {
    await this.connection.execute(sql, false)
  }
  async begin(): Promise<void> { await this.connection.beginTransaction() }
  async commit(): Promise<void> { await this.connection.commitTransaction() }
  async rollback(): Promise<void> { await this.connection.rollbackTransaction() }
}

async function openDatabase(): Promise<Database> {
  const sqlite = new SQLiteConnection(CapacitorSQLite)
  const existing = await sqlite.isConnection(DATABASE_NAME, false)
  const connection = existing.result
    ? await sqlite.retrieveConnection(DATABASE_NAME, false)
    : await sqlite.createConnection(DATABASE_NAME, false, 'no-encryption', 1, false)
  try {
    if (!(await connection.isDBOpen()).result) await connection.open()
    const db = new Database(new NativeDriver(connection))
    await migrateDatabase(db)
    return db
  } catch (error) {
    if ((await connection.isDBOpen()).result) await connection.close()
    await sqlite.closeConnection(DATABASE_NAME, false)
    throw error
  }
}

export function getNativeDatabase(): Promise<Database> {
  databasePromise ??= openDatabase().catch((error: unknown) => {
    databasePromise = undefined
    throw error
  })
  return databasePromise
}
