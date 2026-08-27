# Tasks — Liquid navigation

> Cambio de presentación. No toca navegación, rutas, permisos ni datos.

## FASE A — OpenSpec

- [x] T-01 — proposal.md (por qué, qué, alcance, y la restricción de WebKit)
- [x] T-02 — design.md (geometría, las cuatro capas, mejora progresiva, riesgo)
- [x] T-03 — tasks.md (este archivo)
- [x] T-04 — Investigación previa en GitHub (`gh search repos "liquid glass"`),
      con la decisión de NO añadir dependencia y su motivo

## FASE B — Implementación

- [x] T-05 — Utilidades en `globals.css`: la capa de vidrio de la píldora, el
      anillo del botón central y la mejora progresiva tras `@supports`
- [x] T-06 — Reescribir la presentación de `bottom-nav.tsx`, conservando entero
      el contrato: `aria-current`, `aria-label`, los `id` por ítem, el badge de
      no leídos, la háptica, el ocultarse en el detalle del chat y el `md:hidden`
- [x] T-07 — `prefers-reduced-motion` apaga el desplazamiento del indicador y
      el rebote del botón central

## FASE C — Verificación

- [x] T-08 — `tsc --noEmit` en 0 y `pnpm build` verde
- [x] T-09 — Comprobada a 375×812 en el navegador, en claro y en oscuro, y
      contra el CSS compilado. **Ahí se cazó un fallo propio**: el `@supports`
      referenciaba un filtro SVG que nunca se creó, y con la referencia rota
      Chromium invalida el filtro entero — o sea que el desenfoque
      DESAPARECÍA en Android. Retirado, y documentado en design.md.
      El caso con `isVendedor` no se pudo ver en pantalla (hace falta sesión
      de vendedora); queda cubierto por el contrato que fija la prueba E2E
- [x] T-10 — E2E en los dos viewports (el proyecto `mobile` existe desde ayer)
- [x] T-11 — Comprobar que los cinco `id` de navegación siguen ahí: el
      onboarding los busca por id y romperlos no falla, sólo deja de señalar

## Lo que queda fuera a propósito

- El `Sidebar` de escritorio y el `Header`. La referencia es de móvil.
- Sustituir el botón central por "Empezar a vender" para quien no es vendedora:
  eso es decisión de producto, no de piel.
- La refracción por `feDisplacementMap` como pieza obligatoria. Va detrás de
  `@supports` justamente para que su ausencia en WebKit no rompa nada.
