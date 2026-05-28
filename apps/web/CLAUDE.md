@AGENTS.md

## Cross-viewport validation rule

Antes de cualquier flip de feature flag, deployment con cambios visuales,
o promoción de stubs a producción, validar TODOS los viewports activos
(mobile + desktop + tablet si aplica), no solo el viewport target de la
fase. Stubs renderizados (`<div>TODO</div>`) deben fallar el build en
producción, no solo en desarrollo.

Validación mínima: Chrome DevTools mobile 375x812 + desktop real 1280x800
en cada push que toque capa visual o feature flags.

Lección original: durante MP#06 el `ProductDetailDesktop` fue stub TODO
desde Fase 1 y shippeó a producción para visitantes desktop cuando el
flag `RENDER_V2` flippeó en Fase 4 (que solo validó mobile). El
`ProductDetailDesktop` real aterrizó hasta Fase 5.
