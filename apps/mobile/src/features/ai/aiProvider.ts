import type { AiProvider, AiTaskType } from '@motion/domain'
import type { MotionAiPlugin } from '../../platform/ai/aiNative'
import type { AiOutputContract } from './aiSchemas'

export interface ProviderRequest { provider: AiProvider; model: string; taskType: AiTaskType; prompt: string;
  imageBase64?: string; maxOutputTokens: number; output: AiOutputContract }
export interface ProviderResult { output: unknown; inputTokens: number | null; outputTokens: number | null }
export interface AiProviderAdapter { send(request: ProviderRequest): Promise<ProviderResult> }

export type AiDiagnosticCategory = 'AUTH' | 'PERMISSION' | 'MODEL_NOT_FOUND' | 'QUOTA' | 'NETWORK' |
  'TLS' | 'TIMEOUT' | 'INVALID_REQUEST' | 'INVALID_RESPONSE' | 'PROVIDER'

export class AiProviderError extends Error {
  constructor(readonly code: 'NETWORK' | 'QUOTA' | 'AUTH' | 'INVALID_RESPONSE' | 'PROVIDER' | 'TIMEOUT',
    readonly mayHaveReachedProvider = true, readonly httpStatus: number | null = null,
    readonly diagnosticCategory: AiDiagnosticCategory = code) { super(code) }
}
const parseJsonOutput = (text: string): unknown => {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(normalized) } catch { throw new AiProviderError('INVALID_RESPONSE') }
}

export class DirectByokAdapter implements AiProviderAdapter {
  constructor(private readonly native: MotionAiPlugin) {}
  async send(request: ProviderRequest): Promise<ProviderResult> {
    let response
    try { response = await this.native.request({ provider: request.provider, model: request.model,
      prompt: request.prompt, maxOutputTokens: request.maxOutputTokens,
      outputMode: request.output.mode,
      ...(request.output.mode === 'JSON_SCHEMA' ? { responseSchema: request.output.schema } : {}),
      ...(request.imageBase64 ? { imageBase64: request.imageBase64 } : {}) }) }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (/AUTH_LOCAL/.test(message)) throw new AiProviderError('AUTH', false, null, 'AUTH')
      if (/TLS/.test(message)) throw new AiProviderError('NETWORK', true, null, 'TLS')
      if (/TIMEOUT/.test(message)) throw new AiProviderError('TIMEOUT', true, null, 'TIMEOUT')
      throw new AiProviderError('NETWORK', true, null, 'NETWORK')
    }
    if (response.status === 400) throw new AiProviderError('PROVIDER', true, 400, 'INVALID_REQUEST')
    if (response.status === 401) throw new AiProviderError('AUTH', true, 401, 'AUTH')
    if (response.status === 403) throw new AiProviderError('AUTH', true, 403, 'PERMISSION')
    if (response.status === 404) throw new AiProviderError('PROVIDER', true, 404, 'MODEL_NOT_FOUND')
    if (response.status === 429) throw new AiProviderError('QUOTA', true, 429, 'QUOTA')
    if (response.status < 200 || response.status >= 300)
      throw new AiProviderError('PROVIDER', true, response.status, 'PROVIDER')
    let envelope: Record<string, unknown>
    try { envelope = JSON.parse(response.body) as Record<string, unknown> } catch { throw new AiProviderError('INVALID_RESPONSE') }
    if (request.provider === 'GEMINI') {
      const candidates = envelope.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined
      const text = candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('')
      const usage = envelope.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined
      if (!text) throw new AiProviderError('INVALID_RESPONSE')
      return { output: request.output.mode === 'TEXT' ? text.trim() : parseJsonOutput(text), inputTokens: usage?.promptTokenCount ?? null,
        outputTokens: usage?.candidatesTokenCount ?? null }
    }
    const choices = envelope.choices as Array<{ message?: { content?: string } }> | undefined
    const text = choices?.[0]?.message?.content
    const usage = envelope.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
    if (!text) throw new AiProviderError('INVALID_RESPONSE')
    return { output: request.output.mode === 'TEXT' ? text.trim() : parseJsonOutput(text), inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null }
  }
}

export class ProxyAdapter implements AiProviderAdapter {
  constructor(private readonly endpoint: string, private readonly timeoutMs = 20_000,
    private readonly allowInsecureLocalhost = false) {}
  async send(request: ProviderRequest): Promise<ProviderResult> {
    if (!this.endpoint) throw new AiProviderError('AUTH', false)
    let url: URL
    try { url = new URL(this.endpoint) } catch { throw new AiProviderError('AUTH', false) }
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    if (url.protocol !== 'https:' && !(this.allowInsecureLocalhost && local && url.protocol === 'http:'))
      throw new AiProviderError('AUTH', false)
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request), signal: controller.signal })
      if (response.status === 401 || response.status === 403) throw new AiProviderError('AUTH')
      if (response.status === 429) throw new AiProviderError('QUOTA')
      if (!response.ok) throw new AiProviderError('PROVIDER')
      const result = await response.json() as ProviderResult
      if (!('output' in result)) throw new AiProviderError('INVALID_RESPONSE')
      return result
    } catch (cause) {
      if (cause instanceof AiProviderError) throw cause
      if (controller.signal.aborted) throw new AiProviderError('TIMEOUT')
      throw new AiProviderError('NETWORK')
    } finally { clearTimeout(timeout) }
  }
}
