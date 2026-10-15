# Barra de Android y chat — cambios del 15-oct-2026

Para Alejandro. Tres fallos que Pedro reportó con capturas desde su Android y su iPhone.
Los tres se arreglan **solo por la web**: no hace falta un AAB nuevo ni pasar otra vez
por la revisión de Google. Llegan a la app instalada en cuanto se despliegue `master`.

Rama: `fix/barra-sistema-android-20261015`. Estado al escribir esto: **en rama, sin
desplegar**. Falta probar en el teléfono de Pedro después del despliegue.

## 1. Botones de Android casi invisibles

**Qué se veía.** Los tres botones de abajo (□ ○ ◁) salían blanquecinos sobre el fondo
crema y casi no se distinguían.

**Causa.** La barra de abajo de Android la controla el plugin `SystemBars`, que viene
dentro de Capacitor 8. Si nadie le dice nada, toma el color según el modo del
**teléfono**, no el de la app. Con el teléfono en oscuro y VICINO en claro (el tema por
defecto) quedan botones claros sobre crema. La barra de arriba sí estaba bien porque
`capacitor-init.tsx` ya le ajustaba el color según el tema de la app; a la de abajo
nadie se lo ajustaba.

**Cambio.** `apps/web/components/capacitor-init.tsx`: en el mismo bucle que ya ajusta la
barra de arriba, se llama a `SystemBars.setStyle({ bar: NavigationBar })` con el tema de
la app (claro = iconos oscuros, oscuro = iconos claros). Se vuelve a aplicar cada vez que
cambia el tema, igual que la de arriba. Solo en Android: en iOS ese método ignora qué
barra se le pide y pisaría la barra de estado.

**Probado.** En un emulador Android 14 con el teléfono en modo oscuro: antes, una franja
gris oscuro con botones blancos; con el cambio, el sistema pone una franja clara con
botones oscuros, legible. En Android 15 o más reciente, como el teléfono de Pedro, la
app se dibuja detrás de la barra (la franja es el crema de la app) y los botones salen
oscuros. Esto último no se pudo probar en emulador, porque la imagen de Android 17 de
la máquina está incompleta: falta confirmarlo en el teléfono de Pedro.

## 2. La caja de "Escribe un mensaje..." choca con los botones de Android

**Qué se veía.** En el chat, la caja de texto y el botón de enviar quedaban debajo de
los botones del sistema.

**Causa.** El margen inferior de seguridad (`env(safe-area-inset-bottom)`) de esa caja
solo se aplicaba en iPhone: estaba detrás de `supports-[-webkit-touch-callout:none]`,
que únicamente cumple Safari. Se puso así en junio (commit `c45a6b7`) por un fallo de
Android de esa época. Con Capacitor 8 y Android 15+, la app ahora se dibuja detrás de la
barra del sistema, y sin ese margen la caja queda debajo de los botones.

**Cambio.** `apps/web/app/(marketplace)/chat/[id]/chat-window.tsx`: el margen
`pb-[calc(0.75rem+env(safe-area-inset-bottom))]` aplica en todas las plataformas. Se
conserva `[.keyboard-open_&]:!pb-3`, que lo quita mientras el teclado está abierto (ese
era el fallo de junio).

**Por qué no rompe otros teléfonos.**
- En iPhone queda igual que antes.
- En Android viejo, o con un WebView anterior a la versión 140, `env()` vale 0, Capacitor
  deja la app por encima de la barra y el margen sigue siendo 12 px, igual que antes.
- Solo cambia en Android 15+ con WebView actualizado, que es justo donde chocaba.

La barra flotante (Inicio/Buscar/…) ya usaba este margen y por eso no chocaba.

## 3. "Confirmar Venta" aparecía cuando nadie tiene productos

**Qué se veía.** En un chat donde ninguno de los dos tiene productos publicados, salía el
botón verde "Confirmar Venta". Al pulsarlo solo se abría el selector diciendo "Ningún
participante tiene productos disponibles."

**Causa.** El botón se mostraba siempre que no hubiera una confirmación pendiente. La app
solo sabía si había productos después de abrir el selector.

**Cambio.**
- `apps/web/app/(marketplace)/chat/[id]/page.tsx`: al cargar el chat se consulta si alguno
  de los dos tiene al menos un producto `disponible` y no oculto. Es el mismo filtro que
  usa el selector (`loadChatCatalog`), con el mismo cliente y las mismas reglas de
  acceso, y sale en paralelo con los mensajes, así que no hace más lenta la carga.
- `chat-window.tsx`: si el producto del chat no es elegible y nadie tiene productos, se
  ocultan "Confirmar Venta" y el enlace "Elegir/Cambiar producto". Si la consulta falla,
  se muestran como antes, para no esconder una venta posible.
- Las confirmaciones que ya existen (la tarjeta "Confirmación de venta — Pendiente…") se
  siguen viendo igual.

**Límite conocido.** Es una foto al abrir el chat. Si alguien publica un producto con el
chat abierto, el botón aparece al volver a entrar o al recargar.

## Verificación

- `tsc --noEmit` y `eslint` sin errores en los tres archivos. La única advertencia,
  `<img>` en `chat-window.tsx`, ya estaba.
- `pnpm build` completo.
- Emulador Android 14 con el teléfono en modo oscuro y navegación de 3 botones: probados
  el estilo de la barra de abajo y el plugin `SystemBars` desde la app real.
- Pendiente: probar los tres cambios en el Android de Pedro después del despliegue, y el
  chat en iPhone para confirmar que no cambió.

## Visto de paso, sin tocar

- **Android 14 o anterior con el teléfono en modo oscuro:** arriba sale una franja negra y
  los iconos de la hora y la batería quedan invisibles (oscuros sobre negro). Ya pasaba
  antes de este cambio, y el color que pide la app no se refleja en esa franja. Hace falta
  revisarlo en código nativo; candidato para el AAB 10.
- Nada de lo de arriba necesita AAB nuevo. El AAB 10 sigue pendiente por lo del 3-oct
  (página sin red y recuperación del WebView).
