# Ubicación exacta por publicación (GEO-PUB-EXACT-20261104 / GEO-PRECISION-01)

> Estado al 8-nov-2026: rama `feat/ubicacion-exacta-20261108` sobre `master` `4c8e56b`.
> Migración `20261108210000` aplicada y probada en el **staging** (23/23 casos con roles reales);
> **nada aplicado en producción** (la migración la aplica Pedro antes del merge).

## Qué pidió el encargo y dónde quedó

| Punto del encargo | Cómo quedó |
| --- | --- |
| Interruptor «Ubicación exacta» encima del mapa y debajo del buscador, mismo interruptor del formulario | `InterruptorFormulario` en `vender/product-form.tsx`: el mismo botón `role=switch`, clases y estados que "Permitir agendar citas" y "Precio negociable", que ahora lo usan también (con nombre accesible y anillo de foco). Se pinta dentro del selector con `controlEntreBuscadorYMapa` (`components/map/location-picker.tsx`). |
| Nueva publicación: encendido, mapa visible sin pin | `PRECISION_POR_DEFECTO_AL_CREAR = "exacta"`. El mapa sigue abriendo en Puebla sin selección (`showMapInitially`, `position = null`). |
| Encendido: elige el punto, ve la vista previa y confirma al publicar | La vista previa es el pin (texto "así verán los compradores tu punto"). Publicar manda `confirmar_ubicacion_exacta=1`. |
| Centro inicial y GPS fuera del dato público | La selección solo llega por toque, arrastre o búsqueda. El formulario no activa el GPS (`allowGeolocation` sigue apagado) y el centro nunca es selección. |
| Apagado: cuadrícula aproximada | La vista previa dibuja la celda (círculo) en su centro redondeado; el punto del vendedor no se publica. La etiqueta pública pasa a ser **colonia y ciudad** (`zonaPublica`), nunca calle ni número. |
| Al editar: carga el modo guardado; reconfirma si cambia un punto exacto | `ubicacion_de_mi_publicacion` trae punto, modo y revisión. Pasar a exacta, o mover un punto exacto, abre la confirmación «¿Mostrar el punto exacto?» antes de guardar. |
| Publicaciones existentes: conservan ubicación y visibilidad, sin avisos | `ubicacion_precision` nace `'aproximada'` por DEFAULT constante (sin reescribir la tabla ni tocar `updated_at`). Con la variable de Vercel como hoy, se ven **exactamente igual** (~1 km). |
| Editar precio o fotos no cambia la precisión | Acción `conservar`: el servidor no escribe ni punto, ni etiqueta, ni radio, ni modo (antes reescribía `ubicacion_geo` en cada edición y disparaba el trigger de cobertura). |
| Separar centro, selección y vista previa; al quitar, mapa visible sin pin; cambiar de modo conserva la selección | Centro (`view`) y selección (`position`) ya estaban separados; la vista previa es derivada (pin o celda). Cambiar de modo solo cambia la etiqueta y la vista previa. |
| Guardar juntos modo, punto público y revisión; separar el punto de `ubicacion_geo` | Una sola escritura (`ubicacion_geo` + `ubicacion_precision`); el trigger `zz_ubicacion_publica_derivada` deriva `ubicacion_exacta` (columna propia, sin SELECT para clientes) y sube `ubicacion_revision`. |
| Ficha, minimapa y mapa leen el mismo dato autorizado | `public.ubicacion_publica_punto(...)` es la única proyección. La usan `search_map_publications_v4` (mapa) y `ubicacion_publica_de_publicacion` (ficha y minimapa). |
| La caché deja de servir el punto anterior | El minimapa responde `private, no-cache` con `ETag` de la revisión: cada vista revalida (304 sin otra imagen de Apple) y una revisión nueva trae la imagen nueva. La revisión del mapa incluye modo y revisión de la ubicación. |
| La variable de Vercel controla la cuadrícula; la elección por publicación conectada | `VICINO_MAPA_RPC` decide la rejilla APROXIMADA de todo (mapa, ficha, minimapa): sin variable ~1 km; `v3` ~110 m. Las exactas funcionan desde el despliegue, con o sin variable. |

## Cómo funciona

