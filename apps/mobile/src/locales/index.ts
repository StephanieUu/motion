import { zhCN } from './zh-CN'

export const defaultLocale = 'zh-CN' as const

const dictionaries = {
  'zh-CN': zhCN,
} as const

export type UiLocale = keyof typeof dictionaries
export const uiCopy = dictionaries[defaultLocale]
