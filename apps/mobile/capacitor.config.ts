import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.motion',
  appName: 'Motion',
  webDir: 'dist',
  loggingBehavior: 'none',
  android: {
    backgroundColor: '#f7f3e9',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'disable',
      style: 'LIGHT',
    },
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