```
Formulario (vender)                      Base (products_services)
  ubicacion_lat/lng  ─┐                    ubicacion_geo (privada)
  ubicacion_precision ├─ una escritura ──▶ ubicacion_precision ('exacta' | 'aproximada')
  ubicacion_accion   ─┘                    ubicacion_exacta  ◀─ trigger: = ubicacion_geo solo si exacta
  confirmar_ubicacion_exacta                ubicacion_revision ◀─ trigger: +1 si cambian modo o punto

P = ubicacion_publica_punto(precision, exacta, geo, decimales)
  exacta     → el punto elegido
  aproximada → geo redondeado a 2 decimales (~1 km) o 3 (~110 m)

Mapa:      /api/publications/map/coverage → search_map_publications_v4(p_request + rejilla)
             cells[].punto {lat,lng} solo si la celda es de UNA ubicación exacta
             features[].precision = 'exacta' en la vista general
Ficha:     page.tsx (RLS) → ubicacion_publica_de_publicacion (service_role) → disponible, modo, revisión
Minimapa:  /api/products/[id]/location-map (RLS) → misma función → snapshot centrado en P
```

- **Revisión que no delata.** `ubicacion_revision` sube solo cuando cambia algo público: la precisión, el punto exacto o, en aproximada, la celda de 110 m. Mover el pin privado dentro de su celda no la cambia.
- **Fallo cerrado.** Un formulario abierto antes del despliegue no manda `ubicacion_accion` ni `ubicacion_precision`: al publicar queda aproximada; al editar, si movió el pin, aproximada. El servidor exige `confirmar_ubicacion_exacta=1` para guardar una exacta.
- **Escrituras directas.** El INSERT de `products_services` es de tabla: un cliente puede mandar `ubicacion_exacta` o `ubicacion_revision`, y el trigger los pisa. `authenticated` solo tiene UPDATE de `ubicacion_precision`. Nadie lee las tres columnas por PostgREST.
- **Celdas compartidas.** Si una exacta comparte su celda de 110 m con otra publicación, el mapa muestra el número de la celda (no el pin individual) y el detalle lista las dos; no se suelta el punto de la otra. Con la rejilla de 1 km (la de hoy) casi no pasa.
- **Caída.** Si v4 no existe todavía, la ruta del mapa cae a v3 o v2 según la rejilla; la ficha y el minimapa usan el camino de antes. El preview de la rama apunta a la base de producción: hasta aplicar la migración, publicar ahí falla (columna inexistente).

## Activación

1. Pedro aplica la migración (es compatible con el código de `master`; va antes del merge):

   ```bash
   node scripts/apply-migration.mjs supabase/migrations/20261108210000_ubicacion_exacta_por_publicacion.sql
   ```

   y corre el bloque VERIFY del final del archivo.
2. Claude regenera los tipos (`node scripts/gen-types.mjs`) y los sube a la rama: la check de tipos pasa a verde.
3. Merge con el OK de Pedro. Desde ese despliegue: interruptor en el formulario, exactas en ficha, minimapa y mapa; las aproximadas siguen a ~1 km.
4. **Aparte, decisión de producto:** `VICINO_MAPA_RPC=v3` en Vercel y redeploy pasa TODAS las aproximadas (también las históricas) de ~1 km a ~110 m en mapa, ficha y minimapa a la vez.

## Reversión

- Quitar `VICINO_MAPA_RPC` (si se activó) y redeploy: las aproximadas vuelven a ~1 km.
- Revertir el merge: el formulario deja de ofrecer exacta y la ficha, el minimapa y el mapa vuelven al código de antes. Las columnas nuevas no estorban al código viejo.
- Solo si hace falta, la base: `docs/rollback/20261108210000_ubicacion_exacta_por_publicacion_rollback.sql` (borra la elección de cada publicación; trae cómo guardarla antes).

## Pruebas

| Dónde | Qué | Resultado |
| --- | --- | --- |
| Staging (PostGIS 3.3, PostgREST, RLS reales) | `node scripts/staging/probar-ubicacion-exacta.mjs`: 23 casos (escritura del dueño, columnas ilegibles, escrituras directas rechazadas, otra cuenta, v4 en las dos rejillas, celda compartida, bloqueos, anon, función de la ficha solo para service_role, editar precio, mover dentro y fuera de la celda, revocar, quitar, vista ancha igual a v3, históricas iguales a v2) | 23/23 |
| CI (`security.yml`) | `escritura-ubicacion`, `ubicacion-publica`, `map-coverage.exacta`, rutas del minimapa y del mapa con `cargarReal` | 32/32 |
| CI (`security.yml`) | `scripts/test-product-optional-actions.cjs` con 9 casos de ubicación | 29/29 |
| CI (`database-types.yml`) | `ubicacion_exacta` no escribible en los tipos | en verde |

