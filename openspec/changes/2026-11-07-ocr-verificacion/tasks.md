# Tasks — OCR de documentos de verificación

> `[x]` = escrito y probado en la rama `feat/verificacion-ocr-20261107`. No
> significa fusionado ni activado en producción. Cada fase de código cierra con
> el CODEX Adversarial Review Loop (`CLAUDE.md`), `pnpm build` local y la
> revisión de Javier antes de fusionar; cada fusión a `master` despliega.

## FASE 0 — Decisiones y GATE 0

- [ ] T-00 — Javier responde D1–D8 (`proposal.md`). Sin D1 no hay fase 2.
- [ ] T-01 — Pedro firma P1–P7. P2 (llave de prueba o alta en Google Cloud)
      bloquea la prueba con muestras.
- [ ] T-02 — GATE 0: `git fetch origin master` y releer `verify-document.ts`,
      `veredicto.ts` y el DDL real de `seller_verification` y
      `verification_consent` antes de escribir la migración.
- [ ] T-03 — Pedro, en solo lectura: `verification_document_purge_log` y
      `cron.job_run_details` para confirmar que la purga corre hoy.

## FASE 1 — Preparado sin cambiar producción

- [x] T-10 — C1: `lib/verificacion/campos-documento.ts` (CURP, clave de elector,
      vigencia, zona de lectura de la INE, cotejo de nombre, frente contra
      reverso y mayoría de edad). Indicadores, nunca valores. Sin llamadores.
      Pruebas: `campos-documento.test.ts` con datos sintéticos, vectores
      calculados aparte, un carácter cambiado y el caso documentado de la
      posición 9 que el dígito no ve.
- [x] T-11 — C2: `lib/verificacion/ocr/tipos.ts` e `indicadores.ts`
      (`reducirAIndicadores`, `leerIndicadores` con el lector por parámetro,
      `cotejarUniversidad` con `no_cotejable`). Prueba que falla si un indicador
      contiene cualquier cadena de la lectura. Lector falso solo en la prueba.
- [x] T-12 — C3: `decidirEstado(a, esUniversitaria, { aprobacionAutomatica,
      rechazoAutomatico })`, `esAprobable`, `esRechazable`; variable
      `VERIFICACION_RECHAZO_AUTOMATICO` (encendida salvo `"false"` exacto);
      campo aditivo `rechazable` en la nota. Casos nuevos en
      `scripts/test-veredicto-verificacion.ts` (fallan contra el código
      anterior) y de integración en `lib/verificacion/verificar-documento.test.ts`.
- [x] T-13 — C4: `VERIFICACION_ANALISIS_IA=off` (encendido salvo `"off"`
      exacto), comprobada después del tipo, la universidad y el consentimiento;
      mismo retorno que sin llave. Prueba de integración sin red: no lista, no
      descarga, no cobra cuota ni llama al modelo, y sigue exigiendo el
      consentimiento.
