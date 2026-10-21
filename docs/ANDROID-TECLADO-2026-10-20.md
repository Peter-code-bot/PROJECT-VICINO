# Android: pantalla en blanco al abrir el teclado (20-oct-2026)

Para Alejandro. Pedro reportó, con una captura de un Android con notch, que en **algunos**
teléfonos, al tocar un campo de texto, la app "se desliza de abajo hacia arriba" y queda una
pantalla en blanco: se ve la cabecera "VICINO" y debajo nada, hasta el teclado. En su propio
Android (15 o más reciente) no pasa. Pidió una auditoría de por qué ocurre solo en algunos.

Rama: `fix/teclado-android-20261020`. Estado: **arreglo nativo, va en el AAB 10**. No sale por
la web: lo que se encoge es el WebView entero, y ningún CSS ni JavaScript puede devolverle su
tamaño.

## Qué se veía

Teclado abierto, cabecera visible y el resto de la pantalla en blanco. El teclado seguía
funcionando (salían sugerencias), pero el campo donde se escribía no se veía. Solo en algunos
Android; nunca en iPhone ni en los Android más nuevos.

## Causa

Hacen falta tres piezas, y solo se juntan en Android 10 o anterior.

1. **El sistema ya hace sitio al teclado.** La app declara `windowSoftInputMode="adjustResize"`
   en el `AndroidManifest.xml`: cuando sale el teclado, Android encoge la ventana para que el
   contenido quede encima de él. Así ha sido siempre.

2. **Capacitor 8 también hace sitio al teclado.** Desde Capacitor 8 el plugin `SystemBars`
   (viene dentro del núcleo) escucha los "insets" de la ventana y, si ve el teclado, pone un
   relleno inferior del alto del teclado al contenedor del WebView
   (`SystemBars.java`, `initWindowInsetsListener`). Lo hace porque en Android 15 o más reciente
   la app se dibuja de borde a borde y el sistema ya **no** encoge la ventana: ahí alguien tiene
   que hacerlo, y lo hace Capacitor.

3. **En Android 10 o anterior, Capacitor ve el teclado aunque el sistema ya lo descontó.** En
   Android 11 o más reciente, después de que el sistema encoge la ventana, el inset del teclado
   que llega a Capacitor vale 0 y no rellena nada. En Android 10 o anterior el inset del teclado
   no existe como tal: la librería de compatibilidad lo aproxima con el marco visible de la
   pantalla, que sigue reportando el teclado completo. Capacitor rellena **otra vez**.

Resultado: alto del WebView = pantalla − 2 × teclado. Con un teclado alto (SwiftKey con fila
numérica y barra de sugerencias ocupa casi la mitad de la pantalla) el WebView se queda del
tamaño de la cabecera y el resto es el fondo de la ventana, que es claro. Esa es la "pantalla
en blanco". La cabecera se ve porque es lo único que cabe.

