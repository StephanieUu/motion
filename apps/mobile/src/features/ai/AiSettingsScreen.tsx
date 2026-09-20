import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AiProvider } from '@motion/domain'
import { MotionAi } from '../../platform/ai/aiNative'
import type { AiSettings } from './aiSettings'
import { openAiService } from './aiRuntime'
import type { AiService } from './aiService'
import { logger } from '../../app/logger'
import './ai.css'

const contexts: Array<[keyof AiSettings['context'], string]> = [['trainingToday', '今日训练状态'],
  ['nutritionToday', '今日饮食摘要'], ['currentPlans', '当前计划信息'], ['bodyTrend', '近期体重趋势'],
  ['healthSummary', '健康摘要（步数 / 睡眠 / 心率）']]
export function AiSettingsScreen({ suppliedService }: { suppliedService?: AiService }) {
  const navigate = useNavigate(), [service, setService] = useState<AiService | null>(suppliedService ?? null)
  const [settings, setSettings] = useState<AiSettings | null>(null), [provider, setProvider] = useState<AiProvider>('GEMINI')
  const [secret, setSecret] = useState(''), [hasGemini, setHasGemini] = useState(false), [hasDeepSeek, setHasDeepSeek] = useState(false)
  const [notice, setNotice] = useState(''), [connectionNotice, setConnectionNotice] = useState('')
  const [busy, setBusy] = useState(false), [testing, setTesting] = useState(false)
  async function refreshCredentials() { const [gemini, deepseek] = await Promise.all([
    MotionAi.hasCredential({ provider: 'GEMINI' }).catch(() => ({ value: false })),
    MotionAi.hasCredential({ provider: 'DEEPSEEK' }).catch(() => ({ value: false }))])
    setHasGemini(gemini.value); setHasDeepSeek(deepseek.value) }
  useEffect(() => { let active = true; void (async () => { try { const current = suppliedService ?? await openAiService()
    const loaded = await current.settings.load(); if (active) { setService(current); setSettings(loaded); await refreshCredentials() }
  } catch (cause) { logger.error('AI settings load failed', cause); if (active) setNotice('AI 设置暂时无法打开。') } })()
    return () => { active = false } }, [suppliedService])
  async function save(event: FormEvent) { event.preventDefault(); if (!service || !settings) return
    setBusy(true); try { await service.settings.save(settings); setNotice('设置已保存。') }
    catch (cause) { logger.error('AI settings save failed', cause); setNotice('设置没有保存，请重试。') } finally { setBusy(false) } }
  async function storeCredential() { if (!secret.trim()) return; setBusy(true)
    try { await MotionAi.setCredential({ provider, secret: secret.trim() }); setSecret(''); await refreshCredentials(); setNotice('密钥已安全保存。') }
    catch { setNotice('密钥没有保存，请重试。') } finally { setBusy(false) } }
  async function removeCredential() { setBusy(true)
    try { await MotionAi.deleteCredential({ provider }); await refreshCredentials(); setNotice('已删除保存的密钥。') }
    catch { setNotice('密钥没有删除，请重试。') } finally { setBusy(false) } }
  const canTestConnection = !!service && !!settings && settings.enabled && settings.privacyAcknowledged && (
    settings.geminiEnabled && (settings.route === 'PROXY' || hasGemini) ||
    settings.deepseekEnabled && settings.monthlyPaidBudgetCny > 0 && (settings.route === 'PROXY' || hasDeepSeek))
  async function testConnection() { if (!canTestConnection || busy || testing) return; setTesting(true); setConnectionNotice('正在测试连接…')
    try { const result = await service.testConnection(); setConnectionNotice(result.ok ? '连接测试成功。' : result.diagnostic
      ? `连接测试未成功：${result.diagnostic.category}${result.diagnostic.httpStatus ? `（HTTP ${result.diagnostic.httpStatus}）` : ''}`
      : '连接测试未成功，请检查设置或网络。') }
    catch { setConnectionNotice('连接测试未成功：PROVIDER') } finally { setTesting(false) } }
  if (!settings) return <main className="ai-settings"><p role="status">{notice || '正在读取设置…'}</p></main>
  return <main className="ai-settings"><header><button type="button" onClick={() => navigate(-1)} aria-label="返回">‹</button>
    <div><h1>AI 与隐私</h1></div><span aria-hidden="true" /></header>
    <form onSubmit={(event) => void save(event)}>
      <section><h2>AI 功能</h2><label className="ai-switch"><span>启用外部 AI<small>关闭后，Motion 的本地功能仍可使用</small></span>
        <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} /></label>
        <label className="ai-switch"><span>我已阅读数据发送说明<small>任务内容会发送给所选提供商；其政策适用</small></span>
          <input type="checkbox" checked={settings.privacyAcknowledged} onChange={(event) => setSettings({ ...settings, privacyAcknowledged: event.target.checked })} /></label></section>
      <section><h2>提供商与路线</h2><label>请求路线<select value={settings.route} onChange={(event) => setSettings({ ...settings, route: event.target.value as AiSettings['route'] })}>
        <option value="DIRECT_BYOK">个人密钥（Android 安全存储）</option><option value="PROXY">Motion 代理</option></select></label>
        <div className="ai-provider"><strong>Gemini</strong><span>{hasGemini ? '已配置' : '未配置'} · {settings.geminiModel}</span>
          <input type="checkbox" aria-label="启用 Gemini" checked={settings.geminiEnabled} onChange={(event) => setSettings({ ...settings, geminiEnabled: event.target.checked })} /></div>
        <div className="ai-provider"><strong>DeepSeek</strong><span>{hasDeepSeek ? '已配置' : '未配置'} · 付费备用</span>
          <input type="checkbox" aria-label="启用 DeepSeek" checked={settings.deepseekEnabled} onChange={(event) => setSettings({ ...settings, deepseekEnabled: event.target.checked })} /></div>
        {settings.route === 'DIRECT_BYOK' ? <div className="ai-credential"><select aria-label="密钥提供商" value={provider} onChange={(event) => setProvider(event.target.value as AiProvider)}>
          <option value="GEMINI">Gemini</option><option value="DEEPSEEK">DeepSeek</option></select><input type="password" value={secret}
            onChange={(event) => setSecret(event.target.value)} autoComplete="off" placeholder="输入 API 密钥" />
          <button type="button" disabled={busy || !secret.trim()} onClick={() => void storeCredential()}>安全保存</button>
          {(provider === 'GEMINI' ? hasGemini : hasDeepSeek) ? <button type="button" disabled={busy}
            onClick={() => void removeCredential()}>删除已保存密钥</button> : null}</div> : <p>代理地址由应用配置提供，提供商密钥不会进入应用。</p>}
        <button className="ai-test" type="button" disabled={busy || testing || !canTestConnection}
          onClick={() => void testConnection()}>{testing ? '正在测试连接…' : '测试连接（不发送个人摘要）'}</button>
        {connectionNotice ? <p className="ai-connection-status" role="status">{connectionNotice}</p> : null}</section>
      <section><h2>付费 AI（DeepSeek）</h2><label>每月预算<select value={settings.monthlyPaidBudgetCny}
        onChange={(event) => setSettings({ ...settings, monthlyPaidBudgetCny: Number(event.target.value) })}>
        <option value="0">¥0</option><option value="5">¥5</option><option value="10">¥10</option></select></label>
        <p>预算按 UTC 自然月统计。预算为 ¥0 时不会发送任何付费 DeepSeek 请求。</p></section>
      <section><h2>AI 可以使用的 Motion 信息</h2><p>只发送完成任务所需的摘要，不发送完整数据库或完整历史。</p>
        {contexts.map(([key, label]) => <label className="ai-switch" key={key}><span>{label}</span><input type="checkbox"
          checked={settings.context[key]} onChange={(event) => setSettings({ ...settings, context: { ...settings.context, [key]: event.target.checked } })} /></label>)}</section>
      <button className="ai-primary" type="submit" disabled={busy}>保存设置</button>{notice ? <p role="status">{notice}</p> : null}
    </form></main>
}
