# S10 — entrega web del 30-sep-2026

Codex, familia GPT-6. Inicio real: 17:54:49 CDMX. Continuación de
[acta de PostGIS](S10-POSTGIS-2026-09-30.md). Javier autoriza expresamente push
a producción después de las pruebas. `master` despliega automáticamente,
conforme a AGENTS.md; base remota verificada `bd80379`.

## Cambios de entrega

- Activación por defecto centralizada en `isPublicationMapEnabled()` para
  página, API y enlaces. `NEXT_PUBLIC_VICINO_MAP_ENABLED=false` requiere rebuild
  para revertir. `.env.example` documenta la versión activada.
- Se conserva el selector de ubicación del formulario. Únicamente se oculta
  su control de expansión del radio; no se modifican ubicación, círculo,
  contrato de guardado ni datos históricos.
- El SDK real mostró etiquetas de marcadores demasiado largas. Se aplica
  `titleVisibility: Hidden` y descripción accesible, manteniendo números y
  selección por punto. API documentada por Apple:
  https://developer.apple.com/documentation/mapkitjs/markerannotationconstructoroptions/titlevisibility
- `scripts/test-s10-map-http.ts` comprueba la API Next real contra PostgREST
  sin fixtures ni escrituras. No se usa service_role.

## Evidencia previa a entrega

Comandos desde el checkout S10, pnpm fijado en 9.15.0. Configuración existente
reutilizada por un proceso local ignorado; ningún secreto copiado a código.

```text
S10 contracts: 5/5 PASS
S10 SQL: 12/12 PASS (spatial shims; real PostGIS acceptance pending)
S10 API: 7/7 PASS
S10 browser: 25/25 PASS; controlled SDK and transport
```

La anotación de PostGIS en el arnés aislado no sustituye el acta remota: allí
la migración real instalada y los ensayos de volumen ya pasaron.

```text
PASS real catalogue, bounded markers/cards and complete aggregate counts
PASS real cursor covers catalogue without repeating listings
PASS selecting a real group retains area totals and filters its cards
PASS real type/category/price filters and empty result
PASS buyer nearby radius through the real API
PASS invalid and oversized HTTP input refused
PASS page enabled and linked from search
S10 HTTP: 7/7 PASS; 42 eligible catalogue rows; anonymous real HTTP, no dedicated account/device acceptance
```

HTTP real local exit 0. Catálogo total de México; vista inicial de Puebla
mostró 7 publicaciones de 2 vendedores con calles y marcadores de Apple reales.
Captura ignorada `apps/web/test-results/s10/local-real-map.jpg`.

```text
node scripts/smoke-produccion.mjs
OK     home con ubicacion: el feed trae productos
OK     buscar sin acento encuentra el producto acentuado
OK     buscar por ejemplo de categoria
OK     aviso de privacidad publicado y versionado
OK     terminos publicados
OK     canonical apunta al dominio bueno
OK     rankings responde con contenido
OK     los enlaces de vendedor no apuntan a la ruta muerta /tienda/

8 comprobaciones, todas en verde.
```

Smoke previo a entrega exit 0. Build previo al ajuste visual exit 0,
57/57 páginas. Rebuild definitivo del ajuste exit 0, navegador repetido 25/25
exit 0 y smoke del build final local 8/8 exit 0. Apple real verificado también
en viewport 390×844 sin desbordamiento; no equivale a un teléfono físico.
Type-check web exit 0 (sin salida). Lint instalado por ruta
directa exit 0, 0 errores y 4 warnings históricos; módulos de activación y mapa
sin warnings.

Últimas líneas del build final; salida intermedia de rutas omitida:

```text
└ ƒ /vender/[id]/editar

ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

BUILD_EXIT=0
```

## Incidencias y límites

Primer intento de lint vía `pnpm --filter web exec eslint` exit 1:

```text
"eslint" no se reconoce como un comando interno o externo,
programa o archivo por lotes ejecutable.
undefined
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "eslint" not found
```

Se resolvió invocando el binario instalado con Node; no fue un error de código.

La configuración Redis local existente devuelve ENOTFOUND; el limitador
compartido registra fail-open. El freno local está presente y su lógica pasa
en el arnés, pero no se presenta como una cuota global real validada.

Pendientes de aceptación: dos cuentas dedicadas y bloqueos con sesiones HTTP,
cancelación efectiva en PostgREST, iPhone/Android físicos y revisión de Javier.
La entrega para revisión en producción está autorizada. No se cerrarán esos
pendientes con pruebas anónimas, mocks ni capturas de escritorio.

