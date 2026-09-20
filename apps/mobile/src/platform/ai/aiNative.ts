import { registerPlugin } from '@capacitor/core'
import type { AiProvider } from '@motion/domain'

export interface NativeAiRequest {
  provider: AiProvider
  model: string
  prompt: string
  imageBase64?: string
  maxOutputTokens: number
  outputMode: 'TEXT' | 'JSON_SCHEMA'
  responseSchema?: Record<string, unknown>
}
export interface NativeAiResponse { body: string; status: number }
export interface NativeMealImage { dataUrl: string; width: number; height: number; mimeType: 'image/jpeg'; byteSize: number }
export interface MotionAiPlugin {
  setCredential(options: { provider: AiProvider; secret: string }): Promise<void>
  hasCredential(options: { provider: AiProvider }): Promise<{ value: boolean }>
  deleteCredential(options: { provider: AiProvider }): Promise<void>
  request(options: NativeAiRequest): Promise<NativeAiResponse>
  chooseMealImage(): Promise<NativeMealImage>
}
export const MotionAi = registerPlugin<MotionAiPlugin>('MotionAi')