Capacitor lo tiene reportado como [ionic-team/capacitor#8601](https://github.com/ionic-team/capacitor/issues/8601)
(abierto el 14-sep-2026, con reproducciones en un Zebra TC21, un **Huawei P20 Pro** y un
Samsung, todos con Android 10). El arreglo propuesto, [PR #8606](https://github.com/ionic-team/capacitor/pull/8606),
sigue abierto: rellenar por el teclado solo en Android 11 o más reciente, que es donde el
inset es real.

### Por qué solo algunos teléfonos

| Android del teléfono | App actual (AAB 8/9, Capacitor 8.3.0) | Con Capacitor 8.4.3 sin parche | Con este arreglo |
|---|---|---|---|
| 15 o más reciente (el de Pedro) | Bien: de borde a borde, solo rellena Capacitor | Bien | Bien |
| 11 a 14 | Bien: el inset del teclado llega en 0 | Bien | Bien |
| 10 con WebView 140 o más nuevo (actualizado por Play) | **En blanco** | **En blanco** (la 8.3.2 solo arregló la otra rama del código) | Bien |
| 10 o anterior con WebView viejo, y 9 (Play ya no actualiza su WebView más allá del 138) | **En blanco** | Bien (esa rama ya se acota a 15+ desde la 8.3.2) | Bien |

En la 8.3.0 instalada hoy, el relleno se aplica en todas las versiones de Android, así que cae
cualquier Android 10 o anterior. Capacitor acotó una de las dos ramas en la 8.3.2 ("avoid extra
view padding on API <= 34"), pero la rama que usa VICINO (WebView 140 o más nuevo y
`viewport-fit=cover` en la página) sigue sin acotar hasta la 8.5.3, que es la última publicada
al 20-oct-2026.

### Lo que no era

- **No es la web.** Ni `100vh`, ni los drawers, ni el chat: el WebView mismo mide menos que la
  mitad de la pantalla. La web pinta bien dentro de lo que le dejan.
- **`Keyboard.resizeOnFullScreen: true` en `capacitor.config.ts` no hacía nada.** El plugin de
  teclado salta su propio redimensionado en cuanto existe `SystemBars` ("SystemBars handles the
  inset sizing", `Keyboard.java` 8.0.3). Capacitor 8.5 avisa en logcat de que hay que omitirlo.
- **No es el emulador ni el splash** (eso fue lo del 15-oct, ver `ANDROID-BARRA-ESTADO-2026-10-15.md`).

## Cambio

1. **`pnpm install` a Capacitor 8.4.3.** `package.json` lo pedía desde el 10-oct (commit
   `2549a69`), pero el checkout con el que se construyeron los AAB seguía en 8.3.0. Con 8.4.3
   la rama "sin passthrough" ya queda acotada a Android 15+.
2. **Parche pnpm `patches/@capacitor__android@8.4.3.patch`.** Es el cambio del PR #8606
   aplicado a la 8.4.3: en la rama "passthrough" solo se rellena por el teclado si
   `Build.VERSION.SDK_INT >= 30` (Android 11). En Android 10 o anterior vuelve a mandar el
   `adjustResize` del sistema, como antes de Capacitor 8. Mismo mecanismo que ya usa el repo
   para `next-pwa` y el plugin de eslint. Cuando se suba Capacitor, pnpm se negará a instalar si
   el parche no aplica: ahí hay que mirar si el PR #8606 ya llegó y borrar el parche.
3. **`capacitor.config.ts`:** fuera el bloque `Keyboard` (`resizeOnFullScreen` era letra muerta).
4. **`apps/web/android/capacitor.settings.gradle`:** regenerado por `cap sync`, apunta al paquete
   8.4.3 parcheado.

Necesita **AAB 10**. Conviene sacarlo junto con lo nativo de la rama
`fix/barra-estado-android-20261015` (fondo crema de las barras). Un AAB nuevo no reinicia el
conteo de verificadores de Play.

## Probado

- **Compila y pasa las compuertas del repo.** `./gradlew assembleDebug` con la 8.4.3 parcheada
  (JDK 21) genera el APK; `pnpm --filter web type-check`, `lint` (0 errores, 140 avisos que ya
  estaban) y `pnpm --filter web build` en verde.
- **Emulador Android 14 (API 34, WebView 113, AVD `vicino34`), APK de esta rama.** Inicio de
  sesión → tocar "Email" → escribir → cerrar el teclado. El formulario queda visible encima del
  teclado, el texto aparece en el campo y al cerrar la página vuelve a su tamaño sin franjas.
  `dumpsys activity top` da el WebView en 1080×2211 antes, con el teclado y después: en Android
  14 el WebView no se encoge de forma nativa, es Chromium quien ajusta su viewport visual al
  teclado. Es el mismo comportamiento que tendría la 8.4.3 sin parche, porque la guarda solo
  cambia algo por debajo de Android 11.
- **Lo que NO demuestra esa prueba.** Android 14 no está en el rango afectado (11 a 14 ya se
  portaban bien con la 8.3.0), así que confirma que el cambio compila y no rompe nada ahí, no
  que arregle Android 10. Eso lo cierra el teléfono de la captura.

## No verificado

- **El teléfono de la captura.** No hay imagen de emulador de Android 10 en la máquina: lo de
  Android 10 o anterior sale de leer el código de Capacitor (8.3.0, 8.4.3 y 8.5.3), de la
  librería de compatibilidad de Android y del issue #8601, no de reproducirlo. La prueba que
  cierra esto es instalar el AAB 10 en ese teléfono.
- Android 11 a 14 con WebView 140 o más nuevo: el emulador disponible tiene WebView 113, así que
  la rama "passthrough" no se ejercitó en emulador en ninguna versión.

## Cómo comprobarlo en el teléfono afectado

1. Ajustes → Acerca del teléfono → versión de Android. Si es 10 o anterior, es este caso.
2. Instalar el AAB 10, abrir un chat o Buscar y tocar el campo de texto.
3. Esperado: el contenido se encoge una sola vez y el campo queda visible justo encima del
   teclado. Al cerrar el teclado, la página vuelve a su tamaño sin franjas.

## Referencias

- Código: `SystemBars.java` en `@capacitor/android` 8.3.0 (checkout principal), 8.4.3 (worktree
  `startup-marketplace-barra-estado`) y 8.5.3 (etiqueta en GitHub), método
  `initWindowInsetsListener`.
- [Capacitor CHANGELOG](https://github.com/ionic-team/capacitor/blob/main/CHANGELOG.md): 8.0.1
  "Remove calculated bottom inset if keyboard is visible", 8.3.0 "use native safe area insets on
  Android", 8.3.2 "avoid extra view padding on API <= 34", 8.5.2 "resolve issues with safe area /
  systembars plugin".
- [capacitor#8601](https://github.com/ionic-team/capacitor/issues/8601) (este bug),
  [capacitor#8606](https://github.com/ionic-team/capacitor/pull/8606) (el arreglo, abierto),
  [capacitor#8611](https://github.com/ionic-team/capacitor/issues/8611) (SystemBars rellena aunque
  sea `adjustNothing`), [capacitor#8622](https://github.com/ionic-team/capacitor/issues/8622)
  (hueco de ~130 px sobre el teclado en un Xiaomi con Android 13: otro síntoma de la misma zona,
  sin arreglo todavía).