El intento de pulsar un pin desde el controlador del navegador devolvió:

```text
Cannot click content inside a closed shadow root
```

Se verificó la selección por el botón accesible de las tarjetas. El gesto sobre
el pin de Apple queda para aceptación manual, sin eludir el límite del navegador.

## Entrega y reversión

### Desviación requerida por la compuerta de seguridad

Antes del push, `pnpm audit --audit-level=high` devolvió exit 1:

```text
critical Next.js: Remote Code Execution in next/og ImageResponse
Package next; vulnerable >=16.2.0 <16.3.6; patched >=16.3.6
https://github.com/advisories/GHSA-vcvr-r3jv-pc5j
high brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion
Package brace-expansion; vulnerable <1.1.20; patched >=1.1.20
https://github.com/advisories/GHSA-qhr7-859c-m2p7
high brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion
Package brace-expansion; vulnerable <1.1.19; patched >=1.1.19
https://github.com/advisories/GHSA-6j4f-fj2g-mc7p
6 vulnerabilities found
Severity: 3 moderate | 2 high | 1 critical
AUDIT_EXIT=1
```

Arriba se transcriben filas del informe, con tablas/paths intermedios omitidos;
salida completa ignorada en `test-results/s10/final-security-audit.log`.
Los advisories primarios y npm confirmaron los parches. No se afirma que la
aplicación permita explotar esas vulnerabilidades; la dependencia falla el CI.

Diff mínimo requerido para cerrar la compuerta, sin bajar audit-level:

```diff
apps/web/package.json:
- "next": "16.3.5"
+ "next": "16.3.6"
- "eslint-config-next": "16.3.5"
+ "eslint-config-next": "16.3.6"
package.json, pnpm.overrides:
- "brace-expansion": "^1.1.18"
+ "brace-expansion": "^1.1.20"
```

Se resuelve el lockfile con pnpm 9.15.0 y luego se instala congelado. La primera
ejecución lockfile-only terminó en el prompt de recrear módulos y no actualizó
el archivo; se reintentó en CI no interactivo. Auditoría y pruebas se repetirán
sobre la versión parcheada antes de enviar código.

Resolución confirmada: Next/eslint-config-next 16.3.6; brace-expansion 1.1.21
cumple el suelo ^1.1.20. Instalación congelada exit 0. Auditoría repetida:

```text
2 vulnerabilities found
Severity: 2 moderate
AUDIT_EXIT=0
```

Contratos 5/5, SQL aislado 12/12 y API 7/7 repetidos exit 0. Build parcheado
cerrado en el corte 18:31:44 CDMX: exit 0, 57/57 páginas y TypeScript integrado.
Navegador 25/25, HTTP real 7/7 (42 elegibles) y smoke 8/8 repetidos exit 0.
Lint secuencial repetido exit 0, 0 errores/149 warnings. El intento concurrente
anterior devolvió exit 2:

```text
Error: ENOENT: no such file or directory, open 'C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-S10\apps\web\public\sw.js'
```

Se debe a que build regeneraba ese artefacto PWA durante la lectura de lint.
Se repite secuencialmente tras el build; no se desactiva ninguna regla.

Candidato de aplicación: `23a7bcb`. Gitleaks 8.28.0 desde la herramienta local
existente, rango `--no-merges bd80379..HEAD`, exit 0:

```text
6:28PM INF 4 commits scanned.
6:28PM INF scanned ~174434 bytes (174.43 KB) in 756ms
6:28PM INF no leaks found
```

Árbol limpio tras el commit de aplicación; solo esta acta/PROGRESS se actualizan
con el cierre de pruebas antes del push. La entrega y su SHA/CI/URL se registran
en el [DevLog operativo](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).

Lint completo anterior: exit 0, 0 errores/149 warnings de fuente existente y
artefactos PWA generados. El log completo está ignorado; nuevos módulos limpios.

Pendientes en este corte: commit/push sin fuerza y verificación de
CI/despliegue/contenido real. La comprobación visual de la corrección está hecha.
`git push --dry-run origin HEAD:refs/heads/master` exit 0 confirmó autorización
de Git sin enviar cambios. El
resultado operativo se registrará en el DevLog de Notion y en PROGRESS.md.
Si la versión falla, false/rebuild o Instant Rollback de Vercel permite volver;
no es necesario borrar la proyección ni tocar puntos privados.
