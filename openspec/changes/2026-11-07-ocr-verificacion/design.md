# Design — OCR de documentos de verificación

> Acompaña a `proposal.md`. Lo marcado **SUPUESTO** no está comprobado y se
> valida con muestras antes de activarse. Referencias de código sobre `192876f`
> salvo que se diga otra cosa.

## 1. Dónde encaja

```
verifyDocument (sesión → tipo/universidad → suelo → fila → rutas propias
               → rutas distintas [C5] → consentimiento → VERIFICACION_ANALISIS_IA [C4]
               → perfil → versión de las fotos → cuota → …)
   ├─ análisis actual (modelo de visión, 3 imágenes) → decidirEstado [C3] → UPDATE de la fila
   └─ (fase 2) lector de documentos, detrás de VERIFICACION_OCR (apagado por defecto)
        frente + reverso → LecturaDocumento (solo en memoria)
        → reducirAIndicadores → IndicadoresLectura (sin valores) → tabla privada
```

**Ojo con C contra C4.** Tal como quedó, `VERIFICACION_ANALISIS_IA=off` sale
justo después del consentimiento, antes del perfil, la versión de las fotos y
la cuota; como el lector va después de la cuota, con B encendido el OCR nunca
correría. Para C, la salida de C4 tiene que convertirse en «saltar solo la
llamada al modelo»: con `VERIFICACION_OCR` encendido se sigue por el perfil, la
versión y la cuota. Ese día hay que ajustar también la prueba de integración de
C4 (`verificar-documento.test.ts`), que hoy fija cero listados, descargas y
cobros con el análisis apagado.

Reglas que no se negocian:

- **El lector nunca cambia el estado de la solicitud.** Solo produce
  indicadores para el revisor. Con A encendida, solo una persona aprueba o
  rechaza.
- **Corre detrás de las mismas guardas** que el análisis actual: sesión, fila
  propia, rutas leídas de la fila y distintas, consentimiento, nombre, versión
  de las fotos y cuota.
- **La selfie no va al lector.** `ImagenesDelDocumento` solo tiene frente y
  reverso, y `leerIndicadores` le pasa al adaptador exactamente esas dos claves.
- **El lector entra por parámetro.** No hay lector por defecto ni uno elegido por
  variable de entorno; el falso vive solo en las pruebas
  (`lib/verificacion/ocr/indicadores.test.ts`). Si el e2e de staging lo
  necesitara, se activaría solo cuando `NEXT_PUBLIC_SUPABASE_URL` sea la del
  proyecto de staging (por ref fijo) y se negaría siempre con el de producción.
- **La cuota se cobra con el cliente del usuario.** `consumir_cuota_verificacion_ia`
  usa `auth.uid()`; con el cliente admin falla con 42501.

## 2. Proveedor: un lector intercambiable

Contrato en `lib/verificacion/ocr/tipos.ts` (`LectorDeDocumento.leer(imagenes,
tipo) → LecturaDocumento`). El orden propuesto:

1. **Modelo de visión ya integrado** como primer adaptador: no hace falta
   proveedor ni cuenta nuevos, porque las fotos ya van hoy a OpenAI. Con esquema
   JSON estricto, solo frente y reverso, y `sharp` (ya instalado) para orientar
   por EXIF, escalar y quitar metadatos antes de mandar. No es un OCR
   determinista: puede «leer» un carácter plausible que no está y no da
   confianza por carácter. Por eso la validación vive en nuestro código (§4) y
   decide una persona.
2. **Google Cloud Vision** (`DOCUMENT_TEXT_DETECTION`) si D2 es «no mandar los
   documentos a un tercero más» o si el modelo lee mal: lee bien fotos de
   teléfono y da confianza por palabra. Requiere el alta de Pedro (proyecto,
   facturación, API y cuenta de servicio o federación desde Vercel), declarar a
   Google para esta finalidad en el §8 del Aviso y confirmar región y
   condiciones de uso de datos en la documentación del proveedor.
