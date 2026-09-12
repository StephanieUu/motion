export type SqlValue = string | number | null
export type SqlRow = Record<string, unknown>

export interface SqlDriver {
  query<T extends SqlRow>(sql: string, values?: SqlValue[]): Promise<T[]>
  run(sql: string, values?: SqlValue[]): Promise<void>
  execute(sql: string): Promise<void>
  begin(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}

export interface SqlAccess {
  query<T extends SqlRow>(sql: string, values?: SqlValue[]): Promise<T[]>
  run(sql: string, values?: SqlValue[]): Promise<void>
  execute(sql: string): Promise<void>
}

// A single native connection is shared by all repositories. Serializing access also
// prevents unrelated work from entering a transaction between awaited statements.
export class Database implements SqlAccess {
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly driver: SqlDriver) {}

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  query<T extends SqlRow>(sql: string, values?: SqlValue[]): Promise<T[]> {
    return this.enqueue(() => this.driver.query<T>(sql, values))
  }

  run(sql: string, values?: SqlValue[]): Promise<void> {
    return this.enqueue(() => this.driver.run(sql, values))
  }

  execute(sql: string): Promise<void> {
    return this.enqueue(() => this.driver.execute(sql))
  }

  transaction<T>(work: (tx: SqlAccess) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.driver.begin()
      try {
        const value = await work(this.driver)
        await this.driver.commit()
        return value
      } catch (error) {
        try {
          await this.driver.rollback()
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'Transaction and rollback failed', { cause: rollbackError })
        }
        throw error
      }
    })
  }
}
