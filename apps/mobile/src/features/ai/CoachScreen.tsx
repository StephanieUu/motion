import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CoachMessage } from '../../db/repositories/AiRepository'
import { AppIcon } from '../../components/AppIcon'
import { logger } from '../../app/logger'
import type { AiService } from './aiService'
import { openAiService } from './aiRuntime'
import './ai.css'

const prompts = ['今天不想练', '给我换一个训练', '今天吃多了', '最近为什么没掉秤']
function contextText(context: Record<string, unknown>, key: string): string {
  const value = context[key]
  if (!value || typeof value !== 'object') return '暂无数据'
  if (key === 'training') {
    const row = value as { latestSessionStatus?: string; currentStreakDays?: number }
    return row.latestSessionStatus === 'COMPLETED' ? '今日训练已完成' : `连续 ${row.currentStreakDays ?? 0} 天`
  }
  if (key === 'nutrition') {
    const row = value as { knownCaloriesKcal?: number | null; target?: { calories_min?: number; calories_max?: number } }
    return row.knownCaloriesKcal == null ? '今日尚无记录' : `${Math.round(row.knownCaloriesKcal)} kcal${row.target ? ` / ${row.target.calories_min}–${row.target.calories_max}` : ''}`
  }
  const row = value as { latestWeightKg?: number | null; change30dKg?: number | null }
  return row.latestWeightKg == null ? '暂无体重' : `${row.latestWeightKg} kg${row.change30dKg == null ? '' : ` · 近 30 天 ${row.change30dKg > 0 ? '+' : ''}${row.change30dKg} kg`}`
}

export function CoachScreen({ suppliedService }: { suppliedService?: AiService }) {
  const navigate = useNavigate(), endRef = useRef<HTMLDivElement>(null)
  const [service, setService] = useState<AiService | null>(suppliedService ?? null)
  const [threadId, setThreadId] = useState(''), [messages, setMessages] = useState<CoachMessage[]>([])
  const [context, setContext] = useState<Record<string, unknown>>({}), [text, setText] = useState('')
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [actions, setActions] = useState<Array<{ label: string; path: string }>>([])
  useEffect(() => { let active = true; void (async () => { try {
    const current = suppliedService ?? await openAiService(); const state = await current.coachState()
    if (active) { setService(current); setThreadId(state.threadId); setMessages(state.messages); setContext(state.context) }
  } catch (cause) { logger.error('Coach load failed', cause); if (active) setError('Coach 暂时无法打开。') }
  finally { if (active) setLoading(false) } })()
    return () => { active = false } }, [suppliedService])
  useEffect(() => { if (typeof endRef.current?.scrollIntoView === 'function') endRef.current.scrollIntoView({ block: 'nearest' }) }, [messages])
  async function send(value: string) {
    if (!service || !threadId || busy || !value.trim()) return
    setBusy(true); setError(''); setActions([])
    const optimistic: CoachMessage = { id: crypto.randomUUID(), thread_id: threadId, role: 'USER', content: value.trim(), created_at: new Date().toISOString() }
    setMessages((current) => [...current, optimistic]); setText('')
    try { const reply = await service.sendCoach(threadId, value); const state = await service.coachState()
      setMessages(state.messages); setActions(reply.actions) }
    catch (cause) { logger.error('Coach send failed', cause); setError('现在暂时无法生成回答。') }
    finally { setBusy(false) }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(text) }
  return <div className="coach-screen">
    <header className="coach-header"><button type="button" onClick={() => navigate(-1)} aria-label="返回">‹</button>
      <div><h1>Coach</h1></div><span aria-hidden="true" /></header>
    <section className="coach-context" aria-label="今日摘要"><button type="button" onClick={() => navigate('/')}>
      <strong>今天 · {new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date())}</strong><AppIcon name="arrow" /></button>
      <div><p><AppIcon name="training" /><span>训练<small>{contextText(context, 'training')}</small></span></p>
        <p><AppIcon name="food" /><span>饮食<small>{contextText(context, 'nutrition')}</small></span></p>
        <p><AppIcon name="body" /><span>体重<small>{contextText(context, 'bodyTrend')}</small></span></p></div></section>
    <section className="coach-conversation" aria-label="对话">
      {!messages.length ? <div className="coach-intro"><span aria-hidden="true">✦</span><p>你可以询问今天的训练、饮食记录、计划或近期身体变化。</p></div> : null}
      {messages.map((message) => <article key={message.id} data-role={message.role}><span>{message.role === 'USER' ? '你' : 'Coach'}</span><p>{message.content}</p></article>)}
      {loading || busy ? <div className="coach-presence" role="status"
        aria-label={loading ? 'Coach 正在准备' : 'Coach 正在回复'}><span aria-hidden="true" /></div> : null}
      {error ? <p className="ai-error" role="alert">{error}</p> : null}
      {actions.length ? <div className="coach-actions">{actions.map((action) => <button key={action.path + action.label}
        type="button" onClick={() => navigate(action.path)}>{action.label} →</button>)}</div> : null}<div ref={endRef} />
    </section>
    <div className="coach-prompts">{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => void send(prompt)}>{prompt}</button>)}</div>
    <form className="coach-input" onSubmit={submit}><label><span className="sr-only">消息</span><input value={text}
      onChange={(event) => setText(event.target.value)} placeholder="我想聊聊…" /></label><button type="submit" disabled={busy || !text.trim()} aria-label="发送">➜</button></form>
  </div>
}