3. **Tesseract en el servidor**, como prueba barata para la zona de lectura
   mecánica (fuente OCR-B): no requiere cuentas y los datos no salen de la
   infraestructura ya declarada, pero hay que empaquetar el modelo de idioma y
   probar el arranque en frío y el tope de 60 s de la ruta.

Descartados como evidencia: OCR en el cliente (se falsifica desde la consola;
sirve, como mucho, para avisar «la foto no se lee»), Textract AnalyzeID (solo
identificaciones de EE. UU.) y el modelo de identificaciones de Azure mientras
las muestras no demuestren que lee la INE.

## 3. Campos e indicadores

Solo estados, nunca valores (`IndicadoresLectura`):

| Indicador | Estados | De dónde sale |
|---|---|---|
| `nombre` | coincide / parcial / no / ilegible | Nombre leído contra `profiles.nombre`, sin acentos, mayúsculas, espacios, orden ni partículas |
| `curp` | valida / invalida / ilegible / no_aplica | Forma, entidad, fecha (siglo por la posición 17), nacimiento no futuro y dígito verificador |
| `clave_elector` | valida / invalida / ilegible / no_aplica | Forma y, con una CURP válida, mismo nacimiento y sexo |
| `vigencia` | valida / invalida / ilegible | Último año ≥ año en curso en la Ciudad de México; periodo posible |
| `mrz` | valida / invalida / ilegible / no_aplica | Tres líneas TD1, prefijo `IDMEX`, fechas y cuatro dígitos de control 7-3-1 |
| `mismo_documento` | coincide / parcial / no / ilegible / no_aplica | Frente contra zona de lectura: nacimiento, año de vencimiento y nombre |
| `mayor_de_edad` | si / no / no_determinable / no_aplica | Fecha de la CURP contra hoy (Aviso §16); `no_determinable` si el siglo sale de un dígito y la edad pasaría de cien años (§4) |
| `universidad` | coincide / no / ilegible / no_cotejable / no_aplica | Formas impresas de las 9 de la lista; fuera de la lista, `no_cotejable` |

Se excluyen a propósito: domicilio, sección, firma, fecha de nacimiento
completa y matrícula. Lo que no se lee no se puede filtrar. La credencial
universitaria solo lleva nombre, universidad y vigencia (si aparece).

## 4. Validación en nuestro código (`lib/verificacion/campos-documento.ts`)

- **CURP.** Diccionario `0-9A-NÑO-Z` (0..36), la posición *i* pesa 19 − *i*,
  dígito = (10 − suma mod 10) mod 10. **Límites conocidos**: un cambio en la
  posición 9 (peso 10) nunca se detecta; los pesos 15 y 5 no ven diferencias
  pares y los pesos pares no ven diferencias múltiplo de 5. La prueba lo fija
  con un caso documentado y con una comprobación exhaustiva de un carácter: el
  dígito verificador no puede ser decisión única.
- **Posición 17**: dígito para nacidos antes de 2000, letra después; de ahí sale
  el siglo. Con peso 2, el dígito verificador no ve los pares letra/dígito cuya
  diferencia de valor es múltiplo de 5 (G/6, O/0, L/1, B/6, A/0, A/5…), así que
  una confusión entre los dos a veces pasa. Cada dirección se atrapa distinto:
  - un **dígito leído como letra** manda la fecha cien años adelante y, salvo
    para quien tiene cien o más, al futuro: lo delata `validarCurp` con `hoy`;
  - una **letra leída como dígito** (alguien nacido desde 2000) manda la fecha
    cien años atrás, al pasado, y `validarCurp` la da por válida. La cubre
    `esMayorDeEdad`: con el siglo sacado de un dígito, cien años o más dan
    `no_determinable`, para que un menor no salga «mayor de edad». La confusión
    suma exactamente cien años a la edad real, así que el umbral la atrapa
    siempre; el precio es que un centenario de verdad lo mira una persona. Ni
    la clave de elector ni la zona de lectura traen siglo, así que
    `mismo_documento` tampoco la ve.
- **Clave de elector**: sin dígito verificador público; solo forma y coherencia
  con la CURP. **SUPUESTO**: se admite X como sexo, igual que en la CURP.