No se pudo probar aquí (regla de la laptop: sin navegador ni `next dev`): MapKit real, gestos del pin, la imagen de Apple, la app nativa. Se prueba en el preview de Vercel (tras aplicar la migración) y en los teléfonos.

## Revisión (8-nov-2026)

Tres revisores independientes (seguridad y privacidad, base de datos, TypeScript y React) sobre `0135ab5b`, solo lectura.

| Hallazgo | Severidad | Qué se hizo |
| --- | --- | --- |
| El prefiltro geography de v4 perdía publicaciones pegadas al borde sur en vistas de más de ~3 grados de ancho (el lado sur es un arco que se curva al norte) | Alto | `ST_Segmentize(..., 0.25)` antes del cast; caso nuevo en el staging (vista de 23 grados, igual que v3) |
| La revisión delataba que el vendedor movía su pin privado dentro de la celda | Bajo | La revisión sigue solo a lo público; fuera del md5 del mapa; caso nuevo en el staging |
| `GRANT INSERT (ubicacion_precision)` y comprobaciones de `service_role` y `anon` en el DO | Medio | Hecho (el INSERT de producción es de tabla: comprobado en solo lectura) |
| La proyección se evaluaba ~14 veces por fila en v4 | Bajo | `OFFSET 0` en el LATERAL |
| La reversión no era una sola transacción | Bajo | `BEGIN..COMMIT` |
| «Guardando…» se quedaba puesto si un campo obligatorio fallaba al confirmar la exacta | Medio | `reportValidity()` antes de enviar |
| Teclear en el buscador cancelaba la zona pedida y la etiqueta quedaba genérica | Bajo | Solo se cancela al moverse |
| Tocar y dejar igual reescribía la ubicación | Bajo | Ahora es «conservar» |
| `createProduct` mandaba a Sentry los `details` de Postgres (la fila, con el punto) | Bajo | Ya no |

Quedan, con su motivo:

- **Alto, anterior a este PR:** `search_nearby_products_v4` (feed «Cerca de ti») es SECURITY DEFINER, ejecutable por `anon` y calcula la distancia desde `ubicacion_geo` (redondeada hacia arriba a 100 m). Con tres orígenes elegidos a mano se puede triangular el punto privado de cualquier publicación, también de las aproximadas. Arreglo propuesto, en un PR aparte porque cambia el feed: medir la distancia y el radio sobre `ubicacion_publica_punto`, o llamar la RPC solo desde el servidor.
- **Medio, decisión:** la exacta arranca encendida (lo pide el encargo) y publicar es la confirmación. La confirmación «¿Mostrar el punto exacto?» ya existe para editar; usarla también al publicar es un cambio de una línea si Alejandro lo prefiere.
- **Bajo:** el servidor no valida la etiqueta según la precisión (un POST a mano del propio vendedor puede guardar calle y número en una aproximada); las etiquetas históricas se conservan.
- **Bajo:** entre la comprobación RLS y la lectura con `service_role` del minimapa hay milisegundos; lo que se sirve es siempre el estado público vigente.

## Decisiones abiertas (no son de código)

- **Aviso de privacidad (Pedro).** §4.1 dice «ubicación aproximada (ciudad, colonia o zona — nunca dirección exacta sin autorización expresa del Usuario)». Elegir el punto, verlo y publicar es esa autorización, pero el interruptor arranca encendido. Cambiar el texto obliga a subir la versión y a que todos reconfirmen (`middleware.ts`), lo que choca con «sin avisos».
- **Copy y diseño (Alejandro).** Ayuda del interruptor («Apágalo si es tu casa»), vista previa, confirmación al editar, texto de la ficha para exactas y etiqueta de los pines («ubicación exacta»). El pin exacto usa el mismo marcador que una zona; un estilo propio es decisión de diseño.
- **Etiquetas históricas.** Las publicaciones anteriores pueden tener calle y número en su texto público (`ubicacion`); se conservan tal cual («sin cambios»). Las nuevas aproximadas guardan colonia y ciudad.
- **110 m para todas.** Activar `v3` sigue siendo el hallazgo ALTO de la auditoría del #75 (110 m + nombre del vendedor).
