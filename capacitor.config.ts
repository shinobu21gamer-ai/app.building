import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.barangayresolve.app',
  appName: 'BarangayResolve',
  webDir: 'out',
  // No hard-coded `server.url`. The bundled bootstrap page in webDir reads
  // the server address from device storage and hands off to the live host.
  // Quick-tunnel URLs change on every restart, so baking one in would break
  // the app each time the tunnel is recreated.
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#4880FF',
      sound: 'default'
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1e3a8a',
      showSpinner: false
    }
  }
};

export default config;
