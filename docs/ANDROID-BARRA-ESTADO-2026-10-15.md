# Barra de estado de Android: franja negra e iconos (15-oct-2026)

Seguimiento de `ANDROID-BARRA-Y-CHAT-2026-10-15.md`. Ahi quedo anotado "Android 14 o
anterior en modo oscuro = franja negra arriba con iconos invisibles (StatusBar.getInfo
dice #FFF8F0 pero se ve negro)". Esto es lo que resulto al reproducirlo.

## Lo que NO es un fallo de la app

La franja negra del emulador Android 14 (AVD `vicino34`, WebView 113) es un artefacto
del emulador:

- SystemUI no responde con `swiftshader` ("System UI isn't responding") y la animacion
  de salida del splash del sistema se queda congelada en su primer cuadro.
- En SurfaceFlinger la capa de la app cuelga de `animation-leash of starting_reveal`
  con `pos=(0,53)`: 53 px = 20 dp, el desplazamiento inicial de esa animacion. Las
  filas 0-52 de la pantalla no las cubre ninguna capa y salen negras.
- Prueba: con `StatusBar.setBackgroundColor('#FF0000')` la banda roja aparece en las
  filas 53-115 (la barra de la app, 63 px, desplazada 53 px) y las 0-52 siguen negras.
  Por eso `getInfo()` decia #FFF8F0: el color si estaba puesto.
- Con las animaciones del sistema a 0 (`settings put global *_animation_scale 0`) la
  barra sale crema con iconos oscuros, que es lo correcto.

En Android 13/14 la app pinta bien la barra de arriba una vez que corre la web.

## Lo que SI es real

1. **Android 12/12L (API 31-32): el splash pisa el tema de la web.** androidx
   `core-splashscreen` 1.2.0, al salir el splash del sistema, ejecuta
   `applyAppSystemUiTheme()` (solo si `SDK_INT < 33`, comprobado en el bytecode): pone
   `statusBarColor`/`navigationBarColor` del tema (`transparent`) y el estilo de iconos
   del tema. Esa salida llega despues de que la web aplico su tema (logcat del
   emulador: tema web a los 28.74 s, salida del splash a los 28.91 s). Con la barra
   transparente se ve el fondo del decor, que SystemBars pone con el `windowBackground`
   del tema DayNight: **#303030 con el telefono en oscuro** (medido en el emulador
   forzando la barra transparente). Resultado: franja oscura sobre una app clara.
2. **Android 15+ con WebView menor a la 140:** Capacitor 8 rellena con padding nativo y
   el color de la barra ya no se puede fijar (`StatusBar.setBackgroundColor` no hace
   nada en 15+). Lo que se ve es el mismo fondo del decor: #303030 en modo oscuro, con
   iconos oscuros porque la app esta en claro. Es exactamente el sintoma descrito, pero
   en 15+. Solo por lectura de codigo: no hay imagen de 15+ que arranque.
3. **Iconos blancos sobre crema mientras la web no corre.** SystemBars arranca con
   `style: DEFAULT` = el modo del telefono, y pisa el `LIGHT` de StatusBar. Visto en el
   emulador: arranque sin red, telefono en oscuro, barra crema con iconos blancos.
   Dura hasta que la web corre, y para siempre si no corre.
4. **Cambio de modo del telefono con la app abierta (Capacitor 8.4):** SystemBars 8.4
   guarda el estilo por barra y lo re-aplica en cada cambio de configuracion. La web
   solo se lo daba para la barra de abajo; la de arriba se quedaba con el del arranque.

## Cambios

### Web (`components/capacitor-init.tsx`, sale con el deploy, sin AAB)

- `SystemBars.setStyle` sin `bar` en Android: las dos barras con el estilo de la app,
  y SystemBars lo guarda para ambas (punto 4).
- Re-aplicar el tema de las barras a 1 s, 2.5 s y 5 s del arranque, solo Android, para
  deshacer lo que pisa el splash en Android 12/12L (punto 1). No hay evento que marque
  esa salida; aplicar el mismo tema es idempotente.

### Nativo (va al AAB 10, no genera build aparte)

- `res/values/styles.xml`, `AppTheme.NoActionBar`: `android:windowBackground` crema
  (`@color/window_background`, sin variante night), `windowLightStatusBar` y
  `windowLightNavigationBar` en true. Lo que asoma detras de una barra sin pintar pasa
  de #303030 a crema, con iconos oscuros (puntos 1 y 2).
- `capacitor.config.ts`: `SystemBars: { style: 'LIGHT' }`. Iconos oscuros desde el
  arranque, a juego con la barra crema de StatusBar (punto 3).

Compromiso aceptado: quien eligio tema oscuro dentro de la app y tiene el telefono en
oscuro puede ver crema en un hueco sin dibujar (antes #303030). El tema por defecto de
la app es claro (`defaultTheme="light"` en `app/layout.tsx`).

## Para construir el AAB 10

- `apps/web/android/capacitor.settings.gradle` (versionado) apunta a Capacitor Android
  **8.3.0**, pero `package.json` fija **8.4.3** desde `2549a69` (Alejandro, 10-oct). El
  checkout principal compila porque su `node_modules` sigue en 8.3.0. Antes del AAB:
  `pnpm install` y `npx cap sync android`, y versionar el `capacitor.settings.gradle`
  regenerado. SystemBars cambia entre 8.3.0 y 8.4.3 (estilo por barra, padding solo en
  15+); el APK de prueba de este arreglo se construyo con 8.4.3.
- `cap sync` con `NODE_ENV` normal deja `webContentsDebuggingEnabled: false`.

## No verificado

- Android 12/12L y 15+: sin imagen de emulador que arranque (la de 37 no tiene
  kernel). Lo de esas versiones sale de leer el codigo y el bytecode.
- Aparte, no investigado: sin red el APK de prueba muestra la pagina generica
  "Webpage not available" (`net::ERR_FAILED`) aunque `offline.html` esta en los assets
  y `errorPath` en la config. Conviene revisarlo antes del AAB 10, que es justo el que
  debia arreglar eso.
