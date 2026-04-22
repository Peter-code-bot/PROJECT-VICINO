import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'mx.vicino.app',
  appName: 'VICINO',
  webDir: 'dist',
  server: {
    // Production: loads the Vercel deployment
    url: 'https://startup-marketplace-web.vercel.app',
    cleartext: true,
    allowNavigation: [
      'startup-marketplace-web.vercel.app',
      '*.supabase.co',
      'accounts.google.com',
      '*.google.com',
    ],
    // Override for local development:
    // url: 'http://localhost:3000',
  },
  android: {
    backgroundColor: '#0D0D1A',
    allowMixedContent: true,
    // Recommended by capacitor-best-practices skill
    webContentsDebuggingEnabled: process.env.NODE_ENV === 'development',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 3000,
      backgroundColor: '#0D0D1A',
      showSpinner: true,
      spinnerColor: '#EDE0D4',
      splashFullScreen: true,
      splashImmersive: true,
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0D0D1A',
      overlaysWebView: false,
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
};

export default config;
