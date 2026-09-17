# Design — Navegación y conservación de datos (Fase 3)

## Las tres capas, y qué resuelve cada una

```
toque en la pestaña
   │
   ├─ cache del router de Next (staleTimes.dynamic = 30 s, prefetch FULL/AUTO)
   │     hit  → la página se pinta con el payload guardado: 0 ms, sin esqueleto
   │     miss → loading.tsx
   │
   ├─ loading.tsx → el MISMO consumidor cliente que la página, sin semilla
   │     memoria con datos → se pintan ya (SessionScroll restaura el scroll)
   │     memoria vacía     → esqueleto con forma (SkeletonLista/Perfil/Rejilla)
   │
   └─ page.tsx (servidor) → consulta → <Consumidor seed={{ value, renderId }} />
         la semilla se siembra en SessionCache.seed y sustituye al fallback
```

1. **Cache del router.** Es la única capa «coordinada con el enrutador» de
   verdad: reutiliza el árbol RSC completo. Las Server Actions con
   `revalidatePath` la purgan, así que una mutación hecha por acción nunca deja
   una pestaña vieja más de lo que tarda en volver.
2. **Memoria de sesión (`SessionCache`).** Una instancia por cuenta (el layout
   la monta con `key={user.id}`), en memoria del proceso de la página. Guarda
   lo último que pintó cada pestaña, revalida en segundo plano al volver
   (`refreshActive` por cambio de ruta, foco, `online`, visibilidad) con un TTL
   de 30 s, y se vacía al cerrar sesión o cambiar de cuenta (aborta lo que esté
   en vuelo). Sus lecturas van por `GET /api/session/*` con
   `Cache-Control: private, no-store`, excluidas del service worker
   (`NetworkOnly`) y frenadas por IP.
3. **Semilla del servidor (`seed`).** Cada render de página lleva sus datos en
   el HTML y un `renderId`. La semilla sólo se aplica una vez por `renderId`:
   cuando el router de Next vuelve a entregar el mismo payload (capa 1), la
   memoria —que ya pasó por Realtime y revalidaciones— no retrocede. Un render
   fresco trae un id nuevo, gana, y aborta cualquier lectura en vuelo.

## Por qué no se cambió la arquitectura de Alejandro por otra

Se evaluó una implementación alternativa con almacén por módulo y Server
Actions como transporte. La de Alejandro es coherente, está probada
(`scripts/test-vicino-phases.ts`, `tests/phases-session.spec.ts`) y tiene
dueño en el equipo de frontend; cambiarla por otra habría repetido la
situación del rewrite paralelo de rankings (descartado en `9a2c5de`). Lo que
faltaba —render de servidor en la primera visita, freno, coordinación con el
router, restauración sin salto— se añade encima sin sustituir nada.

## Aislamiento por cuenta

- La instancia de `SessionCache` nace con el `userId` del layout (servidor) y
  se descarta con él: `key={user?.id ?? "guest"}`.
- Toda respuesta de `/api/session/*` trae `userId`; si no coincide con el de la
  instancia, se vacía todo y se manda a identificarse.
- La memoria vacía (`clear`) no vuelve a la semilla: `useSessionData` sólo cae
  en la semilla mientras `cache.active`.
- El scroll y la pestaña activa del perfil viven en `cache.ui`, que es por
  instancia (por cuenta) y se vacía con ella.

## Restauración de scroll sin salto

Next hace scroll al inicio en cada `push`, en un `componentDidMount` del
enrutador que corre DESPUÉS de los efectos de layout de la página. Restaurar
antes es imposible y restaurar después (en `requestAnimationFrame`) se ve como
un salto. Por eso las navegaciones de pestaña usan `scroll: false` y marcan la
restauración como pendiente (`marcarRestauracionPendiente`); el primer
`SessionScroll` que se monta con datos la consume y coloca el scroll en un
efecto de layout, antes de pintar. Un enlace cualquiera a la misma ruta (el
logo, «Ver más») no marca nada y conserva el scroll-al-inicio de siempre.
Tocar la pestaña ya activa sube arriba, como en iOS.

## Coste en el servidor

- Visita en frío: igual que master (consultas en el servidor, HTML con datos).
- Vuelta dentro de 30 s: cero (cache del router).
- Vuelta después: `loading.tsx` pinta la memoria; el servidor renderiza la
  página una vez (como hoy) y la memoria se actualiza con la semilla.
- Precarga: `FULL` en `/chat` y `/perfil` (1 y 5 consultas pequeñas), `AUTO` en
  `/` y `/buscar` (el RPC de 150 filas no se paga por cada intento). El
  limitador de `NavigationPrefetch` (4 por 30 s) sigue acotando.
- Revalidación en segundo plano: una lectura JSON por clave y por vuelta con
  más de 30 s, frenada a 60/min por IP.

## Métricas de aceptación y cómo se miden

`window.__vicinoNavigationMetrics()` (ya existía) devuelve por navegación
`feedback_ms`, `route_commit_ms` y `core_dom_ms`. Un regreso servido por la
cache del router o por la memoria produce `core_dom_ms` bajo (≤ 200 ms p95 en
un teléfono medio) y ningún esqueleto de pantalla completa: el marcador
`data-navigation-ready` del consumidor cambia con `updatedAt`, así que la
métrica cierra sobre contenido real, no sobre el esqueleto.
