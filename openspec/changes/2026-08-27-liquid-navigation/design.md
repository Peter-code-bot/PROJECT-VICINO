# Design — Liquid navigation

## Geometría

La píldora mide 64 px de alto y vive a `env(safe-area-inset-bottom) + 12px` del
borde, que es lo que ya hacía. El botón central es un círculo de 60 px que se
eleva 22 px por encima del borde superior de la píldora.

Para que el círculo "rompa" la barra sin recortar nada, la píldora **no se
corta**: el círculo se dibuja encima, con un anillo del color del fondo de la
página alrededor. Es la técnica que aguanta bien el vidrio — un `clip-path` con
muesca deja el borde del blur mordido y se nota en cuanto hay contraste detrás.

    ┌───────────────────────────────┐
    │            ╭─────╮            │   el anillo separa el circulo
    │  ◻   ◻     │  +  │     ◻   ◻  │   de la pildora sin recortarla
    └────────────╰─────╯────────────┘

## Por qué el centro es "Vender" y no un botón nuevo

Es el único ítem que ya tenía tratamiento de acción primaria (`bg-brand` +
`--shadow-glow`), es la acción que el producto quiere empujar, y **ya existe**.
Inventar un botón central nuevo sería cambiar la navegación, y este cambio es
visual.

Cuando `isVendedor` es falso el ítem no existe hoy, y sigue sin existir: la
píldora se reparte entre 4 ítems y no hay círculo. No se sustituye por
"Empezar a vender" porque eso sí sería una decisión de producto.

## Las cuatro capas del vidrio

Ninguna depende de filtros SVG, así que las cuatro renderizan igual en WebKit y
en Chromium:

1. **Difusión** — `backdrop-filter: blur(20px) saturate(180%)`, con su prefijo
   `-webkit-`. Es lo que ya hacía `.glass`, un punto más de blur.
2. **Cuerpo** — un gradiente muy tenue de arriba a abajo. Sin él el panel se lee
   plano; con él tiene volumen.
3. **Canto** — `inset 0 1px 0` blanco al 40 % arriba y `inset 0 -1px 0` negro al
   10 % abajo. Es lo que hace que parezca vidrio y no plástico: el borde
   superior recoge luz y el inferior la pierde.
4. **Contacto** — sombra exterior amplia y suave. Es lo que separa la píldora
   del contenido en vez de dejarla pegada.

## La mejora progresiva que se probó y se retiró

El diseño original llevaba un `@supports` con
`backdrop-filter: url(#filtro-svg)` para añadir refracción donde el navegador
la soportara. **Se implementó, se probó en el navegador y se retiró.** Los dos
motivos, en orden de importancia:

1. **Referenciaba un filtro que no existía, y eso rompe el desenfoque entero.**
   Chromium aceptó la regla — el computed style pasó a
   `url("#liquid-nav-refraccion") blur(20px) saturate(1.8)` — y con la
   referencia rota el filtro completo deja de aplicarse. O sea que el
   `@supports` no añadía un matiz: **quitaba el vidrio en Android**. Lo destapó
   mirar el estilo calculado en el navegador, no leer el CSS.
2. **Aunque se creara el filtro, WebKit ignora `url()` en `backdrop-filter`.**
   El iPhone y el Android de la misma app se verían distintos, y esa diferencia
   la nota cualquiera que ponga los dos teléfonos al lado.

Las cuatro capas de arriba ya son el acabado completo y son **idénticas en los
dos motores**. Si algún día se quiere la refracción, hay que crear el filtro SVG
de verdad y asumir que es un adorno sólo-Android.

## Movimiento

- El indicador del ítem activo se desplaza con `transition` sobre `transform`,
  no aparece y desaparece. Es una sola propiedad compuesta, barata en móvil.
- El botón central baja un 6 % al pulsarlo (`active:scale-[0.94]`), que es la
  respuesta táctil que ya usan los CTA del detalle de producto.
- Todo el movimiento se apaga bajo `prefers-reduced-motion`.

## Riesgo, y por qué es acotado

`backdrop-filter` sobre un elemento fijo encima de un feed que se desplaza es de
lo más caro que se le puede pedir a un móvil de gama baja. **Pero ese coste ya
se paga hoy**: `.glass` está en la barra actual con `blur(16px) saturate(180%)`.
Este cambio lo sube a 20px, no lo introduce.

Lo que NO se hace, y es la razón de que el riesgo quede acotado: nada de WebGL,
nada de canvas por frame, nada de leer el fondo con `html2canvas` para clonarlo
—que es como varias de esas librerías consiguen la refracción y es exactamente
lo que hunde un Android modesto.

## Qué NO se toca

`aria-current`, `aria-label`, los `id` por ítem (`nav-inicio`, `nav-buscar`…,
los usa el onboarding para señalar), el badge de no leídos del chat, la háptica,
el ocultarse dentro del detalle de un chat, y el `md:hidden`. Son el contrato
del componente; el cambio es de piel.
