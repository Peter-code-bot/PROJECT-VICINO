import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vicino.mx',
  appName: 'VICINO',
  webDir: 'dist',
  server: {
    // Production: canonical domain. The legacy vercel.app host stays in
    // allowNavigation because Google Play Data Safety still references it
    // OJO: comprobado el 26-ago-2026, ese host NO sirve un 308 — responde 200
    // con la aplicacion completa. Se queda en allowNavigation porque la Data
    // Safety URL de Google Play todavia lo referencia, no porque redirija.
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
    // TEMP: Sentry excluido de iOS por fallo de descarga sentry-cocoa (red). Re-incluir antes de release publico.
    includePlugins: [
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
      // TECHO NATIVO, y es lo unico que funciona si el JS nunca llega a correr.
      //
      // Estaba en false, y eso desactiva el UNICO auto-hide del plugin: en
      // Android el postDelayed de SplashScreen.java solo entra dentro de
      // `if (settings.isAutoHide())`, y en iOS el asyncAfter esta dentro de
      // `if settings.autoHide`. Con false, launchShowDuration era letra muerta
      // y el splash dependia por completo de que una llamada JS lo quitara.
      //
      // Eso convertia cualquier fallo de arranque en un cuelgue permanente: la
      // app carga una URL remota, y basta con que no haya red, o con que el
      // chunk de @capacitor/splash-screen de 404 tras un deploy, para que el
      // hide() no se ejecute nunca. Android deja el splash pegado con
      // setKeepOnScreenCondition; iOS ademas pone isUserInteractionEnabled en
      // false, o sea pantalla congelada que no responde al tacto. La unica
      // salida era matar la app. Es tambien lo primero que prueba un revisor
      // de tienda: abrir con mala red.
      //
      // Con true, el sistema lo quita al alcanzar el techo. En el camino
      // normal no se llega a esperar tanto: capacitor-init lo quita en cuanto
      // sabe que esta en nativo, mucho antes.
      // 15 s es un TECHO para el caso roto, no un tiempo de espera normal: el
      // hide de capacitor-init lo quita en cuanto la web hidrata, asi que nadie
      // espera esto en el camino bueno. Se subio desde 4000 porque con la carga
      // remota un arranque lento pero legitimo (red mala, primer arranque tras
      // instalar) tarda mas de 4 s, y cortar ahi cambiaba un splash colgado por
      // un WebView en blanco, que no es mejor.
      launchAutoHide: true,
      launchShowDuration: 15000,
      // Para que si el techo llega a saltar, lo que quede detras sea el fondo de
      // la app y no blanco puro. Es el token --bg del tema claro.
      backgroundColor: "#FFF8F0",
      showSpinner: true,
      splashFullScreen: true,
      splashImmersive: true,
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#FFF8F0',
      overlaysWebView: false,
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
};

export default config;
