import type { SourceType } from '@motion/domain'

export interface SharedWorkoutPayload {
  eventId: string
  text: string | null
  subject: string | null
}

export interface ParsedShare {
  rawSharedText: string | null
  rawUrl: string | null
  title: string | null
  sourceType: SourceType
}

const urlPattern = /https?:\/\/[^\s<>"'，。！？；）】]+/iu
const trailingPunctuation = /[.,!?;:，。！？；：）】]+$/u
const boilerplate = /^(复制(这条)?链接|打开(看看)?|分享|来自|点击(查看|打开)|查看详情)\s*[:：]?$/u

function sourceFromHost(host: string): SourceType {
  const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`)
  if (matches('bilibili.com') || matches('b23.tv')) return 'BILIBILI'
  if (matches('xiaohongshu.com') || matches('xhslink.com')) return 'XIAOHONGSHU'
  if (matches('quark.cn')) return 'QUARK'
  if (matches('youtube.com') || matches('youtu.be')) return 'YOUTUBE'
  return 'WEB'
}

function possibleTitle(text: string): string | null {
  const line = text.split(/[\r\n]+/u).map((item) => item.replace(urlPattern, '').trim())
    .find((item) => item.length > 1 && item.length <= 120 && !boilerplate.test(item))
  return line ?? null
}

export function classifyWorkoutTitle(title: string | null): string | null {
  if (!title) return null
  const rules: Array<[RegExp, string]> = [
    [/瑜伽|\byoga\b/iu, 'YOGA'],
    [/普拉提|\bpilates\b/iu, 'PILATES'],
    [/拉伸|柔韧|\bstretch(ing)?\b/iu, 'STRETCH_MOBILITY'],
    [/健美操|有氧操/iu, 'AEROBICS'],
    [/跑步|慢跑/iu, 'RUNNING'],
    [/骑行|单车/iu, 'CYCLING'],
    [/快走|步行|散步/iu, 'WALKING'],
  ]
  const matches = rules.filter(([pattern]) => pattern.test(title))
  return matches.length === 1 ? matches[0]![1] : null
}

export function durationFromTitle(title: string | null): number | null {
  const match = title?.match(/(?:^|\D)(\d{1,3})\s*(?:分钟|min)(?=\D|$)/iu)
  const duration = match ? Number(match[1]) : 0
  return duration >= 1 && duration <= 180 ? duration : null
}

export function parseSharedWorkout(payload: SharedWorkoutPayload): ParsedShare {
  const rawSharedText = payload.text?.trim() ? payload.text : null
  const rawMatch = rawSharedText?.match(urlPattern)?.[0] ?? null
  let rawUrl: string | null = null
  if (rawMatch) {
    try {
      const candidate = new URL(rawMatch.replace(trailingPunctuation, ''))
      if (candidate.protocol === 'http:' || candidate.protocol === 'https:') rawUrl = rawMatch.replace(trailingPunctuation, '')
    } catch { /* Preserve the text even when the URL is malformed. */ }
  }
  const sourceType = rawUrl ? sourceFromHost(new URL(rawUrl).hostname.toLowerCase()) : 'WEB'
  // A Quark share may be a folder or a plan, so a share caption is not a workout title.
  const title = sourceType === 'QUARK' ? null
    : possibleTitle(payload.subject?.trim() || '') ?? possibleTitle(rawSharedText ?? '')
  return { rawSharedText, rawUrl, title, sourceType }
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/gu, (entity) => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  })[entity] ?? entity)
}

export async function retrievePageTitle(url: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1800)
  try {
    const response = await fetcher(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/html')) return null
    let html = ''
    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let bytes = 0
      try {
        while (bytes < 96_000) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.byteLength
          html += decoder.decode(part.value, { stream: true })
        }
        html += decoder.decode()
      } finally { await reader.cancel().catch(() => undefined) }
    } else html = (await response.text()).slice(0, 96_000)
    const meta = html.match(/<meta\s+[^>]*>/giu)?.find((tag) =>
      /(?:property|name)=["']og:title["']/iu.test(tag))
    const title = meta?.match(/content=["']([^"']+)["']/iu)?.[1]
      ?? html.match(/<title[^>]*>([^<]+)<\/title>/iu)?.[1]
    const cleaned = title ? decodeEntities(title).trim() : ''
    return cleaned.length > 1 && cleaned.length <= 120 ? cleaned : null
  } catch { return null }
  finally { clearTimeout(timeout) }
}
