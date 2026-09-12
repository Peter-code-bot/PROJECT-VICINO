# Assets desactivados

Los archivos de esta carpeta **no** los detecta `@capacitor/assets generate`,
que solo lee los nombres conocidos en la raíz de `apps/web/assets/`.

## `splash-dark.png`

Splash de marca en modo oscuro (`#0D0D1A`), diseño intencional de Alejandro
documentado en `ios-prep/HANDOFF-MAC.md`. **No es un error de diseño.**

Se movió aquí el 12-sep-2026 porque producía el destello oscuro al abrir la app
instalada, reportado en el backlog de Notion. El requisito vigente es splash
claro siempre, sin importar el tema del sistema; el tema del usuario lo sigue
respetando la webview una vez cargada.

Si se deja en la raíz, `generate` vuelve a escribir las variantes
`Default@Nx~universal~anyany-dark.png` en `Splash.imageset` y el destello
regresa en silencio. Comprobado: sin este archivo, `generate --ios` sale con
código 0 y produce únicamente las tres variantes claras.

**Para reactivarlo hace falta decisión conjunta de Pedro y Alejandro.**
Moverlo de vuelta a `apps/web/assets/` es todo lo que se necesita.
