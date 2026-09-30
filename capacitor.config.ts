import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.barangayresolve.app',
  appName: 'BarangayResolve',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    hostname: 'barangayresolve.app'
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    buildOptions: {
      keystorePath: undefined,
      keystorePassword: undefined,
      keystoreAlias: undefined,
      keystoreAliasPassword: undefined
    }
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
    },
    BackgroundTask: {
      enabled: true
    },
    BackgroundRunner: {
      enabled: true,
      label: 'BarangayResolve Background Alerts',
      text: 'Monitoring for emergency alerts...',
      iconColor: '#1e3a8a'
    }
  }
};

export default config;
