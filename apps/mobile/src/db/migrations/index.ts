import coreSchema from './001_core_schema.sql?raw'
import seedActivityTypes from './002_seed_activity_types.sql?raw'
import zhCnDefaultLocale from './003_zh_cn_default_locale.sql?raw'
import workoutPreferences from './004_workout_preferences.sql?raw'
import pendingTodaySelection from './005_pending_today_selection.sql?raw'
import rescuePreferences from './006_rescue_preferences.sql?raw'
import nutritionCore from './007_nutrition_core.sql?raw'
import nutritionPlans from './008_nutrition_plans.sql?raw'
import bodyHealth from './009_body_health.sql?raw'
import type { Database, SqlAccess } from '../sqlite/Database'

export interface Migration {
  version: number
  sql: string
}

export const migrations: readonly Migration[] = [
  { version: 1, sql: coreSchema },
  { version: 2, sql: seedActivityTypes },
  { version: 3, sql: zhCnDefaultLocale },
  { version: 4, sql: workoutPreferences },
  { version: 5, sql: pendingTodaySelection },
  { version: 6, sql: rescuePreferences },
  { version: 7, sql: nutritionCore },
  { version: 8, sql: nutritionPlans },
  { version: 9, sql: bodyHealth },
]

export async function migrateDatabase(db: Database, steps: readonly Migration[] = migrations): Promise<number> {
  await db.execute('PRAGMA foreign_keys = ON;')
  const fk = await db.query<{ foreign_keys: number }>('PRAGMA foreign_keys;')
  if (fk[0]?.foreign_keys !== 1) throw new Error('SQLite foreign keys could not be enabled')

  const versionRows = await db.query<{ user_version: number }>('PRAGMA user_version;')
  let version = versionRows[0]?.user_version ?? 0
  const latest = steps.at(-1)?.version ?? 0
  if (version > latest) throw new Error(`Database schema ${version} is newer than this app supports (${latest})`)

  for (const step of steps) {
    if (step.version <= version) continue
    if (step.version !== version + 1) throw new Error(`Missing migration after schema ${version}`)
    await db.transaction(async (tx: SqlAccess) => {
      await tx.execute(step.sql)
      await tx.execute(`PRAGMA user_version = ${step.version};`)
    })
    version = step.version
  }

  const violations = await db.query<{ table: string }>('PRAGMA foreign_key_check;')
  if (violations.length > 0) throw new Error('Database contains broken historical references')
  return version
}
