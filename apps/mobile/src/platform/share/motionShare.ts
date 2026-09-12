import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { SharedWorkoutPayload } from '@motion/integrations'

interface MotionSharePlugin {
  getPendingShares(): Promise<{ shares: SharedWorkoutPayload[] }>
  acknowledgeShare(options: { eventId: string }): Promise<void>
  addListener(eventName: 'shareReceived', listener: (share: SharedWorkoutPayload) => void): Promise<PluginListenerHandle>
}

export const MotionShare = registerPlugin<MotionSharePlugin>('MotionShare')