- **Zona de lectura mecánica. SUPUESTO**: formato TD1 de ICAO 9303 (3 × 30),
  línea 1 `IDMEX…`, vencimiento en el último año de VIGENCIA. El algoritmo 7-3-1
  se probó con el ejemplo TD1 de ICAO (estado ficticio); el formato concreto del
  INE no está en el repo y se valida con muestras. El sexo no se coteja (H/M en
  español o M/F en ICAO hacen ambigua la M).
- **Nombre**: sin tolerancia a letras mal leídas: una letra cambiada da `no` o
  `parcial`, y eso solo pide que una persona mire.

## 5. Almacenamiento

Tabla nueva, privada y de solo inserción (nombre tentativo `verificacion_lectura`):

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `verification_id` | uuid NOT NULL | FK a `seller_verification(id)` ON DELETE CASCADE (cubre `delete_user_data`) |
| `version_fotos` | timestamptz NOT NULL | El mismo `analizadoEn` que hoy se guarda en `ai_analizado_en` (reloj de Storage, leído antes de descargar) |
| `entrada` | jsonb NOT NULL | `{tipo, universidad}`, como la nota actual |
| `proveedor` | text NOT NULL | Nombre del adaptador, no del documento |
| `indicadores` | jsonb NOT NULL | `IndicadoresLectura`; sin texto del documento |
| `creado_en` | timestamptz NOT NULL DEFAULT now() | |

- **`UNIQUE (verification_id, version_fotos)`** y `INSERT … ON CONFLICT DO NOTHING`:
  la tabla no hereda el bloqueo optimista de `seller_verification`, y dos
  llamadas simultáneas (que pagan las dos) no deben dejar dos lecturas. Como el
  lector nunca cambia el estado, no necesita ir en la misma transacción que el
  UPDATE de la fila.
- **RLS activa sin policies y `REVOKE ALL` a `anon` y `authenticated`**, como la
  tabla de cuota (`20260913150000`). El vendedor puede leer su propia fila de
  `seller_verification` por REST; por eso los indicadores no van ahí.
- **Borrado por trigger, no en la Edge Function.** `AFTER UPDATE` en
  `seller_verification` que borra las lecturas de esa fila cuando las tres URL
  pasan a NULL, que es lo que hace la purga. `purge-verification-documents` es
  código recuperado del bundle y borra documentos de identidad sin vuelta
  atrás: no se redespliega por esto.
- **Sin CHECK que pueda citar valores**: un error de restricción manda en
  `details` la fila entera («Failing row contains …»), y las capturas actuales
  adjuntan `details`. La tabla se diseña sin valores y las capturas del OCR no
  adjuntan `details`.
- El panel compara `version_fotos` con el `updated_at` de cada foto, con la
  misma etiqueta de vigencia que la nota de la IA (vigente / desfasado / sin
  comprobar, `lib/verificacion/vigencia-analisis.ts`).

## 6. Privacidad

- Procesar en memoria y guardar solo indicadores: ni valores ni texto bruto, ni
  en la base, ni en Sentry, ni en logs. Un fallo del lector no propaga su error
  (`leerIndicadores`), porque el mensaje de un proveedor puede citar lo leído.
- Sin `details` de Postgres en las capturas del OCR (§5).
- **Tampoco en la respuesta de la acción.** Ni `LecturaDocumento` ni
  `IndicadoresLectura` salen en el resultado de `verifyDocument`: lo que
  devuelve una Server Action se ve en las herramientas de red aunque la
  pantalla no lo pinte. Hay precedente: hoy la acción devuelve `analysis`
  completo (con `nombre_en_documento`, observaciones y motivo). Una prueba de
  integración lo comprueba (T-34). Recortar `analysis` de la respuesta es un
  pendiente aparte, a decisión de Pedro.
- Quitar EXIF (ubicación incluida) con `sharp` antes de mandar a cualquier
  proveedor; hoy las fotos de verificación se suben y se mandan tal cual.
