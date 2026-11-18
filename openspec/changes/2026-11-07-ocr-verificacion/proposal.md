# Proposal — OCR de documentos de verificación

> Change: `2026-11-07-ocr-verificacion`. Rama `feat/verificacion-ocr-20261107`
> sobre `master` `192876f` (el commit que sirve producción).
> **Plan más piezas preparadas y apagadas.** Lo que esta rama trae de código no
> cambia el comportamiento de producción al fusionarse, salvo C5, que solo
> afecta a filas manipuladas (ver «Qué queda preparado»). Javier
> decide el alcance (D1–D8) y Pedro firma las decisiones de entorno, proveedor y
> legales (P1–P7) antes de cualquier `/opsx:apply` de las fases 2 en adelante.

## Why

En el seguimiento técnico del 7-nov-2026, Javier pidió evaluar qué tan rápido
se puede extraer texto de la foto de un documento de identidad y presentarlo de
forma útil al revisor; en sus palabras, preparar todo, dejarlo listo y
«desactivar exactamente el sistema que tenemos». El alcance de esa
desactivación quedó por acordar, y de él depende qué se programa, a qué
proveedor van las fotos y qué hay que cambiar en el Aviso de Privacidad.

## Lo que hay hoy (leído en `192876f`, no supuesto)

- **No hay OCR.** `verifyDocument` (`apps/web/app/actions/verify-document.ts`)
  manda selfie, frente y reverso en una sola llamada a un modelo de visión de
  OpenAI (`OPENAI_VERIFICATION_MODEL`, `gpt-4o` por defecto), valida el JSON con
  zod (`lib/verificacion/analisis.ts`) y guarda la nota atada a la versión de
  las fotos (`ai_analizado_en`, reloj de Storage). No hay ninguna dependencia de
  OCR en `pnpm-lock.yaml`.
- **La IA ya no aprueba sola, pero sí rechaza sola.** `VERIFICACION_APROBACION_AUTOMATICA`
  (apagada salvo `"true"`) solo actúa al final de `decidirEstado`
  (`lib/verificacion/veredicto.ts`); los cuatro caminos de rechazo se evalúan
  antes y la acción escribe `rejected` con service_role.
- **Un rechazo de la IA es irreversible en la práctica.** `rejected` es estado
  resuelto: la fila sale de la cola del panel, nadie recibe aviso (solo el
  rechazo humano notifica) y la purga horaria borra las tres imágenes
  (`supabase/functions/purge-verification-documents`). Que la purga corra hoy
  es el diseño; su último estado verificado es del 26-ago (README de la
  función): Pedro lo confirma en solo lectura antes de darlo por hecho.
- **Apagar todo el análisis ya se puede sin código** quitando `OPENAI_API_KEY`,
  pero esa salida va antes del consentimiento biométrico: nada en el servidor
  lo comprueba para unas fotos que se siguen guardando y revisando a mano. Y con
  la llave se encienden y apagan juntos el análisis y el rechazo automático.
- **`ai_analysis_raw` guarda de más y sin plazo**: el análisis completo
  (`nombre_en_documento`, observaciones libres, motivo), la purga no lo toca y
  el vendedor puede leer su propia nota por REST.
- **El Aviso v2.2 no cubre un OCR**: §4.5 dice que VICINO no recaba la CURP; §8
  no nombra a OpenAI ni a otro proveedor para esta finalidad; §15 promete borrar
  los documentos a los 90 días, y las solicitudes pendientes no tienen tope.
  `tiene_consentimiento_biometrico` no mira la versión del Aviso aceptada.
- **El panel ya enseña indicadores sin datos del documento**: `alarmasDelAnalisis`
  se guarda en la nota y el panel la muestra como «No cuadra: …» con su
  etiqueta de vigencia. El bloque del OCR puede reutilizar ese patrón.

## Interpretaciones de «desactivar exactamente el sistema que tenemos»

