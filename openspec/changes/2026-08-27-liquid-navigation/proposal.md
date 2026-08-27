# Proposal — Liquid navigation (barra inferior del móvil)

## Why

Alejandro pidió el 27-ago-2026 que la barra inferior de la app se parezca a la
referencia que mandó Pedro: una **píldora flotante** con un **botón circular
elevado en el centro** que rompe por encima de la barra, con acabado de vidrio.
El objetivo declarado es estético: *"mucho más estético, mucho más bonito"*.

Lo que hay hoy (`apps/web/components/layout/bottom-nav.tsx`, 82 líneas) ya está
a medio camino y conviene decirlo antes de reescribir nada:

- Ya **flota**: `fixed`, `mx-3`, separada del borde con
  `calc(env(safe-area-inset-bottom) + 12px)`.
- Ya es **vidrio**: usa la clase `.glass` de `globals.css:324` —
  `backdrop-filter: blur(16px) saturate(180%)` con su prefijo `-webkit-`, y una
  variante `.dark .glass` en `:330`.
- Ya distingue la acción primaria: "Vender" se pinta con `bg-brand` y
  `--shadow-glow`.
- Ya tiene lo que no se ve: `aria-current`, `aria-label`, `id` por ítem (los usa
  el onboarding), badge de no leídos del chat, háptica al tocar, y se **oculta
  dentro del detalle de un chat** (`bottom-nav.tsx:31`).

Lo que falta respecto a la referencia es concreto: **el botón central elevado**,
el corte de la píldora a su alrededor, y un acabado de vidrio con especular en
vez de un panel plano translúcido.

## What

Reescribir sólo la **presentación** de `BottomNav`. Cero cambios de navegación,
de rutas, de permisos o de datos.

1. **Botón central elevado.** Cuando la persona es vendedora, "Vender" sale de
   la fila y pasa a un círculo elevado que rompe por encima de la píldora, con
   su etiqueta debajo. La píldora se abre a su alrededor.
2. **Acabado líquido.** Capa de vidrio (blur + saturación), realce especular en
   el borde superior, sombra exterior de contacto y sombra interior de canto.
3. **Estado activo con indicador que se desplaza**, en vez de un cambio de
   fondo seco.
4. **Sin botón central cuando no aplica.** Quien no es vendedora sigue viendo
   4 ítems. No se inventa un botón central para ese caso: sería cambiar
   navegación, y esto es un cambio visual.

## Scope

**Dentro:** `apps/web/components/layout/bottom-nav.tsx` y los tokens/utilidades
que necesite en `apps/web/app/globals.css`. Sólo móvil: el componente ya es
`md:hidden` y así se queda.

**Fuera:** el `Sidebar` de escritorio, el `Header`, las rutas, `isVendedor` y su
origen, y cualquier cambio de qué hace cada botón.

## La restricción que decide el diseño

**La app de móvil es un WebView que carga `vicinomarket.com`**
(`capacitor.config.ts:11`), así que todo esto es CSS de navegador, no UI nativa.
Y ahí hay un límite que descarta la mayoría de las implementaciones de "liquid
glass" que circulan:

> `backdrop-filter: url(#filtro-svg)` **no funciona en WebKit**. Las librerías
> que consiguen la refracción de verdad (`feDisplacementMap` sobre el fondo)
> dependen de eso. En Chromium se ven; en el WebView de iOS, no.

Investigado en GitHub antes de decidir (`gh search repos "liquid glass"`), los
candidatos reales para web son `rdev/liquid-glass-react` (6.0k★),
`AndrewPrifer/liquid-dom` (2.5k★), `shuding/liquid-glass` (1.1k★) y
`naughtyduk/liquidGL` (842★). Los cuatro apoyan el efecto en desplazamiento SVG
o en WebGL. `callstack/liquid-glass` (1.6k★) es React **Native** y no aplica: no
hay árbol nativo que decorar.

**Decisión: no se añade dependencia.** El efecto se construye con lo que sí
renderiza WebKit —`backdrop-filter: blur() saturate()`, gradientes, sombras
interiores— y la refracción por desplazamiento queda como mejora progresiva
detrás de `@supports`, de modo que su ausencia no deja un botón feo sino el
mismo botón sin ese matiz. Añadir 6 k★ de librería para un efecto que no se ve
en la mitad de los dispositivos sería peso de bundle a cambio de nada.

## Success criteria

- La barra se ve como la referencia en 375×812, en claro y en oscuro.
- El botón central sólo aparece para quien es vendedora, y sigue llevando a
  `/vender`.
- No se pierde nada de lo que ya funcionaba: `aria-current`, `aria-label`, los
  `id` por ítem que usa el onboarding, el badge de no leídos, la háptica, el
  ocultarse en el detalle del chat, y el `md:hidden`.
- `pnpm build` verde, `tsc` en 0, E2E en los dos viewports en verde.
- Verificado en el navegador a 375×812 con el tema en claro y en oscuro, no sólo
  leyendo el CSS.
