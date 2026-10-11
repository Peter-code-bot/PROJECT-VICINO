# UI01–UI12 — onboarding, confirmación de cuenta y fluidez

Fuente: capturas e instrucciones de Javier en esta conversación. Autorizó ejecutar el plan y registrar todo en Notion. La autorización previa de publicación segura a master sigue vigente. Equipo Workflow Advisor: diseño, flujo/QA y contratos de usuario/SQL.

Estado de este corte: implementación, build y validación local completados; Home/registro HTTP con Next y Supabase reales también aprobados. Publicación coordinada todavía en curso. No acredita aceptación Auth real ni Android/iPhone físico. Rama `feat/onboarding-fluidez-20261011`, checkout aislado `PROJECT-VICINO-ONBOARDING`, base `e3900fd66bd3f72bd452e0fd3a393b6699dc145c`. El checkout principal y sus cambios ajenos se conservaron.

Notion es la fuente operativa: [plan único](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), [Tests](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26), [Diseño](https://app.notion.com/p/c8098e8a0cfa83c2b32d01df5ec49663), [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9) y [pendientes nativos por plataforma](https://app.notion.com/p/39998e8a0cfa8158a548cc7a66cbc79c). Este acta conserva evidencia del código; no crea otro backlog.

## Comportamiento implementado

- UI01–UI06: retirados «Publicados hoy», el párrafo introductorio de previews de Solicitudes/Comunidades y los contornos exteriores de Únete/login. Login se titula «VICINO». Tarjetas, foco, entradas y controles mantienen sus componentes.
- UI07: «Quiero comprar» / «Quiero vender», sin Omitir ni selección predeterminada. Comprar conserva el valor interno `explorar`.
- UI08/UI11: eliminado `activar` del recorrido visible; el marcador antiguo llega al cierre. Una pregunta por dato. Comprador tiene ocho pasos base; vendedor casual diez y negocio once. Notificaciones ya resueltas se excluyen del contador.
- El cierre vendedor resume nombre, ID, categoría y zona pública; explica la privacidad de dirección y la pausa de publicaciones al desactivar. «Activar y entrar» confirma la decisión; «Entrar por ahora» termina sin activar. Elegir vender inicialmente sólo guarda intención. Una cuenta ya vendedora no vuelve a activarse. Categoría y nombre del negocio incompletos permiten volver o entrar como comprador.
- UI09: layout/formulario/contexto persistentes, perfil cargado al entrar/reanudar y navegación local de preguntas opcionales. Una cola serial guarda operaciones inmutables con UUID, revisión esperada y pantalla de origen. Respuesta visual, vista utilizable y confirmación de servidor se miden por separado.
- UI10: `/confirmar-cuenta` después de identificar/verificar la cuenta por correo/OAuth y antes de Bienvenida/perfil. Enlaces previos al registro, dos casillas inicialmente desmarcadas, sin Omitir y acción expresa. Cuentas con confirmación vigente no la repiten. Hora, identidad y versiones se comprueban en servidor. Recuperación, callback, documentos, logout y baja conservan acceso.
- UI12: reproducido el rebote anterior al volver desde el cierre con notificaciones concedidas, denegadas o sin plataforma nativa. Ahora Volver llega a ubicación. La entrada directa en notificaciones resueltas guarda una sola transición al cierre.
- ID público: se preservan username editable, índice único, UUID y código interno; sugerencias del alias del correo más números y rechazo atómico del ID ocupado.

Verde/crema, Outfit/Inter, columna centrada horizontalmente con contenido arriba, safe areas y objetivos táctiles de 48 px preservados. No se actualizaron dependencias ni el lockfile en este lote.

## Persistencia y límites del avance

Dato editable, operaciones pendientes y valores confirmados son estados separados. Continuar captura únicamente su campo; Omitir descarta la edición de esa pregunta y no la incluye en un guardado posterior. Los valores confirmados anteriores se conservan.

El journal de la cuenta se persiste antes de avanzar. Hay una sola escritura en vuelo. Un fallo detiene descendientes y permite reintentar/reconciliar. Un timeout de 20 segundos marca resultado incierto: no prueba que la escritura falló y no permite cambiar UUID, payload o decisión final. El reintento usa el recibo idempotente. Una respuesta antigua no sobreescribe un borrador más nuevo ni rebasa un conflicto de otra sesión.

Cada operación valida usuario esperado y generación antes/después de esperas y callbacks. Cambiar de cuenta impide aplicar ACK anteriores y limpia sólo el journal propio. Si storage está bloqueado, el avance espera la confirmación del servidor. Reserva del ID, foto en preparación/subida, cambio de tipo y cierre tienen barreras; el cierre espera toda la cola.

Mapa, foto/recorte y push se cargan cuando corresponden. Prefetch prepara vistas, sin escrituras ni permisos. La solicitud de permisos sigue requiriendo la acción del usuario. No se invalida globalmente ni cambia la cookie de revisión por cada pregunta; el cierre actualiza lo visible fuera del onboarding.

## Contrato SQL y legal

Archivo único: `supabase/migrations/20261011120000_confirmacion_cuenta_y_checkpoint.sql`. El runner es dueño de BEGIN/COMMIT y del ledger. Cambios aditivos:

- Señales expresas sobre `legal_acceptances`, conservando modo/fecha/historial anterior; no se convierte `uso_continuado` en aprobación retroactiva.
- `onboarding_revision`, evidencia de decisión de visibilidad y recibos privados por usuario/operación. RLS activado y acceso directo a recibos revocado para PUBLIC/anon/authenticated.
- RPC de estado/confirmación legal, checkpoint v3 y finalización v3. Autenticación, campos permitidos por pantalla, versión esperada y recibo se verifican bajo bloqueo de fila.
- La finalización integra decisión, activación, cierre del onboarding, limpieza del marcador y recibo en una transacción. La prueba de error al escribir el recibo demuestra rollback de la activación.
- Los caminos legacy y la conversión posterior a vendedor también exigen la señal vigente. La escritura automática de aceptación desaparece; el RPC anterior queda como no-op compatible.
- El middleware elimina la cabecera de confirmación aportada por cliente y sólo propaga una señal ligada al UID comprobado; el layout tiene comprobación de respaldo.
- Sólo mensajes SQL concretos de validación se exponen mediante allowlist de código+texto. Errores arbitrarios de permisos/SQL devuelven un mensaje genérico y se reportan a Sentry.

Términos 1.1 y Aviso 2.2 se mantienen; no cambió el contenido legal versionado. La propuesta y fuentes oficiales comparadas viven en el plan de Notion. La posición de esta pantalla es una decisión de producto, no una afirmación de que todas las apps usan el mismo formulario.

## Validación local y alcance

| Comprobación | Resultado | Alcance |
|---|---:|---|
| UI onboarding | 117/117, exit 0 | Componentes reales; Auth/acciones/router simulados |
| Vendedor | 17/17, exit 0 | Cierre, errores, doble toque, datos omitidos, cuenta activa |
| Confirmación legal UI | 12/12, exit 0 | Casillas, versiones, enlaces, retry/timeout/cuenta cambiada |
| SQL checkpoints | 14 comprobaciones, exit 0 | PGlite aislado, RLS/ACL/contratos y rollback |
| Acciones/helpers legales/checkpoint | 18/18, exit 0 | Identidad, validación y errores públicos acotados |
| Journal/borrador | 18/18, exit 0 | Orden, idempotencia, conflicto y cuenta |
| Username | 20 comprobaciones, exit 0 | PGlite aislado, unicidad y compatibilidad |
| Flujo | 10/10, exit 0 | Rutas, pasos, aliases y regresiones |
| Auth/perfil/SW relacionadas | 33/33, exit 0 | Regresión local previa al ajuste de allowlist; después, 18/18 focalizadas |
| Previews SSR | 25/25, exit 0 | Componentes con datos de prueba |
| Home HTTP Chromium | 18/18, exit 0 | Next/Supabase reales, invitado, sólo lectura |
| Registro HTTP Chromium | 20/20 + recorridos browser, exit 0 | Next/Supabase reales; sin Auth/OTP |
| Capturas finales Inter/Outfit | 6/6, exit 0 | Usuario/nombre/descripción, claro/oscuro |
| Benchmark | 300/300, exit 0 | Tres escenarios locales de 100 muestras; ACK controlado |
| TypeScript y lint focalizado final | exit 0, sin salida | Posteriores a allowlist/as const |
| Lint web completo | exit 0; 0 errores, 148 avisos | Incluye avisos previos y PWA generado |
| Build final | exit 0, 60/60 páginas | Next 16.3.8; variables locales sólo en memoria |
| Prechecks | exit 0 | check-no-todo, check-rate-env y check-rutas: 77 rutas |

No se crearon cuentas, enviaron OTP/correos ni aprobaron documentos reales durante estas suites. No sustituyen recorrido OAuth/correo autenticado, concurrencia real, cold start completo ni teléfonos físicos.

### Recibos literales principales

```text
node scripts/test-onboarding-ui.mjs
{
  "scope": "simulated local component UI; not auth/RLS/native-device validation",
  "fontSource": "system-fallback",
  "cases": 117,
  "passed": 117,
  "failed": 0,
  "failures": [],
  "out": "C:\\Users\\Hp User\\Documents\\Javier\\proyectos\\VICINO\\PROJECT-VICINO-ONBOARDING\\apps\\web\\test-results\\onboarding"
}
Exit code: 0

node node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs scripts/test-onboarding-vendedor.ts
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 71800.5333
Exit code: 0

node scripts/test-onboarding-ui.mjs canonical-captures
{
  "scope": "simulated local component UI; not auth/RLS/native-device validation",
  "fontSource": "next-build-inter-outfit",
  "cases": 6,
  "passed": 6,
  "failed": 0,
  "failures": [],
  "out": "C:\\Users\\Hp User\\Documents\\Javier\\proyectos\\VICINO\\PROJECT-VICINO-ONBOARDING\\apps\\web\\test-results\\onboarding"
}
Exit code: 0

node node_modules/tsx/dist/cli.mjs scripts/test-onboarding-checkpoint.ts
14 SQL checks passed (isolated PGlite).
Exit code: 0

node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
Sin salida.
Exit code: 0
```

Build final, cwd `apps/web`; el env existente del checkout principal sólo se carga en memoria y `process.execArgv=[]` evita propagar --env-file a los workers. Comando exacto:

```powershell
node --env-file='C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO\apps\web\.env.local' --input-type=module -e 'process.execArgv=[]; process.argv=[process.execPath,"./node_modules/next/dist/bin/next","build","--webpack"]; await import("./node_modules/next/dist/bin/next");'
```

Últimas líneas literales; salida anterior de rutas truncada:

```text
├ ƒ /seller/reviews
├ ƒ /seller/ventas
├ ƒ /seller/verificacion
├ ƒ /settings
├ ƒ /solicitudes/[id]
├ ƒ /terminos
├ ƒ /vendedor/[id]
├ ƒ /vender
└ ƒ /vender/[id]/editar

ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
Exit code: 0
```

Home y registro finales con el build actual; cwd repo, variables sólo en memoria y flags de correo/OTP eliminados:

```powershell
node --env-file='C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO\apps\web\.env.local' --import tsx --input-type=module -e 'process.env.HOME_GUEST_BASE_URL="http://127.0.0.1:4182"; process.env.TEST_BROWSER="chromium"; delete process.env.REGISTRO_TEST_EMAIL; delete process.env.REGISTRO_TEST_RECOVERY; delete process.env.REGISTRO_EXPECT_UNAVAILABLE; await import("./scripts/test-home-guest-http.ts");'
```

Últimas líneas literales; comprobaciones anteriores truncadas:

```text
PASS real request -> login -> original preview/scroll 170px stable
PASS primary tabs and public discovery navigate without login
PASS discovery/wall selection and immediate login destination stay in sync without reload
PASS private community actions -> login, logo returns discovery; zero Auth/action POST
RESULT chromium: 18/18 PASS; Next/Supabase real read-only; device/Auth completion pending
Exit code: 0
```

```powershell
node --env-file='C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO\apps\web\.env.local' --import tsx --input-type=module -e 'process.env.REGISTRO_BASE_URL="http://127.0.0.1:4182"; process.env.TEST_BROWSER="chromium"; delete process.env.REGISTRO_TEST_EMAIL; delete process.env.REGISTRO_TEST_RECOVERY; delete process.env.REGISTRO_EXPECT_UNAVAILABLE; await import("./scripts/test-registro-http.ts");'
```

Salida literal completa:

```text
PASA HTTP 20/20: Next real, sin sesión; rutas, legales y API privadas.
PASA CTA Home real: SSR invitado, ubicación entre mapa/categorías, 48px, contraste texto/foco claro/oscuro y hover, registro/login y regreso.
PASA navegador Next real chromium: Home → Buscar → login, destino conservado.
PASA Home real: producto → login → Home restaura scroll 600px.
PASA hidratación chromium: campos iniciales protegidos y nombre conservado al habilitarse; sin enviar registro.
Exit code: 0
```

### Medición controlada antes/después

Escenarios calientes de preguntas opcionales. Baseline del código anterior conservada, SHA256 `48AFBD442418059A7329A75B2750651DA549638A3D3FAFB6A32D14FE1FC39EF2` antes/después. Fixture final usa Inter/Outfit del build; la baseline usaba fallback de sistema. No es un benchmark de red Next/Auth completa, cuentas reales o hardware móvil.

| Escenario (100 muestras cada uno) | p95 siguiente usable anterior | p95 actual | p95 ACK actual |
|---|---:|---:|---:|
| ACK 50 ms | 82,6 ms | 16,0 ms | 65,3 ms |
| ACK 600 ms | 632,7 ms | 16,1 ms | 614,2 ms |
| CPU ×4, ACK 50 ms | 82,5 ms | 22,4 ms | 69,0 ms |

La vista opcional aparece antes del ACK; el guardado sigue pendiente hasta confirmación. En baseline Volver rebotó al cierre en los tres permisos; el candidato quedó en ubicación.

Salida completa literal:

```text
node scripts/test-onboarding-performance.mjs http://127.0.0.1:4183 candidate
{"label":"candidate","name":"warm-optional-ack50","ackDelay":50,"cpu":1,"count":100,"feedback":{"p50":13.5,"p95":16},"nextUsable":{"p50":13.599999994039536,"p95":16},"ack":{"p50":61.900000005960464,"p95":65.29999999701977}}
{"label":"candidate","name":"warm-optional-ack600","ackDelay":600,"cpu":1,"count":100,"feedback":{"p50":14.700000002980232,"p95":16.100000008940697},"nextUsable":{"p50":14.799999997019768,"p95":16.100000008940697},"ack":{"p50":604.7999999970198,"p95":614.2000000029802}}
{"label":"candidate","name":"warm-optional-cpu4-ack50","ackDelay":50,"cpu":4,"count":100,"feedback":{"p50":15,"p95":18},"nextUsable":{"p50":15.200000002980232,"p95":22.400000005960464},"ack":{"p50":65.09999999403954,"p95":69}}
{"label":"candidate","scenario":"final-back-granted","route":"/completar-perfil/ubicacion"}
{"label":"candidate","scenario":"final-back-denied","route":"/completar-perfil/ubicacion"}
{"label":"candidate","scenario":"final-back-no-nativo","route":"/completar-perfil/ubicacion"}
Exit code: 0
```

### Fallos encontrados y correcciones

- Shims pnpm/tsx y spawn EPERM del sandbox: se usaron entrypoints Node directos; procesos browser/build autorizados fuera del sandbox. No se cambió packageManager/dependencias.
- Invocación Next con --env-file propagada a workers falló con `--env-file= is not allowed in NODE_OPTIONS`; corregido con bootstrap en memoria y execArgv vacío.
- Arnés dinámico inicialmente generó React error 306 por resolver funciones como módulos; se corrigió el mock. Se corrigieron fixtures de reload, frontera /login y expectativas de recuperación final; se conservaron las aserciones de seguridad y persistencia.
- La allowlist inicial filtraba por código genérico; se restringió a código+mensaje concretos para impedir que se expongan errores SQL arbitrarios. La suite vendedor descubrió el mensaje de visibilidad perdido, que se añadió como par exacto. TypeScript exigió tuplas `as const`; desviación de implementación acotada, sin cambio de comportamiento.
- Home/HTTP: después de quitar la introducción, el contenido real cabe en 390×844 y una prueba de scroll no podía generar desplazamiento. Sólo ese caso usa 390×540 y luego restaura el viewport. Un clic real ya hidratado en Descubrir emitió RSC y terminó en ≈5266 ms; la espera de 5 s daba falso fallo. Se usa un plazo de 30 s sin rebajar destino/aria/datos/retorno. Upstash ENOTFOUND/fail-open en el entorno local influye en esas consultas; no se acredita ese diagnóstico para producción.
- El PAT de Management API no permitió preflight (`HTTP 401: Invalid access token`). Se retomó la sesión existente del dashboard de Supabase para comprobaciones del esquema; no se imprimieron tokens ni se redujeron controles.

## Publicación coordinada — pendiente en este corte

Preflight de sólo lectura en VICINO/main: baseline `20261010120000` presente una vez, candidata `20261011120000` ausente, siete columnas nuevas ausentes y documentos vigentes Aviso 2.2/Términos 1.1. Firmas legacy guardar_paso/v2, complete_user_onboarding, activar_modo_vendedor y update_profile_and_pause_products coinciden con lo esperado.

La migración conserva datos y firmas, pero cambia el requisito legal de los RPC. La app anterior e390 no tiene la nueva confirmación: no se debe aplicar el SQL y dejar esa app sirviendo indefinidamente. Preparar candidato/preview y comprobaciones, ensayar el archivo exacto con ROLLBACK, aplicar sólo ese archivo+ledger en una transacción y publicar la web en el mismo corte. Regenerar tipos exactos desde producción, incluidos helpers internos/recibos, sin desactivar la comprobación de esquema de CI.

Recuperación: preservar columnas, historia, recibos y ledger; corregir hacia adelante con el gate mínimo. Volver únicamente a e390 tras aplicar el nuevo requisito legal no recupera el flujo. No borrar evidencia ni fingir aceptación automática. Una reversión de contrato necesita una migración compensatoria revisada y registrada.

Commit/PR, hashes SQL, ensayo remoto, ledger, CI, master, Vercel Production y smoke se anotarán aquí cuando sean verificables. No se afirma que este corte ya esté publicado.

## Aceptación pendiente

Auth real por correo/Google/Apple, versiones nuevas, dos sesiones/ID concurrente y medición de onboarding con red real requieren cuentas autorizadas y evidencia propia. Todo build/integración/prueba instalada/distribución nativo se registra sólo en Android/iOS de Bugs: NAT-AND-01/02/08 y NAT-IOS-01/02/07. No se cierran por resultados de Chromium.

Las pausas por límites de uso no se cuentan como trabajo activo; hubo reanudaciones el 11-oct aproximadamente a las 09:07 y 14:20 America/Mexico_City. No se inventa una duración acumulada.
