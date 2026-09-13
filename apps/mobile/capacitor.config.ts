import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.motion',
  appName: 'Motion',
  webDir: 'dist',
  android: {
    backgroundColor: '#f7f3e9',
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