| | Qué se apaga | Cómo, hoy | Estado en esta rama |
|---|---|---|---|
| **A** | Solo las decisiones automáticas: la IA sigue opinando, una persona decide siempre | La aprobación ya está apagada; el rechazo no tenía bandera | **Preparado (C3)**: `VERIFICACION_RECHAZO_AUTOMATICO=false` deja en `pending` los cuatro caminos y la nota guarda `rechazable` |
| **B** | Todo el análisis con IA: todo pasa a revisión humana | Quitar la llave (sin comprobar consentimiento) | **Preparado (C4)**: `VERIFICACION_ANALISIS_IA=off`, comprobada después del tipo, la universidad y el consentimiento |
| **C** | La IA actual se apaga; el OCR, cuando se active, solo da datos al revisor | — | Validadores e indicadores listos (C1, C2); falta el adaptador, la tabla y el panel |
| D (descartar) | Dejar la IA como está y solo preparar el OCR apagado | — | Mantiene el rechazo automático |

Recomendación: A desde ya (solo hay que poner la variable en Production y
redesplegar), C como meta, y B solo si el motivo es privacidad o costo.

## Qué queda preparado en esta rama (fusionarlo no cambia producción, salvo C5)

- **C1** `lib/verificacion/campos-documento.ts`: validadores puros de CURP,
  clave de elector, vigencia, zona de lectura mecánica del reverso de la INE y
  cotejo de nombre. Devuelven indicadores, nunca valores. Sin llamadores.
- **C2** `lib/verificacion/ocr/tipos.ts` e `indicadores.ts`: el contrato del
  lector intercambiable y la reducción de una lectura a indicadores sin valores.
  El lector falso existe solo en las pruebas. Sin llamadores.
- **C3** rechazo automático controlable (A). Por defecto, encendido: como hoy.
  Las notas nuevas llevan además la clave `rechazable` (aditiva; todavía no la
  lee nadie, y el vendedor la puede ver en su propia nota igual que ya ve
  `aprobable` y `alarmas`).
- **C4** apagado explícito del análisis (B). Por defecto, encendido: como hoy.
- **C5** `verifyDocument` ya no analiza una fila que apunta dos ranuras al
  mismo objeto del bucket (`lib/verificacion/rutas-de-fotos.ts`): el vendedor
  puede escribir las tres columnas por REST y antes el modelo podía comparar la
  foto del documento consigo misma. Se compara el objeto que pediría la
  descarga, no el texto, y una ruta ambigua (controles, espacios en los bordes,
  `..` o un `%xx` roto) cuenta como repetida. **No detecta el mismo contenido
  subido con dos nombres** (los bytes del frente subidos también como
  `<uid>/selfie`): la policy del bucket admite cualquier nombre bajo `<uid>/`,
  así que eso sigue pasando y el control real es el revisor. Detectarlo pediría
  comparar los bytes ya descargados. Es el único cambio de comportamiento, y
  solo afecta a filas manipuladas: la interfaz siempre escribe tres rutas
  distintas.

## What (fases 2 en adelante, tras la firma)

1. Adaptador de lectura con el modelo ya integrado, detrás de `VERIFICACION_OCR`
   (apagado por defecto): solo frente y reverso, sin la selfie, con esquema
   estricto; nunca cambia el estado de la solicitud.
2. Tabla privada de indicadores y su borrado alineado con la purga.
3. Bloque «Lectura del documento» en el panel del revisor (diseño de Javier).
4. Aviso, consentimiento con versión y declaración de Play Console.
5. Prueba de punta a punta en staging con datos sintéticos.
6. Opcional, según D3: devolución y reenvío.

## Scope

- **Dentro**: lo anterior, para la INE primero y la credencial universitaria
  con nombre, universidad y vigencia.
- **Fuera**: guardar o mostrar valores (CURP, clave, domicilio, matrícula);
  OCR en el cliente como evidencia; cambiar el prompt del análisis actual;
  migrar notas viejas de `ai_analysis_raw`; cambios de Sentry (van en su propia
  rama).

## Success criteria