- [x] T-14 — C5: `sonFotosDistintas` (`lib/verificacion/rutas-de-fotos.ts`) y su
      uso en `verifyDocument` antes del consentimiento. Compara el objeto que se
      descargaría (`?`, `#`, `%xx`, `\`, `.`), no el texto. No exige aún las
      rutas canónicas. Una ruta con controles o espacios en los bordes (el
      analizador de URL los quita o los codifica) cuenta como repetida. No
      detecta el mismo contenido subido con dos nombres: eso pediría comparar
      los bytes.
- [ ] T-15 — Que la CI corra las pruebas de `apps/web/lib` (lo agrega otra rama;
      las de esta están escritas con imports relativos para eso).
- [ ] T-16 — Fase secuencial: `pnpm type-check`, `pnpm lint` y `pnpm build` de
      la app con estos cambios. Hecho el 7-nov en esta rama: `tsc --noEmit` del
      paquete web y eslint de los archivos tocados, los dos en verde. Falta
      `pnpm lint` completo y `pnpm build`, sobre un checkout limpio de la rama
      y con los archivos nuevos ya en el commit (`verify-document.ts` importa
      `rutas-de-fotos.ts`).

## Antes de apagar el rechazo automático (P1)

- [ ] T-20 — Llevar `rechazable` al historial: `normalizarAnterior` y
      `esRechazo` en `lib/verificacion/vigencia-analisis.ts`, para que esas notas
      sigan en el cupo de rechazos. Toca la etiqueta del historial en el panel:
      revisión de Javier.
- [ ] T-21 — Pedro pone `VERIFICACION_RECHAZO_AUTOMATICO=false` en Production y
      redespliega; comprobar en staging que una nota rechazable deja la fila en
      la cola.

## FASE 2 — Lector y almacenamiento (OCR apagado)

- [ ] T-30 — Migración: tabla privada de lecturas (`design.md` §5) con
      `UNIQUE (verification_id, version_fotos)`, FK `ON DELETE CASCADE`, RLS
      sin policies, `REVOKE ALL` a `anon` y `authenticated`, y trigger que borra
      las lecturas cuando la purga pone las tres URL a NULL. Sin CHECK que pueda
      citar valores. Probada con `SET LOCAL ROLE` en staging.
- [ ] T-31 — Tipos generados (`apps/web/types/database.types.ts`).
- [ ] T-32 — Adaptador con el modelo ya integrado (`lib/verificacion/ocr/modelo.ts`):
      solo frente y reverso, esquema estricto, `sharp` para EXIF, mismo tope,
      reintentos y manejo de fallo que la llamada actual. Su respuesta pasa por
      `leerIndicadores`, nunca directa a la base.
- [ ] T-33 — Integración en `verifyDocument` detrás de `VERIFICACION_OCR`
      (apagado por defecto): tras la cuota, con el cliente del usuario para la
      cuota, `INSERT … ON CONFLICT DO NOTHING`, nunca cambia el estado, capturas
      sin `details`. Para la interpretación C, la salida de C4
      (`VERIFICACION_ANALISIS_IA=off`) pasa a saltar solo la llamada al modelo
      (`design.md` §1); si no, con B encendido el OCR nunca corre.
- [ ] T-34 — Pruebas de integración: apagado = cero llamadas; encendido = un
      INSERT y ningún cambio de estado; lector caído = fila intacta; ni la
      lectura ni los indicadores salen en la respuesta de la acción
      (`design.md` §6). Ajustar la prueba de C4 si cambia su salida.

## FASE 3 — Panel del revisor

- [ ] T-40 — Bloque «Lectura del documento» con indicadores en palabras, sin
      valores, con la misma etiqueta de vigencia que la nota de la IA y el patrón
      «No cuadra: …» de `alarmasDelAnalisis`. Diseño y textos de Javier.
      Validación a 375×812 y 1280×800 (`apps/web/CLAUDE.md`).

## FASE 4 — Legal y consentimiento (Pedro con asesor)

- [ ] T-50 — Aviso: §8 (proveedor), §4.5 (CURP), §15 (retención real y tope de
      pendientes); Términos §7. Preaviso de 30 días si es sustancial.
- [ ] T-51 — Consentimiento por versión del Aviso y volver a mostrar la casilla
      a quien consintió una anterior. Texto de la casilla: Javier.
- [ ] T-52 — Play Console: declaración de Seguridad de los datos.

## FASE 5 — Pruebas con muestras y staging

- [ ] T-60 — Prueba comparativa con 5–10 muestras por tipo (buena y mala luz),
      fuera del repo; al repo solo métricas agregadas sin valores.
- [ ] T-61 — Validar con esas muestras los SUPUESTOS de `campos-documento.ts`
      (formato de la zona de lectura del INE, vencimiento, sexo X en la clave).
- [ ] T-62 — E2E en staging con usuario sintético y limpieza de fixtures
      (`design.md` §7). Requiere OK de Pedro para la migración en staging.

## FASE 6 — Devolución y reenvío (solo si D3 lo pide)

- [ ] T-70 — Versión mínima (0.5–1 día) o completa (2.5–4 días), según
      `design.md` §8.
