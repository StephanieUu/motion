import type { AiErrorCode, AiProvider, AiRoute, AiTaskType, AiUsageStatus } from '@motion/domain'
import type { Database, SqlAccess, SqlRow } from '../sqlite/Database'

export interface AiUsageEventInput {
  id?: string
  provider: AiProvider
  model: string
  taskType: AiTaskType
  route: AiRoute
  status: AiUsageStatus
  usedFreeTier: boolean | null
  inputTokens?: number | null
  outputTokens?: number | null
  estimatedCostCny?: number | null
  startedAt: string
  completedAt?: string | null
  errorCode?: AiErrorCode | null
}

export interface CoachThread extends SqlRow { id: string; title: string | null; created_at: string; updated_at: string }
export interface CoachMessage extends SqlRow {
  id: string; thread_id: string; role: 'USER' | 'ASSISTANT'; content: string; created_at: string
}

export class AiRepository {
  constructor(readonly db: Database) {}

  async recordUsage(input: AiUsageEventInput, tx: SqlAccess = this.db): Promise<string> {
    const id = input.id ?? crypto.randomUUID()
    await tx.run(`INSERT INTO ai_usage_events
      (id,provider,model,task_type,route,status,used_free_tier,input_tokens,output_tokens,
       estimated_cost_cny,started_at,completed_at,error_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.provider, input.model, input.taskType, input.route, input.status,
      input.usedFreeTier === null ? null : Number(input.usedFreeTier), input.inputTokens ?? null,
      input.outputTokens ?? null, input.estimatedCostCny ?? null, input.startedAt,
      input.completedAt ?? null, input.errorCode ?? null])
    return id
  }

  async paidSpendCny(monthUtc: string, tx: SqlAccess = this.db): Promise<number> {
    if (!/^\d{4}-\d{2}$/.test(monthUtc)) throw new Error('Invalid UTC month')
    const start = `${monthUtc}-01T00:00:00.000Z`
    const [year, month] = monthUtc.split('-').map(Number)
    const end = new Date(Date.UTC(year!, month!, 1)).toISOString()
    return (await tx.query<{ total: number | null }>(`SELECT SUM(estimated_cost_cny) AS total
      FROM ai_usage_events WHERE provider='DEEPSEEK'
      AND status IN ('RESERVED','SUCCESS','FAILED','CANCELLED')
      AND started_at>=? AND started_at<?`, [start, end]))[0]?.total ?? 0
  }

  async reservePaidUsage(input: Omit<AiUsageEventInput, 'id' | 'status' | 'completedAt' | 'errorCode'>,
    monthUtc: string, monthlyBudgetCny: number): Promise<string | null> {
    if (!Number.isFinite(input.estimatedCostCny) || (input.estimatedCostCny ?? 0) <= 0) return null
    return this.db.transaction(async (tx) => {
      const spent = await this.paidSpendCny(monthUtc, tx)
      if (monthlyBudgetCny <= 0 || spent + input.estimatedCostCny! > monthlyBudgetCny) return null
      const id = crypto.randomUUID()
      await this.recordUsage({ ...input, id, status: 'RESERVED', completedAt: null, errorCode: null }, tx)
      return id
    })
  }

  completeUsage(id: string, input: Pick<AiUsageEventInput, 'status' | 'inputTokens' | 'outputTokens' |
    'estimatedCostCny' | 'completedAt' | 'errorCode'>): Promise<void> {
    return this.db.run(`UPDATE ai_usage_events SET status=?,input_tokens=?,output_tokens=?,estimated_cost_cny=?,
      completed_at=?,error_code=? WHERE id=? AND status='RESERVED'`, [input.status, input.inputTokens ?? null,
      input.outputTokens ?? null, input.estimatedCostCny ?? null, input.completedAt ?? null,
      input.errorCode ?? null, id])
  }

  async getOrCreateThread(): Promise<CoachThread> {
    const current = (await this.db.query<CoachThread>(
      'SELECT * FROM coach_threads ORDER BY updated_at DESC,id DESC LIMIT 1'))[0]
    if (current) return current
    const now = new Date().toISOString()
    const thread: CoachThread = { id: crypto.randomUUID(), title: null, created_at: now, updated_at: now }
    await this.db.run('INSERT INTO coach_threads (id,title,created_at,updated_at) VALUES (?,?,?,?)',
      [thread.id, thread.title, thread.created_at, thread.updated_at])
    return thread
  }

  async addMessage(threadId: string, role: CoachMessage['role'], content: string): Promise<CoachMessage> {
    const trimmed = content.trim()
    if (!trimmed) throw new Error('Coach message is required')
    const now = new Date().toISOString()
    const message: CoachMessage = { id: crypto.randomUUID(), thread_id: threadId, role, content: trimmed, created_at: now }
    await this.db.transaction(async (tx) => {
      await tx.run('INSERT INTO coach_messages (id,thread_id,role,content,created_at) VALUES (?,?,?,?,?)',
        [message.id, message.thread_id, message.role, message.content, message.created_at])
      await tx.run('UPDATE coach_threads SET updated_at=? WHERE id=?', [now, threadId])
    })
    return message
  }

  messages(threadId: string): Promise<CoachMessage[]> {
    return this.db.query<CoachMessage>(
      'SELECT * FROM coach_messages WHERE thread_id=? ORDER BY created_at,id', [threadId])
  }

  async recentMessages(threadId: string, limit = 6): Promise<CoachMessage[]> {
    const safeLimit = Math.max(1, Math.min(12, Math.floor(limit)))
    const rows = await this.db.query<CoachMessage>(`SELECT * FROM coach_messages WHERE thread_id=?
      ORDER BY created_at DESC,id DESC LIMIT ?`, [threadId, safeLimit])
    return rows.reverse()
  }
}
