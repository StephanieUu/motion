import { describe, expect, it } from 'vitest'
import { classifyWorkoutTitle, durationFromTitle, parseSharedWorkout } from '@motion/integrations'

describe('M3 share parsing', () => {
  const share = (text: string, subject: string | null = null) =>
    parseSharedWorkout({ eventId: 'event', text, subject })

  it('accepts URL-only B站 shares without invented metadata', () => {
    expect(share('https://www.bilibili.com/video/BV123')).toMatchObject({
      rawUrl: 'https://www.bilibili.com/video/BV123', rawSharedText: 'https://www.bilibili.com/video/BV123',
      sourceType: 'BILIBILI', title: null,
    })
    expect(share('https://b23.tv/abc').sourceType).toBe('BILIBILI')
  })

  it('extracts a URL and possible title from shared text and subject', () => {
    expect(share('晨间拉伸 20分钟\nhttps://www.xiaohongshu.com/explore/123')).toMatchObject({
      sourceType: 'XIAOHONGSHU', title: '晨间拉伸 20分钟',
      rawUrl: 'https://www.xiaohongshu.com/explore/123',
    })
    expect(share('https://xhslink.com/abc', '晨间瑜伽').title).toBe('晨间瑜伽')
    expect(share('看看这个 https://example.com/workout。').rawUrl).toBe('https://example.com/workout')
  })

  it('handles browser URLs and text-only shares', () => {
    expect(share('https://example.com/workout').sourceType).toBe('WEB')
    expect(share('室内拉伸练习')).toMatchObject({ rawUrl: null, title: '室内拉伸练习', sourceType: 'WEB' })
    expect(share('  室内拉伸练习  ').rawSharedText).toBe('  室内拉伸练习  ')
  })

  it('detects Quark without treating a folder caption as video metadata', () => {
    expect(share('30天训练计划 https://pan.quark.cn/s/abc', '核心训练')).toMatchObject({
      sourceType: 'QUARK', title: null, rawUrl: 'https://pan.quark.cn/s/abc',
    })
  })

  it('only classifies explicit activity and duration language', () => {
    expect(classifyWorkoutTitle('20分钟瑜伽')).toBe('YOGA')
    expect(durationFromTitle('20分钟瑜伽')).toBe(20)
    expect(classifyWorkoutTitle('今天练点什么')).toBeNull()
    expect(durationFromTitle('第30天瑜伽')).toBeNull()
    expect(classifyWorkoutTitle('瑜伽与普拉提')).toBeNull()
  })
})