- **Consentimiento con versión.** `tiene_consentimiento_biometrico` solo
  comprueba que exista una fila; el OCR añade una finalidad (leer CURP y clave)
  y quizá un proveedor. Antes de activarlo: exigir el consentimiento de la
  versión vigente del Aviso (sin cambiar la firma de la RPC) y volver a mostrar
  la casilla a quien consintió una anterior.
- **Aviso, con asesor (Pedro)**: proveedor en §8; CURP en §4.5 (hoy dice que no
  se recaba, y leerla para validarla en memoria también es tratarla); retención
  real en §15 (resueltas < 1 h, pendientes sin tope hoy, indicadores con los
  documentos); revisar a la vez los Términos §7 (comparación facial). Si es
  sustancial, 30 días de preaviso.
- Antes de guardar más datos de identidad se cierran las tareas de seguridad
  abiertas (P5 de la propuesta).

## 7. Pruebas

- **Unitarias (hechas)**: `campos-documento.test.ts` (vectores calculados
  aparte, un carácter cambiado, el caso no detectable de la posición 9),
  `ocr/indicadores.test.ts` (incluida la que falla si un indicador contiene
  cualquier cadena de la lectura, y la que prueba que esa comprobación detecta
  una fuga), `rutas-de-fotos.test.ts` y `scripts/test-veredicto-verificacion.ts`.
  Datos sintéticos de `lib/pruebas/documentos-sinteticos.ts`.
- **Integración sin red (hecha para C3–C5)**: `verificar-documento.test.ts`
  carga la acción real con `cargarReal` y Supabase falso. Para el OCR se añade:
  con `VERIFICACION_OCR` apagado, cero llamadas al lector; encendido, un
  INSERT con indicadores y ningún cambio de estado; lector caído, fila intacta.
- **Staging (fase 5, con OK de Pedro para la migración)**: usuario sintético
  `@staging.vicino.test`, tres PNG sintéticas; casos foto borrosa, foto
  reemplazada a mitad (desfasada), proveedor caído y dos llamadas simultáneas
  (una sola lectura). Patrón de fixtures con limpieza de
  `scripts/staging/probar-verificacion-ia.mjs`; nunca contra producción.
- **Comparativa con muestras**: credenciales del equipo con permiso por escrito
  o especímenes. Muestras y resultados crudos FUERA del repo (es público); al
  repo solo código y métricas agregadas sin valores. Llaves de un proyecto de
  prueba y sin DSN de Sentry.

## 8. Estimación desglosada (MVP: 5 a 6.75 días)

| Parte | Días |
|---|---|
| Lector y validadores | 1–1.5 |
| Integración apagada en `verifyDocument` | 0.5 |
| Tabla, trigger de borrado y tipos | 0.5–1 |
| Bloque del panel (más la revisión de diseño) | 0.5–1 |
| Credencial universitaria | 0.5 |
| Quitar el rechazo automático y blindar Sentry | 0.5–0.75 |
| Prueba de punta a punta en staging | 1 |
| Revisión y build | 0.5 |
| **Total** | **5–6.75** |

Prueba con la INE sola: 1–2 días. Devolución y reenvío: mínima 0.5–1 día
(reutilizar «Rechazar con motivo» y enseñar `reviewer_note` al vendedor, que es
un texto nuevo y pasa por diseño; sigue purgando los documentos) o completa
2.5–4 días (columnas `devuelto_en` y `motivo_devolucion` con status `pending`,
que la purga ya conserva y la cola ya lista, más una RPC espejo del rechazo,
notificación y pantallas; no un valor nuevo en el enum, porque `ALTER TYPE …
ADD VALUE` no tiene vuelta atrás).

## 9. Riesgos

- Un modelo puede leer una CURP plausible que no está en la foto y pasar todas
  las comprobaciones: los indicadores orientan, no deciden.
- El formato de la zona de lectura del INE es un supuesto hasta tener muestras.
- Con todo en revisión humana, una cola atrasada deja documentos sin plazo de
  borrado, y nadie avisa a los revisores cuando entra una solicitud.
- El vendedor puede leer su nota de la IA y ajustar sus fotos hasta pasar; por
  eso los indicadores van en una tabla aparte.
- Las variables de Vercel no surten efecto sin redespliegue.