- Con el OCR apagado, cero llamadas y cero escrituras nuevas (se cuenta en
  `verificacion_ia_consumo` y en la tabla nueva).
- Ningún indicador guardado contiene texto del documento (prueba que falla si
  aparece cualquier cadena leída; ya existe para C2).
- Ninguna lectura cambia el estado de una solicitud: solo una persona aprueba o
  rechaza (con A encendida).
- Los indicadores se borran cuando la purga borra los documentos.

## Decisiones

### Javier (alcance y producto)

- **D1** ¿Qué se apaga: A, B o C? Recomendación: A ya, C como meta.
- **D2** ¿Por qué se apaga: por las decisiones automáticas, por el costo o por no
  mandar fotos a un tercero? Define el proveedor (ver `design.md`).
- **D3** ¿Qué es «regresar documento»: que el revisor pida otra foto con un
  motivo, o que el OCR devuelva lo que leyó? Lo primero suma la devolución.
- **D4** ¿Qué indicadores quiere ver el revisor? Propuesta: nombre, CURP válida,
  clave válida, vigencia, zona de lectura, mismo documento y mayor de edad;
  solo estados, sin valores.
- **D5** ¿El OCR solo informa, o también bloquea «Aprobar» cuando algo no cuadra?
- **D6** ¿Se sigue aceptando la credencial universitaria, o se cambia por un
  código al correo institucional (plan LEGAL)? Si se cambia, sobra su OCR.
- **D7** ¿El cotejo de la selfie con la foto del documento sigue con IA, lo hace
  el revisor a ojo, o se apaga con lo demás? Dato para decidir: C5 no impide
  subir la misma foto con dos nombres, así que hoy ese cotejo se engaña con
  poco esfuerzo.
- **D8** Cuando un revisor rechaza, ¿se muestra su motivo en la pantalla de
  verificación? Hoy solo llega en la notificación.

### Pedro (entorno, proveedor y legal)

- **P1** Valor en Production de `VERIFICACION_RECHAZO_AUTOMATICO` y
  `VERIFICACION_ANALISIS_IA`, y redespliegue (sin redespliegue no surten
  efecto). Antes de apagar el rechazo, que el historial lea `rechazable`
  (ver `tasks.md`).
- **P2** Llave de un proyecto de prueba de OpenAI con tope de gasto, o el alta en
  Google Cloud (proyecto, facturación, Vision API y cuenta de servicio) si D2 es
  «no mandar fotos a un tercero».
- **P3** Confirmar si `OPENAI_API_KEY` está en Production (`vercel env ls`, o el
  aviso «OPENAI_API_KEY ausente en produccion» en Sentry).
- **P4** Aviso con asesor (y su revisión frente a la ley de 2025 que ya marca
  `docs/planes-2026-09-26/LEGAL-credencial-estudiante.md`): proveedor en §8,
  CURP en §4.5, retención real y tope de pendientes en §15; consentimiento
  exigido por versión. Si el cambio es sustancial, 30 días de preaviso (lo
  impone el CHECK de `20260826380000`).
- **P5** Cerrar las tareas de seguridad abiertas antes de guardar más datos de
  identidad.
- **P6** Aplicar en producción las migraciones de la fase 2 y comprobar en solo
  lectura `verification_document_purge_log` y `cron.job_run_details`.
- **P7** Revisar en Play Console la declaración de Seguridad de los datos si
  entra un proveedor o un dato nuevo.

## Estimación (una persona)

- **Prueba con un tipo (la INE)**: 1–2 días hábiles, con muestras y llave de
  prueba.
- **MVP con dos tipos, revisión humana y staging**: 5 a 6.75 días. El desglose
  está en `design.md`; esta rama ya adelanta parte de «validadores» y de «quitar
  el rechazo automático», pero no se resta hasta que se revise y se fusione.
- **Devolución y reenvío**: versión mínima 0.5–1 día; completa 2.5–4 días.
- Fuera de ingeniería: altas de proveedor, dictamen legal, preaviso del Aviso y
  revisión de diseño.
