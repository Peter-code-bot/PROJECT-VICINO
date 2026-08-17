import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vicino.mx',
  appName: 'VICINO',
  webDir: 'dist',
  server: {
    // Production: canonical domain. The legacy vercel.app host stays in
    // allowNavigation because Google Play Data Safety still references it
    // and it serves a 308 to vicinomarket.com.
    url: 'https://vicinomarket.com',
    cleartext: false,
    iosScheme: 'https',
    allowNavigation: [
      'vicinomarket.com',
      'www.vicinomarket.com',
      'startup-marketplace-web.vercel.app',
      '*.supabase.co',
      'accounts.google.com',
      '*.google.com',
    ],
    // Override for local development:
    // url: 'http://localhost:3000',
  },
  android: {
    allowMixedContent: false,
    // Recommended by capacitor-best-practices skill
    webContentsDebuggingEnabled: process.env.NODE_ENV === 'development',
    appendUserAgent: 'VICINO-Android',
  },
  ios: {
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
    appendUserAgent: 'VICINO-iOS',
    // Sentry re-incluido (2026-07-14; antes excluido por fallo transitorio de red
    // descargando sentry-cocoa). Verificar `pod install` en la Mac antes del release:
    // sentry-cocoa dejo de publicar a CocoaPods tras 9.19.1 (SPM es el camino
    // soportado), pero las versiones ya publicadas siguen descargables.
    includePlugins: [
      '@sentry/capacitor',
      '@capacitor/app',
      '@capacitor/browser',
      '@capacitor/camera',
      '@capacitor/geolocation',
      '@capacitor/haptics',
      '@capacitor/keyboard',
      '@capacitor/network',
      '@capacitor/push-notifications',
      '@capacitor/splash-screen',
      '@capacitor/status-bar',
    ],
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 3000,
      showSpinner: true,
      splashFullScreen: true,
      splashImmersive: true,
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'DEFAULT',
      overlaysWebView: false,
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
};

export default config;
