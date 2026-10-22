## 22-oct-2026 — PUB-FICHA-02: ficha tras guardar y preview de ubicación

- Inicio: **10:34:17 America/Mexico_City** (16:34:17 UTC). Fuente: prueba de Javier del despliegue a6a4f9d6 y petición de recuperar ficha → Regresar → Mi perfil. Sustituye el retorno directo al perfil de alta/edición de PUB-PERFIL-01; eliminación y ocultar conservan el comportamiento aprobado.
- Alta y edición abren la ficha con `?from=publication`, reemplazando el formulario completado. El regreso de esa ficha para el propietario abre `/perfil?tab=products`; consultas normales/visitantes conservan historial. Se usa el slug devuelto por el guardado y la categoría elegida. Revalidación de perfil/Inicio/listado conservada; la revisión de sesión purga los datos recordados.
- Recuperado en Notion el acuerdo GEO-PRECISION-01 del21-oct: título **Ubicación**, búsqueda «Busca una ubicación…», preview general de Puebla/Cholula sin pin/círculo/punto azul ni selección automática. Tocar/buscar selecciona; quitar deja mapa abierto sin punto y cancela respuestas pendientes. Editar conserva el punto guardado. El switch de precisión/migración siguen pendientes en su plan; esta entrega no cambia exposición de datos.
- Comprobación local: **56/56** recorridos Chromium/WebKit a375/1280px; **24/24** mapa/perfil y **2/2** recuperación del preview (Chrome móvil/escritorio); **24/24** acciones, **20/20** opcionalidad, **20/20** retorno del formulario y18casos de esquema. Tipos/lint/build exit0 (lint52avisos existentes/0errores); build63/63, BUILD_ID `PZZUe4Cy9RJ47Iqa2Umnx`, configuración sintética.
- Incidencias corregidas en los bancos: recarga perdía estado simulado; ruta del SDK de pruebas y variable pública del fixture sin inyectar. Resultado final verde; no se atribuyen a producción. Pruebas con Auth/DB/router/SDK Apple controlados, sin escribir productos reales; aceptación instalada sigue pendiente.
- **Fin local: 10:52:04 America/Mexico_City** (16:52:04 UTC). Entrega a master y producción en curso. Evidencia literal y cierre real en la [Bitácora](https://app.notion.com/p/14a98e8a0cfa83eb9ef00133a04ec7fd), [plan PUB-FICHA-02](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263) y [Tests](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26). Workflow Advisor automático aplicado; trabajo secuencial sin auxiliares. Checkout principal preservado.

## 22-oct-2026 — PUB-PERFIL-01

- Inicio: **09:11:02 America/Mexico_City** (15:11:02 UTC). Javier autorizó ejecutar el plan y registrar inicio, término, cambios, pruebas e incidencias. Workflow Advisor aplicado; ejecución directa sin auxiliares.
- Publicar, guardar una edición y eliminar desde ficha o Mi tienda vuelven a `/perfil?tab=products` con reemplazo de historial y revalidación de perfil, Inicio y listado. La cuadrícula prevalece sobre Reseñas recordada; las pestañas siguen siendo seleccionables y el perfil público conserva su comportamiento.
- Ocultar mantiene abierta la misma ficha y URL; actualiza estado, permite mostrar y bloquea pulsaciones pendientes. Eliminación con diálogo compartido, cancelación, error recuperable, foco y bloqueo de doble envío; el servidor valida propietario y fila afectada antes del retorno exitoso.
- Corregido el reinicio del borrador al fallar el envío del formulario, conservando cabecera fija, navegación, validación y estados pendientes actuales. Fallo inicial reproducido: 32/36 recorridos; evidencia anterior conservada. Matriz ampliada y repetida sobre master actualizado: **48/48** en Chromium/WebKit, 375/1280 px; **22/22** acciones, **20/20** Regresar y **4/4** pestañas/ordenación. Auth/DB/router controlados; no acredita aceptación autenticada ni física. Tipos y lint focalizado: exit 0.
- Candidato aislado basado en `origin/master` **3ccbbdec**, rama `fix/publicacion-perfil-20261022`. Checkout original, 195 commits por detrás, restaurado a sus cambios previos; la fase inicial y su build pertenecen a esa base antigua. Dependencias existentes reutilizadas; sin modificación de lockfile, migraciones ni datos de producción.
- **Fin de implementación y validación local: 09:42:34 America/Mexico_City** (15:42:34 UTC). Build del candidato **exit 0**, 63/63 páginas estáticas, BUILD_ID `SV4w6a7Ry1s7QiFnnM_Pc`; configuración sintética. Registro completo y evidencia literal en la [Bitácora de Notion](https://app.notion.com/p/14a98e8a0cfa83eb9ef00133a04ec7fd); [plan PUB-PERFIL-01](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263). Integración remota, publicación y aceptación en Android/iPhone siguen pendientes.

## 21-oct-2026 — PUB-OPT-01

- Descripción y estado opcionales en alta/edición; vaciar limpia y omitir conserva. Fichas móvil/escritorio sin wrapper de descripción ni celda de estado ausente, con columnas según los datos presentes. Workflow Advisor queda disponible y exigido por instrucciones del proyecto, con modelo/esfuerzo explícitos cuando convenga delegar.
- Esquema18/18, acciones20/20 y navegador86/86 (Chromium/WebKit, CSS real, transporte/Auth/DB controlados). Se detectó y corrigió solapamiento en la fila al200%; refluye y envuelve textos largos. Tipos y lint exit0; web194 aprobadas/1 omitida por openssl ausente. Evidencia literal, revisión, compilación, PR/CI/SHA y estado real de entrega en la [Bitácora de Notion](https://app.notion.com/p/14a98e8a0cfa83eb9ef00133a04ec7fd), PUB-OPT-01.
- Supabase PROD revisado por navegador integrado: descripcion TEXT NOT NULL admite vacío, estado nullable con CHECK explícito para NULL; RLS activo y triggers compatibles, sin migración ni datos alterados. La auditoría usa cliente oficial pnpm11 sólo para audit: endpoint pnpm9 retirado, misma excepción GHSA existente, lockfile/dependencias intactos; auditoría local exit0 y frozen install9 exit0. Firma Wallet antes omitida completada3/3 con certificados de prueba. [Plan, entrega y aceptación física iPhone pendiente](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263). GEO-PRECISION-01 continúa separado.

## 20-oct-2026 — ONB-ID-02

- Revisión funcional del ID tras el reporte de Javier: límites y reglas contrastados en Supabase por navegador; motivos de bloqueo junto a Continuar y pruebas ampliadas. Plan, evidencia, publicación y aceptación real en [Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263).

## 20-oct-2026 — ONB-ID-01

- Validación del ID y Workflow Advisor añadidos al proyecto. Plan, procedimiento, pruebas, estado de publicación y aceptación en app instalada en [Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263).

## 16-oct-2026 — MCS-F02: selección de zonas y marcadores acotados

- Distingue publicación única (punto) y grupos (número, 99+ sólo visual). La lista de zonas es opcional; selección conserva consulta/centro/revisión y Ver área encuadra únicamente celdas públicas aproximadas, sin nueva precisión ni SQL.
- La sustitución de capas de 300 marcadores respeta también el límite simultáneo de 300, conservando instancias y listeners compartidos. Se mantiene la caché existente, sin volver a consultar el catálogo por cada gesto dentro de cobertura.
- Workflow Advisor: QA independiente gpt-6.1-sol/medium y revisión gpt-6.1-sol/high. Se corrigió pérdida de foco al refinar grupos y se verificó texto al 200% en 320px. Marcadores14/14, componente28/28, mapa79/79, agrupación/encuadre7/7 y caché17/17:145/145, todos sintéticos; lint final exit0. Evidencia literal, build y estado real de publicación en la [Bitácora de Notion](https://app.notion.com/p/14a98e8a0cfa83eb9ef00133a04ec7fd), MCS-F02. MapKit/dispositivos reales pendientes.

## 16-oct-2026 — VENTA-CLARO-01: confirmación de venta acorde al tema

- Barra y tarjeta heredan el tema de la app: superficies blancas/arena, texto carbón, acentos verdes y estados suaves con icono/texto. Outfit en títulos/producto/precio e Inter en datos/controles; etiquetas de 12 px y acciones de al menos 48 px. Se conservan acciones, precio, reglas y sincronización del chat.
- Workflow Advisor aplicado al plan; implementación directa en rama aislada, integrada con master 961adc2. Matriz de componentes/CSS/hook reales: 96/96 en Chromium y WebKit, ambos temas, cinco anchos, 200% de texto, acordeón y confirmación/rechazo con rollback. Contraste mínimo activo medido 5.37:1. Regresión de chat tras integrar PR69: 46/46; selector/propuestas: 18/18. Transporte y acciones controlados, sin ventas remotas.
- [Plan, paleta por elemento y captura de implementación](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263). Evidencia literal, compilación, PR/SHA y estado real de publicación en la [Bitácora](https://app.notion.com/p/14a98e8a0cfa83eb9ef00133a04ec7fd), VENTA-CLARO-01. La aceptación con cuentas/dispositivos reales sigue abierta; verificar grosor de Outfit/Inter en Safari/iPhone, ya que WebKit Windows mostró diferencias frente a Chromium.

## 15-oct-2026 — MCS-CHAT-02: mensajes independientes de ventas y Realtime

- Publicado mediante PR69/master961adc2; CI PR/master y Production7111221017 SUCCESS. Dominio público, 41 assets y marcador SHA verificados el16-oct, exit0. Aceptación física pendiente.

- Nuevas capturas de Javier muestran recuperación seguida de sincronización pendiente en iPhone; no identifican build ni causa del teléfono. Se reprodujeron dos bloqueos del cliente: esperar SUBSCRIBED antes de leer por HTTP y descartar mensajes recuperados cuando falla ventas.
- HTTP se reconcilia por montaje/chat/usuario; ventas tiene lectura y reintento propios. La lectura inicial es silenciosa, la conexión en vivo pendiente tiene aviso independiente y HTTP sano no cancela los reintentos acotados del transporte.
- Una denegación bloquea respuestas tardías de mensajes/ventas/historial y eventos WS; el compositor se deshabilita. Se preservan tarjetas conocidas si falla su actualización y no se habilita una nueva confirmación hasta recuperar ese estado.
- Workflow Advisor: diagnóstico/revisión independiente gpt-6.1-sol/high y QA de componente gpt-6.1-sol/medium. Regresiones locales con transporte sintético: 46/46 de componente en dos viewports y 20/20 de lógica; integración conserva disponibilidad de catálogo y margen seguro Android de PR68. Tipos web exit0, lint focalizado exit0 con un aviso previo de imagen. Evidencia literal, revisión, build, SHA/PR y estado de publicación en la [Bitácora de Notion](https://app.notion.com/p/14a98e8a0cfa83eb9ef00133a04ec7fd), MCS-CHAT-02.
- Sin cambios de SQL, medios, push ni diseño de confirmación de venta. Aceptación instalada, Realtime/Auth remotos y F02–F07 permanecen abiertos en el [plan](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263) y [Tests pendientes](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26).

## 15-oct-2026 — MCS: primer checkpoint de chat y privacidad

- F01 separa reconciliación rutinaria y recuperación visible: enviar, cambiar producto y crear una propuesta sana ya no muestran «Recuperando conversación…». Se conservan avisos/reintentos ante desconexión, fallo o intervalo incompleto. Chrome con transporte sintético: 28/28; recuperación: 4/4.
- S03 evita publicar pares de coordenadas como etiqueta de ubicación. El selector muestra «Zona seleccionada en el mapa» mientras resuelve la dirección; creación/edición validan el texto sin alterar el punto privado ni la proyección pública del mapa. Pruebas: 3/3, selector en dos viewports y regresión geo 18/18.
- F00 versiona la protección auth.uid del recibo de lectura que ya existe en PROD y añade guard de UPDATE de estado personal del chat; conserva efectos internos y S04. PostgreSQL/PGlite: 29/29. Ensayo en Supabase staging por navegador con un único BEGIN/ROLLBACK: PASS; catálogo posterior confirmó guard/fixture ausentes, triggers INVOKER restaurados y migraciones intactas. Posteriormente se aplicó y registró la migración20261015164501 en VICINO PROD por navegador; catálogo y siete comprobaciones aisladas PASS, con rollback de los datos TEMP de la prueba. Recibo vigente en Bitácora de Notion.
- Workflow Advisor: tres implementadores gpt-6.1-sol/high por áreas y un revisor independiente gpt-6.1-sol/high, sin bloqueos. Tipos web/shared, lint focalizado, diff y build web: exit0; dos avisos previos de lint conservados. Evidencia literal, rama/PR/SHA y estado real de entrega en la [Bitácora de Notion](https://app.notion.com/p/14a98e8a0cfa83eb9ef00133a04ec7fd), MCS-20261015.
- Continúan abiertos INSERT directo de chats, limpieza de chat-media, rotación histórica de secretos, cuentas/dispositivos/Realtime/push reales y fases F02–F07. Confirmación de venta permanece como propuestas. [Plan por fases](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263) y [aceptación pendiente](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26).

## 15-oct-2026 — Cambio de cuenta sin aviso verde inferior

- CUENTAS-UX-03: retirar el toast de éxito «Ahora estás en…» al cambiar desde Cuentas y al pasar a la siguiente guardada tras cerrar la activa. Perfil, navegación y errores conservados; no se desactiva Sonner globalmente ni el aviso de quitar una cuenta.
- Plan, verificación, SHA/PR/CI y publicación real en la [Bitácora de Notion](https://app.notion.com/p/14a98e8a0cfa83eb9ef00133a04ec7fd), CUENTAS-UX-03. Aceptación instalada/Auth real permanece en el seguimiento de cuentas existente.

## 15-oct-2026 — Cuentas: selector sin acciones de salida accidental

- CUENTAS-UX-02 autorizado por Javier hasta master. Selector dedicado a cambiar/agregar; Quitar se traslada a Cuentas guardadas en Configuración y Salir de todas queda allí con confirmación independiente. Se conserva revocación local de dormidas y cierre global histórico de la activa, explicado antes de confirmar.
- Límite5 y activaSinSitio dirigen a gestión, sin expulsión automática. Confirmaciones con Cancelar inicial, Escape antes de confirmar, bloqueo durante la operación y foco restaurado incluso tras fallo parcial. Puente iOS y portal compatible sin cambios.
- Workflow Advisor: implementación/QA por coordinador y revisión independiente gpt-6.1-sol/medium. Pruebas, límites, SHA/PR/CI y estado real de publicación en la [Bitácora de Notion](https://app.notion.com/p/14a98e8a0cfa83eb9ef00133a04ec7fd), CUENTAS-UX-02. Auth real/OAuth/push y aceptación instalada conservan seguimiento en [Bugs y Tareas Pendientes](https://app.notion.com/p/39998e8a0cfa8158a548cc7a66cbc79c).

## 14-oct-2026 — Selector de cuentas compatible con el menú nativo de iOS

- CUENTAS-IOS-01: fallo reproducido con el JS exacto de CromoNativo.swift y componentes reales. El puente instalado buscaba el primer enlace /perfil, pero la nueva fila era un botón: recibía perfil vacío y no abría Cuentas. Regresión inicial 0/4 en Chromium/WebKit; la lógica aislada existente sí pasaba 56/56.
- Se conserva el enlace /perfil como disparador del selector; Cuentas tiene portal independiente del drawer que iOS oculta. Al elegir desde la hoja nativa se retira el drawer invisible; en web se conservan cierre por capas y foco. Mi perfil usa /perfil?origen=menu para distinguir ambos destinos en el puente legado.
- Workflow Advisor aplicado; revisión independiente gpt-6.1-sol/medium detectó la colisión Mi perfil, reproducida 0/2 y corregida. Matriz final local 40/40 con SDK real y HTTP/framework controlados; 56/56 unitarias. No acredita UIKit, OAuth, push físico ni Auth de producción; no hay credenciales E2E de prueba configuradas. El icono de Mi perfil usa el círculo genérico del binario iOS antiguo hasta actualizar su mapa de símbolos.
- Evidencia, compilación final, PR/SHA y estado de entrega en la [Bitácora de Notion](https://app.notion.com/p/14a98e8a0cfa83eb9ef00133a04ec7fd). Aceptación con cuentas reales/Android/iPhone y riesgos T-33/T-35 permanecen abiertos en [Bugs y Tareas Pendientes](https://app.notion.com/p/39998e8a0cfa8158a548cc7a66cbc79c).

## 14-oct-2026 — Publicar: Regresar y Publicar visibles durante el formulario

- PUB-HDR-20261014 solicitado por Javier con captura. Workflow Advisor aplicado; plan y tiempos de inicio/reanudación en el [plan de Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263). Rama fix/publicar-cabecera-fija-20261014 sobre ef3c295.
- Cabecera de ProductForm fija bajo la barra global y safe-area en móvil, arriba en escritorio; fondo sólido, título flexible, Publicar48px y errores accesibles en la zona fija. El primer campo inválido se centra tras la validación nativa para mantenerlo visible en WebKit. Crear/editar comparten el ajuste y conservan validación, guardado y retorno.
- Evidencia, revisión, checks y SHA/PR/estado de publicación en la [Bitácora de Notion](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9). Aceptación instalada y teclado/safe-area físicos continúa en SC-AND-01/SC-IOS-01 de [Bugs y Tareas Pendientes](https://app.notion.com/p/39998e8a0cfa8158a548cc7a66cbc79c).

## 14-oct-2026 — Fluidez de ubicación y Solicitudes

- LU01 y FL01–FL04 implementados por autorización de Javier de ejecutar el plan y hacer push tras verificar. Palomita blanca sin texto; GPS aplica el punto antes de resolver el nombre, con enriquecimiento sin repetir la consulta del feed. Búsqueda distingue demora, error recuperable y ausencia de resultados.
- Solicitudes carga filas visibles y prepara las cercanas, con catálogo/páginas y retorno al scroll conservados por usuario/zona/radio/revisión. La línea base de ocho categorías pasa de diez a tres consultas iniciales en viewport habitual; las pantallas altas cargan las filas que ya muestran.
- [Plan, medición y criterios de aceptación](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263). Pruebas, revisión, SHA/PR y estado de publicación en la [Bitácora de Notion](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9). La validación física de GPS/MapKit conserva el seguimiento existente; las suites locales usan transportes controlados.

## 14-oct-2026 — Chip de categoría activo oscuro con blanco

- Inicio 08:58:34 CDMX por petición y captura de Javier. FiltroCategoriasDrawer reutiliza product-card-tab: fondo charcoal y texto/iconos blancos en claro, con la adaptación al tema oscuro vigente en las etiquetas. Icono y X heredan el color del chip; hover acorde al fondo. Rol FilterChip revisado con Button Expert.
- Tipos/lint, CI/build remoto y publicación de CHIP-CAT-20261014, con sus SHA/PR y horas de cierre, en la [Bitácora de Notion](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9). Aceptación visual conserva el seguimiento de QA01.

## 14-oct-2026 — Frases introductorias de Solicitudes y Comunidades

- Inicio 07:44:27 CDMX por petición de Javier. «Publica lo que necesitas y recibe ofertas de personas cercanas.» encima del filtro de Solicitudes; «Conecta con tus vecinos y comparte intereses en comunidad.» encima de Muro/Mis comunidades/Descubrir, también en las vistas de invitado. Texto pequeño con tokens y márgenes existentes; guía UX Copy aplicada.
- Verificación y publicación de COPY-SC-20261014 en la [Bitácora de Notion](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9); ampliación del [plan](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263). Los pendientes de aceptación autenticada y física de la entrega anterior conservan su seguimiento en Notion.

## 14-oct-2026 — Solicitudes, comunidades, ubicación y legales: integración técnica

- Inicio de implementación autorizado por Javier: 13-oct 23:31:05 CDMX; reanudación 14-oct 01:00:17. Workflow Advisor aplicado; base d00e567, rama feat/solicitudes-comunidades-ubicacion-20261013. [Plan único](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263).
- Tarjetas por categoría en Solicitudes y Mis comunidades/Descubrir; categoría obligatoria antes de descripción y foto opcional con inicial. Ubicación automática, Listo idempotente, cierre por deslizamiento y ventana estable durante refresh. Pie legal compartido en login/registro con enlaces independientes; conserva la confirmación explícita vigente.
- Migraciones 20261014054500 y 20261014054632 aplicadas y registradas mediante el navegador de Supabase VICINO main. Catálogo33 opciones; backfill acotado a las seis comunidades de prueba; bucket privado; alta de solicitudes atómica y paginación por fecha/ID. Los RPC legados siguen disponibles.
- Verificación local: build exit0 (60/60 páginas); lint0 errores/144avisos; previews26/26; comunidades SQL13/13, contratos8/8, UI18/18; solicitudes SQL11/11, comportamiento7/7, acción6/6, Chromium16/16 y WebKit16/16; ubicación34/34,60/60,4/4,22/22 y Home2/2. Fronteras Auth/GPS/SDK/transportes controladas en suites; PostGIS remoto comprobado con migraciones reversibles antes de aplicar.
- [PR59](https://github.com/Peter-code-bot/PROJECT-VICINO/pull/59); tipos oficiales descargados del workflow Production database types (38531151244) e incorporados con protección de la columna de mapa. SHA y resultado vigente de CI/publicación en la [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9). Aceptación autenticada y física Android/iOS pendiente en [Bugs y Tareas Pendientes](https://app.notion.com/p/39998e8a0cfa8158a548cc7a66cbc79c), SC-AND-01/SC-IOS-01.

## 13-oct-2026 — Solicitudes, comunidades y ubicación: planificación preparada

- Workflow Advisor aplicado al plan solicitado por Javier. Inicio 23:09:59 y fin de elaboración/revisión 23:22:16 CDMX; [plan único en Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), bloque PLAN-20261013-SOLICITUDES-COMUNIDADES.
- Tarjetas por categoría en Solicitudes y Mis comunidades/Descubrir, categoría obligatoria y foto de grupo opcional al fundar; selección automática de ubicación, palomita y cierre por deslizamiento. Muro conservado. Catálogo de comunidades por confirmar.
- Ampliación AL01: bloque compacto de enlaces a Términos y Condiciones/Aviso de Privacidad bajo opciones de login/registro, referencia CapCut adaptada a VICINO; conservar confirmación explícita existente. Planificación añadida; implementación pendiente en Notion.
- Implementación, clasificación de fixtures y QA pendientes en [Bugs y Tareas Pendientes](https://app.notion.com/p/39998e8a0cfa8158a548cc7a66cbc79c), con SC-AND-01/SC-IOS-01 en sus apartados nativos. [Bitácora de inicio/cierre](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).
- Sólo inspección y planificación; sin cambios de aplicación/SQL/datos ni pruebas/build del producto, commit, push o despliegue.

## 13-oct-2026 — ONB-SKIP-01: Omitir en todos los pasos opcionales

- Nueva revisión pedida por Javier: Omitir también en listo de comprador/vendedor y label uniforme en el alta posterior de vendedor. Al cerrar usa la finalización confirmada sin activar vendedor; conserva una tienda ya activa.
- Omitir permanece visible ante fallos o respuestas inciertas; se deshabilita temporalmente durante envío/foto/permiso nativo activo o recuperación, manteniendo la operación y decisión pendientes. La validación de campos/ID sólo bloquea Continuar. Elegir Comprar/Vender y los legales siguen obligatorios por requisito previo.
- Auditoría independiente del diff y suite UI completa 134/134, exit 0: seis recorridos completos Comprador/Casual/Negocio × Continuar/Omitir verifican presencia y habilitación por paso, final incierto, permisos, vendedor activo y doble clic sin operación duplicada. TypeScript exit 0; CI y despliegue quedan registrados con sus SHA/PR en la [Bitácora de Notion](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).
- Sin cambios de SQL ni cuentas. La suite simula Auth/ACK, foto/mapa y permisos; aceptación autenticada y física Android NAT-AND-02/08 e iOS NAT-IOS-02/07 conserva su seguimiento en Notion.

## 13-oct-2026 — Onboarding publicado; comprobación de todos los pasos

- Revisión solicitada por Javier tras el registro bloqueado de un amigo: Gemini había subido `6d6ee49` a la rama, pero no había creado ni integrado un PR. Production seguía en `9aae1ed`; el enlace `/pull/new/…` era un formulario.
- [PR57](https://github.com/Peter-code-bot/PROJECT-VICINO/pull/57) integrado a master el 13-oct a las 16:34:43 CDMX, merge `cb9f4448d8222535419714735cf32767f98c284c`, árbol idéntico al candidato. CI del PR `38478570301` y de master `38478724948` SUCCESS; Vercel Production `5LdjeBTJcZxVrNXXKcJpQy7MAnm1`, deployment `7051802998`, SUCCESS a las 16:37:32 CDMX para el mismo SHA.
- Reejecución de UI: 126/126, exit 0. Matriz ampliada `node scripts/test-onboarding-ui.mjs journeys`: 30/30, exit 0; incluye seis recorridos completos (comprador, vendedor casual y negocio, cada uno con Continuar y con Omitir), comprobando cada URL, operación y finalización. Primer ensayo 29/30: el test intentaba seleccionar Efectivo sin abrir el selector; se corrigió la interacción del test y la matriz completa pasó. Sin cambios adicionales al producto. Resultados y cierre en la [Bitácora de Notion](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).
- Smoke público: login y registro con contenido, onboarding protegido, API de ID 401 con `private, no-store`, CSS de progreso negro publicado. Sin cuentas creadas ni datos remotos modificados. Las pruebas de componentes simulan Auth/ACK, foto, mapa y permisos; aceptación autenticada del amigo y física Android/iOS pendiente en NAT-AND-02/08 y NAT-IOS-02/07. La app instalada carga `https://vicinomarket.com`; no se reconstruyó un binario nativo.

## 12-oct-2026 — Onboarding: navegación reactiva, recuperación de bloqueo y cabecera negra completadas (local)

- Corrección del bloqueo de navegación reportado por Javier (ONB-FREEZE-01) y nuevo progreso visual (ONB-PROGRESS-01). Rama aislada `fix/onboarding-navegacion-progreso-20261012` sobre base `9aae1ed` de master; checkout `PROJECT-VICINO-ONBOARDING`.
- Desconexión navegación/pantalla resuelta: retiradas sobrescrituras y monkey-patching global de History en `SessionDataProvider` e `installCommunityNavigation`. Implementado observador reactivo puro `createCommunityNavigationObserver` en `lib/navigation/retorno-comunidad.ts` que conserva la procedencia de ruta y metadatos opacos por entrada sin interferir con el router de Next.js.
- Serialización Comprar/Vender y recuperación de snapshots: guardados v3 atómicos por revisión y operación (`guardar_checkpoint_onboarding_v3`), eliminación de condiciones de carrera al alternar entre comprador y vendedor, adopción limpia de nuevos snapshots y componente de estado visible `OnboardingSaveStatus` con recuperación ante respuestas inciertas.
- Diseño ONB-PROGRESS-01: sustituido el texto visible «Paso X de 10» por barra superior horizontal negra (`--onboarding-progress-fill: #000000`, track `#D9D9D9`, borde `#808080`), 0% verde en temas claro y oscuro, con semántica accesible `role="progressbar"`. Flecha de retorno desplazada 8 px a la izquierda manteniendo área táctil de 48×48 px.
- Validación local 100% aprobada (exit code 0):
  - UI Component Test Suite (`test-onboarding-ui.mjs`): 126/126 aprobados.
  - Regresión Next.js 16.3.8 App Router real (`test-onboarding-next-navigation.mjs`): 3/3 aprobados.
  - Regresión comunidades y filtros (`test-plan-20260929.mjs`): 16/16 aprobados (Chromium y WebKit).
  - Observador de navegación (`test-community-navigation-observer.ts`): 10/10 aprobados.
  - Adversarial y concurrencia (`test-adversarial-challenger1.ts`): 15/15 aprobados.
  - Contratos SQL PGlite (`test-onboarding-checkpoint.ts`): 15/15 aprobados.
  - Borrador y snapshots (`test-onboarding-draft.ts`): 6/6 aprobados.
  - Flujo por pregunta (`test-onboarding-flow.ts`): 11/11 aprobados.
  - Cola serial e idempotencia (`test-onboarding-journal.ts`): 14/14 aprobados.
  - Server Actions v3 (`actions.test.ts`): 10/10 aprobados.
  - TypeScript: `pnpm --filter web type-check` exit 0 (0 errores).
  - ESLint: `pnpm --filter web lint` exit 0 (0 errores).
  - Next.js Build: `pnpm --filter web build` exit 0 (60/60 páginas compiladas, 77 rutas verificadas).
- Documentado en Notion como SSOT: Plan Vigente, Bitácora / DevLog, Tests pendientes y Backlog. Aceptación física en hardware pendiente en apartados nativos.

## 11-oct-2026 — RPC de roles cerrado y publicado; clave pendiente de acceso

- Javier autorizó terminar ADM-PASS-01/02 y confirmar la contraseña. Rama aislada fix/admin-role-security-20261011, base e5522f0; trabajo ajeno conservado.
- Server Actions autentican/verifican clave/límites/datos antes de cliente service_role; nuevo RPC liga actor a getUser y revalida admin en SQL. Migración revoca el RPC histórico a clientes y escrituras directas de tabla/columna; sin cambios a roles reales.
- Pruebas28/28, tipos/lint y build60/60 exit0. Preflight real confirmó EXECUTE histórico a authenticated; ensayo de fuente exacta con rollback PASS y candidato ausente después. [Acta literal](docs/ADMIN-ROLE-SECURITY-2026-10-11.md).
- [PR56](https://github.com/Peter-code-bot/PROJECT-VICINO/pull/56) integrada16:24:14CDMX: master de código7c16ce210faaa8edfd85ce270951bbae052332ce, árbol igual al candidato7171d98. SQL+ledger aplicado en transacción; hash/permisos verificados, autenticados/anon sin EXECUTE, sólo service_role. Tipos completos exactos: schema38179862952 intento2 SUCCESS. CI38180284684 SUCCESS incluidas deriva/legales; ProductionGF8nYehYpbwmSGUALSERwr4mSHEM SUCCESS16:26:35CDMX. PostgREST real rechaza entrada nula22023 sin tocar roles; smoke público3/3 exit0. Cierre documental se identifica en Notion por separado.
- ADM-PASS-01 sigue pendiente: comprobar/configurar ADMIN_SECURITY_PASSWORD y aceptación admin real. Vercel requiere autorizar identidad/correos de GitHub; aprobación solicitada a Javier, sin conceder permisos ni cambiar credenciales. Clave local ausente no acredita estado de Production; valor vigente no confirmado. Sin contraseñas en repo/SQL/documentos. ADM-PASS-02 tiene cierre técnico publicado; roles reales sin cambios.

## 11-oct-2026 — UI01–UI12 publicados en master y producción

- Autorización de Javier: ejecutar el plan acumulativo y registrar los resultados en Notion. Equipo Workflow Advisor; checkout aislado `PROJECT-VICINO-ONBOARDING`, rama `feat/onboarding-fluidez-20261011`, base `e3900fd`. Trabajo ajeno del checkout principal conservado.
- Quiero comprar/vender obligatorio; eliminado Activar como pregunta independiente, resumen y decisión vendedor en el cierre transaccional; alias/progreso/reanudación y Volver desde notificaciones resueltas corregidos. Pulido Home/login UI01–UI06 aplicado. Se conservan contenido arriba, un dato por pantalla, ID público y sugerencias del correo más números.
- Confirmación de cuenta después de OTP/OAuth y antes de Bienvenida, dos controles sin preselección, versiones e identidad/hora del servidor; historia previa preservada. Contexto persistente y journal serial con idempotencia/revisión/cuenta, errores recuperables y barreras de ID/foto/cierre; omitir no envía borradores descartados.
- UI117/117, vendedor17/17, legal12/12, SQL14 y acciones/helpers18/18 aprobados; tipos/lint y build60/60 exit0. Home18/18 y registro20/20 HTTP Chromium con Next/Supabase reales aprobados, sin cuentas/OTP. Medición local300muestras con ACK controlado: p95 siguiente utilizable 82,6→16,0ms; conACK600ms 632,7→16,1ms; CPU×4 82,5→22,4ms. No equivale a cuentas reales, red Next completa ni dispositivos. [Acta y evidencia literal](docs/ONBOARDING-2026-10-11.md).
- [PR55](https://github.com/Peter-code-bot/PROJECT-VICINO/pull/55) integrada14:51:53CDMX: master de código `ed45dc1ad0bf2897eb1c27381681117a8bc099eb`, árbol idéntico al candidato `7751048`. Migración20261011120000 aplicada en VICINO/main con archivo+ledger/assertions en una transacción, después de ensayo ROLLBACK sin cuentas/datos persistidos. Catorce cuerpos SQL, siete columnas, permisos y RLS comprobados. Tipos completos de producción incorporados; SecurityAudit38173985491 SUCCESS incluidas deriva de esquema y versiones legales. Vercel Production7Gtv14jv1ThmKEMSY6tfaxYcSy6z SUCCESS14:54:56CDMX, mismo SHA; nuevo gate servido en el corte coordinado. Smoke público9/9 exit0 y captura login verificados, sin cuentas/POST/aceptación de documentos. El cierre documental posterior se identifica por separado en Notion.
- Notion conserva el plan único y la aceptación pendiente. Android/iOS build, integración, dispositivos y distribución se actualizan en sus apartados de Bugs por ID; Auth/concurrencia real conservan pruebas pendientes. Este lote no cierra el backlog general.

## 10-oct-2026 — Onboarding publicado en master y producción

- Publicación autorizada por Javier: [PR54](https://github.com/Peter-code-bot/PROJECT-VICINO/pull/54) integrada el10-oct23:38:29CDMX; master de código `9ef8b8aa123e16492864809f7b29e7cffeefe282`, árbol idéntico al candidato `2549a69`. Contenido arriba, una página por dato, Omitir e ID público editable con sugerencias del correo más números publicados.
- SecurityAudit38115438218 SUCCESS en secretos, audit, tipos/lint y deriva. Sin vulnerabilidades conocidas, tipos completos de producción y versiones legales coincidentes. Vercel ProductionErvAJN7BjSRNxtQm8sTmmowpuJcH SUCCESS para ese SHA. Prueba pública6/6/exit0: login/registro/términos200, onboarding→login307 y API de usuario401/private,no-store, sin datos de usuario.
- Supabase VICINO/main tiene migración20261010120000 y ledger aplicados y verificados, con seis hashes/permisos/RLS/índice único/RPC legacy. No se persistió DML de prueba ni se crearon cuentas/correos. Plan, Diseño, Bitácora y Tests de Notion conservan publicación técnica y aceptación pendiente.
- El preview compiló, pero exigió SSO de Vercel: no se acredita navegación anónima del preview. Producción pública sí comprobada. UI102/102 y demás suites del candidato se mantienen; [acta literal](docs/ONBOARDING-2026-10-10.md).
- Pendientes de aceptación: concurrencia real, recorrido autenticado completo y Android/iPhone físicos. El parche de Capacitor necesita sync/rebuild y redistribución para llegar a apps instaladas. No cambia otros planes de Home/Auth, NT o Google Play. Este cierre documental se publica después del código y su SHA final se registra en Notion.

## 10-oct-2026 — Onboarding: migración aplicada y candidato PR54 — histórico

- Publicación a master autorizada por Javier. [PR54](https://github.com/Peter-code-bot/PROJECT-VICINO/pull/54), código base b042354; este corte prepara el candidato corregido y espera comprobaciones remotas antes de integrarlo.
- Migración20261010120000 aplicada a VICINO/main con DDL y ledger en transacción única después de dos ensayos ROLLBACK, uno con rol authenticated y RPC reales. Seis hashes de función, permisos, RLS, índice único y RPC anterior comprobados. Sin DML de perfiles persistido ni cuentas/correos nuevos.
- Conciliados tipos completos del artefacto de producción. Corregidas las13 vulnerabilidades del baseline con Next16.3.8, Capacitor8.4.3 y suelos de sharp/source-map-js/handlebars. Patches de Antigravity/PWA/ESLint preservados; instalación congelada y audit completo exit0, sin vulnerabilidades conocidas.
- UI102/102, SQL20/20, vendedor14/14, flujo9/9, glob62/62, Auth/perfil/SW24/24, Sentry sintético5/5, tipos y build59/59 aprobados. Lint local después de generar SW:0errores148avisos. [Acta](docs/ONBOARDING-2026-10-10.md) y Notion conservan evidencia y límites.
- La aceptación física y concurrencia multisesión siguen pendientes. El parche nativo sólo llegará a apps instaladas después de sync/rebuild y distribución; no se genera una versión nativa en este corte. No cambia otros planes de Home/Auth, NT o Google Play.

## 10-oct-2026 — Onboarding por dato, implementación local

- Pedido y autorización de Javier: contenido arriba, una página por dato, Omitir y elección del ID público con sugerencias del correo más números. Equipo Workflow Advisor: diseño, flujo y usuario/SQL.
- Rama aislada `feat/onboarding-20261010` en `PROJECT-VICINO-ONBOARDING`, base `d2d54cd`. Guarda dato y próximo paso juntos; omitir conserva valores; activación vendedor explícita; ID ocupado vuelve a comprobarse. Verde/crema y Outfit/Inter preservados.
- Evidencia técnica y alcance: [acta local](docs/ONBOARDING-2026-10-10.md). Migración preparada y pruebas locales; aplicación remota, concurrencia real y Android/iPhone físicos siguen pendientes. Este corte no publica ni sustituye otros planes.
- Validación local final: UI 102/102, SQL/ID 18/18, vendedor 14/14 y flujo 9/9; tipos web/shared, rutas y build 59/59 aprobados. Lint completo: 0 errores, 60 avisos. Revisión independiente sin P0/P1; corregidos navegación, colisiones de ID y scroll del campo con teclado.
- Fuente operativa: [Plan](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), [Diseño](https://app.notion.com/p/c8098e8a0cfa83c2b32d01df5ec49663), [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9), [Tests](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26).

## 06-oct-2026 — Errores del reporte semanal de Sentry (25-sep a 2-oct) arreglados en código

- Pedido de Pedro: «el tema de Sentry, si lo puedes hacer aquí, hazlo». Cuatro errores, un commit cada uno, con prueba que falló antes en el sitio de llamada real y pasa después. Sin migraciones y sin tocar la base.
- `efff5e3` FK `legal_acceptances_user_id_fkey` (7758342326): sesión de Auth viva sin fila en profiles (cuenta borrada a medias). El layout ya no monta el registro legal sin perfil; la acción reconoce esa FK por nombre y manda un aviso agrupado `sesion-sin-perfil` (warning) en vez de una excepción. La FK de legal_documents sigue siendo error.
- `af60e1b` «Cannot coerce the result to a single JSON object» (7758342436, 7758342372): cargarCore usaba throwOnError + single y lanzaba con 0 filas. Pasa a maybeSingle + `PerfilInexistenteError`; /perfil y /api/session/profile avisan sin excepción y la ruta sigue en 503.
- `805c3f0` (fuera del reporte): requireAdminOrModerator negaba la moderación a quien tenía admin y moderator a la vez (`.single()` sobre dos filas).
- `daac627` «Error: Rejected» (7522543334) y AbortError de SW: next-pwa registraba sin `.catch` y el stub de GoogleOther rechazaba. `register: false` + `RegistroServiceWorker` en el layout raíz. Comprobado en build de producción local: el SW se registra en /terminos y /forgot-password y un register que rechaza ya no deja unhandledrejection.
- `9934cf8` Volumen (756 con ~41 de nivel error): el aviso de rate-limit iba a Sentry una vez por isolate y el nivel warning no lo saca del total ni de la cuota. Queda solo en logs; el guard de build ya rompe producción sin Upstash. Hipótesis a cerrar en Discover (`!level:error`, agrupado por título).
- Arnés nuevo `apps/web/lib/pruebas/` para probar el archivo real dentro de la suite de apps/web. Suite 96/96, tsc, eslint de lo tocado y `pnpm build` (58/58) con exit 0.
- Revisión de lo anterior, dos arreglos con prueba en rojo antes: `f38b4a9` el layout ya no se salta el registro legal cuando la consulta del perfil FALLA (solo cuando sale bien con 0 filas, vía `maybeSingle`), y ese fallo va a Sentry con tags `layout=marketplace, query=profiles`; con `efff5e3` un 42501 de una columna sin GRANT dejaba sin registro a todos en silencio. `18dd13e` el registro del service worker solo calla el `Error("Rejected")` exacto de GoogleOther y el AbortError; el resto (404, redirección, MIME) se relanza y vuelve a llegar a Sentry, también en la app de Android, donde `captureException` de `@sentry/nextjs` se perdería. Suite 103/103, tsc, eslint y `pnpm build` (58/58) con exit 0.
- Pendiente de Pedro: terminar de borrar la cuenta 0186140a (Auth + 11 archivos); opcional, Inbound Filter de web crawlers en Sentry.

## 04-oct-2026 — S02 publicado a master; Redis y permisos de mapa verificados

- Javier confirma revocación/acceso Preview y ordena publicar; confirmación humana registrada sin inventar fecha histórica de rotación. Inicio de sesión14:16:42CDMX; fin real en Bitácora de Notion.
- PR52 integrado04-oct14:20:26CDMX, master6c3750dcafa022f174794c75a7a2186ca32dadcf. Vercel producción4EJTjwR7dqdpykhmUGM4rge9WMYq SUCCESS; CI37231717436 secretos/audit/tipos-lint/deriva SUCCESS. Tipos completos y versiones legales coinciden con producción, sin advertencia efectiva de deriva. NT/Antigravity preservados.
- Producción comprobada: «Únete a VICINO», Solicitudes/Comunidades públicas, tarjeta→login/next y logo→feed; APIs reales16/16/exit0 y Redis activo (callback sin código limitado en petición21, sin cuentas/correos/códigos). Las0comunidades/posts actuales producen vacío honesto.
- Cierre del permiso temporal del mapa: migración20261004202352 aplicada con ledger en la misma transacción, después de ensayo ROLLBACK. anon/PUBLIC sin EXECUTE; authenticated/service_role, dueños y definiciones MD5 intactos. Home/preview conservan sus RPC. FuenteMD5LF7473398d40a0a14edea41ca825b9fef9; no db push histórico ni cambios de cuentas/RLS.
- Acta literal: docs/MP04-PUBLICACION-2026-10-04.md. Se versiona el cierre de permisos separado del código publicado. Publicación técnica no acredita automáticamente Android/iPhone, recepción/recuperación/OAuth completos, NT01–NT04 ni Google Play; los casos y responsables permanecen en Notion.
- Revisión final detectó desincronización Muro/Descubrir después de login: URL cambiaba pero selección/next de Fundar quedaban en Muro. Corrección con router.replace y scroll:false; regresión ampliada falló antes y pasó después: Next/Supabase real18/18 Chromium +18/18 WebKit, cero POST y scroll474px; componentes36+36, tipos/lint/build58/58 exit0. Primer ensayo History null no bastó; type-check concurrente con build falló por tipos generados y se repitió secuencialmente. Fallos literales y diff en acta; controles remotos finales/SHA se actualizan en Notion tras integrar el cierre.

## 04-oct-2026 — PR52 remoto; tipos completos de Supabase conciliados (sesión en curso)

- [PR52 en borrador](https://github.com/Peter-code-bot/PROJECT-VICINO/pull/52), rama feat/registro-invitados-20261001 subida; master a2a2d70 sigue con NT. CI37222838059 secretos/audit/tipos-lint y Preview25m1K5NJ1KkLBodkPfnLZWikDjd8 SUCCESS sobre f97bfd3; todavía no S02 en producción.
- MP11 tipos: artefacto completo real del CI37222838184 incorporado, conservando únicamente las dos restricciones never de la columna mapa GENERATED STORED. Normalizador acotado e idempotente probado; nuevo CI compara todo el archivo con producción. Se corrige nulabilidad DTO con z.infer de esquemas existentes tras TS2322; 25 pruebas, tipos web y lint dirigido exit0, sin cambiar runtime ni validación.
- Auditoría completa 0 vulnerabilidades, OpenTelemetry2.8 y arreglo Antigravity preservados. Build local final58/58 y lint148warnings ya comprobados. Cierre explícito de contextos corrige bloqueo WebKit de harness: 17/17 Next/Supabase real/exit0, scroll474px y cero POST. Android/iPhone y Auth completo siguen separados.
- MP00 revocación/continuidad y MP02/MP03 correo/recuperación/OAuth/onboarding/dispositivos siguen pendientes con preguntas concretas. Preview está protegido por acceso Vercel de Pedro; construcción verde no acredita recorrido remoto. Revisión automática rechazó prueba con clave histórica y autenticación GitHub no autorizada; ninguna ejecutada para completar el acceso. Sin elusión.
- Inicio de esta sesión11:27:09 CDMX; fin en Bitácora al terminar. Mapa mantiene permiso temporal autorizado hasta aplicación compatible; NT01–NT04, Google Play y demás paquetes del mega plan conservan seguimiento. Acta literal: docs/MP04-2026-10-04.md.

## 04-oct-2026 — MP04 candidato de publicación (sesión en curso)

- Javier solicita terminar pendientes y publicar en master. Inicio real 11:27:09 CDMX; fin aún pendiente. Antigravity y NT publicado preservados.
- OpenTelemetry core 2.7.1 → 2.8.0 (override solo 2.x vulnerable); auditoría completa ahora 0 vulnerabilidades/exit0. Prueba baggage hostil y SDK en memoria4/4, instalación congelada/tipos/lint/build58/58 exit0; lint148warnings. Gitleaks12 commits nuevos sin hallazgos/exit0.
- Tipos completos MP11: PAT local HTTP401; exportación del panel sin archivo capturado. Nuevo workflow de artefacto de esquema en PR para usar la credencial ya configurada en CI, sin datos ni cambios remotos. No se declara regeneración completa todavía.
- Claves legacy habilitadas en panel; entorno local aún legacy. MP00 requiere continuidad/revocación acreditada. Prueba con clave expuesta bloqueada por revisión automática, permiso específico pendiente; no se ejecutó. Correo nuevo/recuperación completa/OAuth/onboarding y teléfonos MP02/MP03 siguen pendientes reales.
- Se prepara push de rama y PR en borrador para CI/Preview; master no se ha modificado con S02. Mapa conserva autorización temporal anterior hasta app compatible. Acta: docs/MP04-2026-10-04.md; Notion conserva estados y salidas literales.

# Estado — NT publicado; previews invitados locales en validación

## 2026-10-04 — MP03-D: continuación 10:41:31 CDMX

- PR #51 / nombre de tienda integrado y publicado el 03-oct-2026 22:36:10 CDMX, master a2a2d708c8aaada26a56f5533d71c737661b9324. Vercel Production CP7axQxXAXvtu1VnmpgzNKRA76AU SUCCESS y UI real Creed en Home/detalle/perfil. NT01–NT04 con cuentas dedicadas y teléfonos todavía PENDIENTE.
- Trabajo de Antigravity 9cd3048/e5ac753 revisado y preservado. Auditoría alta corregida sin cambiar umbral; publicado con NT. CI avisó que los tipos completos del esquema están desfasados: MP11 permanece abierto (corrección de etiqueta; MP07 es Apple/APNs/FCM).
- MP03-D implementado en commit local 3a753d1: Home Solicitudes/Comunidades públicas con DTO limitado; detalles, filtros, Mis comunidades y acciones van a login con contexto seguro. Retorno de logo Home preserva feed y scroll. Sin efectos automáticos ni datos de perfil/contacto/geografía/media en RPC; redacción acotada de formatos comunes de contacto/ubicación en texto libre.
- Migración 20261004041500 aplicada junto con ledger en transacción única, solo service_role; MD5LF6dc531f917577da4701e7fec7f9767b3. Ensayo ROLLBACK y permisos/PostGIS reales comprobados. Corte de datos: 4 solicitudes, 0 comunidades/publicaciones elegibles; no fabricar ejemplos ni editar cuentas reales.
- Conciliación con master vigente preserva las dos decisiones en Header: AuthLink para invitados y publicProfileName para tiendas. Historial documental de ambas ramas conservado debajo. Validación final: 124 pruebas Node, SQL16, componentes36 Chromium+36WebKit, Next/Supabase real17+17 y retorno474px estable, build58/58/tipos web, tipos shared, lint0errores148warnings, búsqueda3 y glob62; todos exit0. Auditoría high exit0 con una moderada residual. Evidencia literal y fallos del harness conservados en docs/MP03D-2026-10-04.md y Notion. Ayuda del footer corregida a /centro-de-ayuda y comprobada en escritorio; acceso público HTTP200. S02/previews todavía sin push/publicación; NT mantiene su despliegue independiente.
- MP00, SMTP/entrega MP02, Auth completo y dispositivos MP03 pendientes; push S02 condicionado no realizado. Mantener permiso temporal anterior del mapa hasta aplicación compatible. Inicio sesión real 04-oct-2026 10:41:31 America/Mexico_City; cierre/evidencia en Notion, sin contar la interrupción anterior como trabajo activo.
- [Plan](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), [Pendientes](https://app.notion.com/p/39998e8a0cfa8158a548cc7a66cbc79c), [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9), [Tests](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26).

# Historial de cortes NT y S02 — los estados inferiores no sustituyen el corte vigente
# Estado — Nombre de tienda: migración aplicada; integración de PR #51 en revisión

## 2026-10-03 — continuación NT y revisión de Antigravity

- **Codex, familia GPT-6.** Reanudación real: 22:00:27 CDMX tras interrupción del corte de 17:48; no se cuenta el intervalo como trabajo continuo. Implementación original `515632b` conservada. Los cortes siguientes son historia.
- Supabase VICINO/main `oxxdkwywprkfghhbnoto` confirmado por SQL Editor autenticado: Alex Cabrera, tienda activa/business, nombre Creed. CLI administrativa sigue HTTP401. Producción tiene 15 funciones vigentes; `notify_new_message` se retiró intencionalmente en mayo. El emisor desplegado despacha mensajes a Edge con título genérico; se conserva intacto.
- Migración `20261003213000` aplicada y registrada en la misma transacción tras dos ensayos con ROLLBACK. Guardas de hashes/firmas, atributos de funciones, ACL/RLS/policies/triggers y emisor actual pasaron. Sin DML de cuentas. Evidencia contrastada 22:22:22 CDMX: source registrado coincide exactamente al normalizar CRLF del portapapeles a LF; SHA256 `8cd11e0ebc8ee2a1a61f9f0ab984b8f0b473a3d4459cbaa86c1648f565f6435b`. MD5 raw ledger `e7cde7901b745abf81eccb6ed63b9ff6`, normalizado LF `af5c536b69e2960c523415e1e4f5979c`.
- Corregida búsqueda sin ubicación que omitía campos de tienda: tres regresiones ejecutan SearchPage y ProductCard reales con proyección de datos. SQL maneja trim exacto JS, formato multiline, aliases y retiro CREATE/DROP. Suite identidad 11/11 más ranking final 1/1, búsqueda 3/3, catálogo 6/6, historial 12/12; PostGIS/dispositivos no acreditados por PGlite.
- Revisión de Antigravity: commits `9cd3048`/`e5ac753` importados exclusivamente como `7b85a5a`/`afc904e`, sin traer S02 al PR51. Prototipo anterior conservado en stash dirigido. Instalación congelada, audit high (0 altas/críticas, una moderada), glob 62/62, tipos web/shared y build 57/57 aprobados. Lint secuencial exit0/149 warnings; intento concurrente con build falló ENOENT de `public/sw.js`, evidencia conservada.
- Nueva base remota `a7262ab` incorpora cuatro commits de Android/Sentry/mapa; conciliación y controles del candidato final pendientes. PR #51 aún en borrador; push, CI, integración y producción de aplicación no acreditados en este corte. Aceptación NT01–NT04 y Android/iPhone siguen pendientes; no se fabrica evidencia modificando Alex/Creed.
- MP03-D solicitado por Javier: previews nacionales de solicitudes/comunidades para invitados, clic → login con next seguro. Implementación y pruebas en checkout REGISTRO separado; no cambia el alcance de este PR. [Plan](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), [DevLog](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9), [Tests](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26).

## 2026-10-03 — PLAN-20261003-NOMBRE-TIENDA: implementación local

- **Codex, familia GPT-6.** Inicio autorizado: 2026-10-03 15:13:47 CDMX. Rama `fix/nombre-tienda-global-20261003`, base remota verificada `b70fe9196fbaf8c2e49031fd0f25d300748c62fd`. Checkout original preservado.
- Tienda activa (`es_vendedor=true`, `seller_type=business`) muestra el nombre comercial en publicaciones, perfil, búsqueda, chats, comunidades, reseñas, solicitudes, citas, historial, ventas y paneles. Nombre vacío legado usa “Tienda”; modo individual/desactivado conserva el nombre personal. Validación al guardar/activar y revalidación global tras guardar perfil.
- 25/25 pruebas locales PASS, TypeScript web/shared exit0, lint completo exit0/61 warnings y build configurado exit0 (57/57 páginas estáticas). La prueba SQL verifica las 16 definiciones del repositorio, preserva filtros/firmas/ACL/RLS y ejecuta un aviso de reseña con nombre renombrado; no sustituye producción/PostGIS/dispositivos.
- Entrega técnica local: 2026-10-03 16:48:38 CDMX, commit de aplicación `515632ba323e2a4f615bdd99d8ce00b5bfedd1a9`, [PR #51 en borrador](https://github.com/Peter-code-bot/PROJECT-VICINO/pull/51). CI de ese commit aprobó tipos/lint/secretos y Vercel Preview. Auditoría falló por `braces@3.0.3` (GHSA-vfj7-8cjw-p6xm), presente en el lock de la base y sin cambios de dependencias en este PR; el aviso no ofrece versión corregida. No se rebaja el umbral de auditoría.
- Migración `20261003213000_identidad_publica_modo_tienda.sql` preparada, **sin aplicar**. Lectura administrativa de Supabase fuera del sandbox: HTTP401; falta restablecer `VICINO_SUPABASE_PAT` y contrastar las funciones instaladas antes de aplicar. Sin integración ni despliegue de producción. Resolver auditoría/revisión y NT01–NT04 antes de cerrar; fin de corrección pendiente.
- [Plan y evidencia en Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9), [Tests pendientes](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26). Notion conserva el detalle y las fechas de entrega/cierre; los cortes siguientes son historial.

# Estado — S02 validado localmente; entrega y pruebas físicas pendientes

## 2026-10-03 — «Únete a VICINO» y revisión previa a push

- Javier confirma el texto definitivo **«Únete a VICINO»**, con tilde. Componente Home y expectativas existentes actualizados; vista local recargada y nombre accesible comprobado. Sin cambio de rutas, estilos ni política de invitados.
- Build final58/58 con TypeScript, lint del componente, SSR2/2 y componentes44/44 Chromium: exit0. Backend y QA independientes no detectaron defectos nuevos de código; las pruebas controladas no acreditan SMTP, Auth completo ni dispositivos.
- **Nuevo bloqueo P0 MP11-A:** `corepack pnpm audit --audit-level=high` falla exit1: una alta en braces3.0.3 y dos moderadas. Afecta rutas next-pwa y ESLint; [aviso oficial](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) sin versión corregida publicada al revisar. Plan y aceptación añadidos a [Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263); no se ignora el aviso ni se eleva el umbral.
- Fetch origin exit0: base origin/master b70fe91, sin cambios remotos pendientes de integrar en este corte. Push sigue condicionado y no realizado: faltan evidencia MP00, SMTP/entrega MP02, recorridos reales/dispositivos MP03 y auditoría verde MP11-A. MP04 comprobará CI/deploy/Redis y revocación del permiso temporal del mapa tras la entrega compatible. Google Play sigue su seguimiento paralelo.
- Sesión MEGA-REV-20261003-172710 iniciada17:27:10 America/Mexico_City; fin real y commit local en [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9). [Pendientes](https://app.notion.com/p/39998e8a0cfa8158a548cc7a66cbc79c) y [Tests](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26) actualizados con evidencia literal y fallo inicial de red preservado. Sesión terminada no significa cierre del mega plan.

## 2026-10-03 — mega plan iniciado: MP01 y MP03-C validados localmente

- **Codex, familia GPT-6.** Inicio real de implementación 15:16:24 America/Mexico_City; cierre de sesión y evidencia en [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9). [Mega plan](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), [Pendientes](https://app.notion.com/p/39998e8a0cfa8158a548cc7a66cbc79c) y [Tests](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26) registran estados actuales; cortes inferiores son historia.
- MP01 corregido: el freno estricto rechaza reason=timeout aunque success=true, con presupuesto explícito5000ms.95pruebas de SDK/ServerAction/política, incluidas cero lookup/signup/reserva/sesión en fallos, exit0. Límites generales sin cambiar.
- MP03-C implementado: bloque compacto entre mapa/ubicación y categorías, solo sin sesión desde SSR/provider. Verde «Crea tu cuenta» y «Ya tengo cuenta · Iniciar sesión», AuthLink/next seguro/retorno Home.48px, contraste texto/foco claro/oscuro/hover; excepción local outline-fg! resuelve :focus-visible global sin @layer que anulaba el foco oscuro. Revisión QA independiente final aprobada.
- SSR2/2, componentes44Chromium+44WebKit (Auth/SDK/router simulados), Next real HTTP20/20 por motor y recorridos/contraste finales exit0. Home retorna al scroll600px Chromium/180px WebKit en el pase final; Chromium confirma además correo existente autorizado/POST/aviso sin OTP con Redis+Supabase reales. Build final58/58/TypeScript exit0; lint fuente0errores/61warnings preexistentes, componente finalsin salida/exit0. [Acta con comandos y fallos conservados](docs/MP01-MP03C-2026-10-03.md); capturas inspeccionadas en test-results ignorado. WebKit tuvo un cierre>10s/exit1 después de aprobar casos; repetición sin ampliar límites ni cambiar código exit0.
- MP02 leído en Supabase UI vigente: SMTP personalizado false/servicio integrado y Auth Hooks sin filas; altas y confirmación activas; Email/Google/Apple habilitados; OTP6/600s y plantilla vigente Token/10min con enlace alternativo; captcha false. SiteURL/10redirects y límites de requests conciliados; cuota de correo ocultada por herramienta, no nueva cifra afirmada. Configurar transporte/remitente verificados con Pedro y comprobar entrega sigue pendiente; ningún ajuste remoto realizado.
- MP00 permanece POR CONFIRMAR: Javier aclara que no tiene fecha ni registro de revocación/rotación de Pedro. Principal autorizado para existente/recuperación; alias propuesto no autorizado, sin cuenta nueva/correo solicitado/contraseña modificada. Pendientes: correo nuevo real/recuperación/OAuth/onboarding/dispositivos, luego push condicionado/CI/deploy/Redis y revocación permiso temporal mapa. Google Play conserva pendientes de envío/aprobación9/conteo/icono-splash. **Sin push/deploy; sesión terminada no significa cierre S02/mega plan.**


## 2026-10-03 — prioridad añadida: acceso visible Home para invitados

- MP03-C P0 añadido al [mega plan](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263) dentro de S02-B, antes de entrega MP04. Bloque compacto solo sin sesión, entre mapa/ubicación y categorías: botón verde «Crea tu cuenta» y enlace «Ya tengo cuenta · Iniciar sesión».
- Reusar sesión SSR/MuroSesionProvider y AuthLink/retorno Home; conservar Home pública, scroll, next seguro y onboarding. No consultar existencia de cuenta en Home. [Pendientes](https://app.notion.com/p/39998e8a0cfa8158a548cc7a66cbc79c) y [Tests MP-Q11](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26) actualizados; estado PLANIFICADO/SIN IMPLEMENTAR.
- Sesión iniciada 15:11:51 America/Mexico_City; fin y revisión en [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9). Solo documentación y lectura de UI; sin cambio de aplicación ni push/deploy.

## 2026-10-03 — mega plan conjunto por prioridades en Notion

- [Jornada / MEGAPLAN-20261003-VICINO](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263) reúne los 17 grupos abiertos en 20 paquetes MP00–MP19: responsables, dependencias, pasos, aceptación y reversión. [Pendientes](https://app.notion.com/p/39998e8a0cfa8158a548cc7a66cbc79c) enlaza la cola P0/P1/P2/P3; historial conservado. Planificación completada, ejecución por paquetes pendiente.
- **Nuevo hallazgo P0, solo lectura:** SDK Redis puede devolver success=true con reason=timeout; enforceStrict actual lo admite. MP01 exige rechazar ese resultado y probar cero lookup/signup antes del push S02. Los pases anteriores no cubren ese caso; no se corrigió código de aplicación en esta sesión.
- Planes incompletos completados: MP13 pantalla Android offline local/errorPath/empaquetado/AAB; MP08 ayuda FUNDAR y orden de permisos MODERADOR; MP19 reactivación condicional de aparcados. PT04/PT09/S08 y guiones invitados conciliados con las entregas/decisión S02 vigentes; preservar BB03 y piloto nativo.
- Camino crítico: confirmar seguridad/configuración, corregir MP01, aceptación Auth real y dispositivos, después push autorizado condicionado y deploy/Redis/permisos mapa. Google Play MP05 avanza en paralelo: Javier no envió invitación ni probó icono/splash; rotación por confirmar; aprobación9/conteo actuales sin nueva comprobación.
- Workflow Advisor del hub aplicado; revisión de planificación backend, móvil/QA y frontend solo lectura. [Tests](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26) y [Android](https://app.notion.com/p/3b698e8a0cfa8111a9b5fb054aa154c8) enlazan criterios pendientes; sin push, deploy, correos, notificaciones ni cambios de consola en esta sesión.
- Sesión MEGA-S-20261003-145102: inicio real 14:51:02 America/Mexico_City, fin y evidencia en [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9). S02 y jornada global EN PROCESO; siguiente paso técnico MP01.

## 2026-10-03 — conciliación de pendientes y planes en Notion

- [Bugs y Tareas Pendientes](https://app.notion.com/p/39998e8a0cfa8158a548cc7a66cbc79c) tiene un corte vigente al inicio: 10 grupos de avances y 17 grupos abiertos con responsable, plan y siguiente paso. Se corrigieron 15 entradas antiguas; configuración Redis/proveedor MapKit completados, entregas Historial/chat/mapas reconocidas, S02 local aún sin publicar. Historial conservado.
- Código existente revisado: recorte de avatar conectado en tres pantallas, reordenación de categorías y entrada de cupones oculta. Se registra implementación, no aceptación física ni nueva prueba de subida. c152b20 es ancestro de la base b70fe919; no se modificó código de aplicación.
- Javier confirma: invitación no enviada, icono/splash no probados y rotación/revocación de credenciales por confirmar. Google Play y plantilla de invitación alineados; aprobación 9 y verificadores actuales sin nueva evidencia.
- Plan completo no encontrado para pantalla Android propia sin conexión; S07 fundar/moderador y eventual reactivación de funciones aparcadas requieren detalle. PT04/PT09 y S08 tienen planes, pero deben conciliar configuración Redis y precondiciones ya superadas. Estado/alcance en Notion; no se implementan nuevos bloques por esta revisión.
- Sesión de conciliación iniciada 14:32:43 America/Mexico_City; fin real, evidencia y verificación en [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9). S02 y Google Play EN PROCESO; sin push/deploy nuevo.

## 2026-10-03 — seguimiento de Google Play por sesión en Notion

- Invitación Android del usuario guardada íntegra como GPLAY-INV-20261003 en [Plantillas WhatsApp](https://app.notion.com/p/3b598e8a0cfa8190b6f3ff240da4cf7b); envío a participantes no confirmado en esta sesión.
- [Android / Google Play](https://app.notion.com/p/3b698e8a0cfa8111a9b5fb054aa154c8) incluye panel vigente, historial de versiones y verificadores, incidencias/pruebas, comentarios y plantilla de sesiones con inicio/fin reales en America/Mexico_City. Se mantienen nombres e historial; cada sesión añade evidencia y su siguiente paso con responsable. Backlog, Tests y Bitácora enlazados.
- Corte de Pedro del 03-oct: 3/12 verificadores y versión 9 enviada a revisión; no nueva comprobación de consola ni aprobación. Siguen pendientes continuidad de participantes, aprobación/disponibilidad 9 y pruebas físicas de icono, splash conectado/modo avión y acceso Google. La guía oficial distingue cumplir 12/14 días, solicitar acceso a producción y publicarla.
- Sesión documental GPLAY-S-20261003-141115: inicio real 14:11:15; cierre y verificación en Bitácora de Notion. Sin cambios de aplicación, Play Console o Vercel, sin envío de invitaciones ni despliegue. Google Play y S02 EN PROCESO.

## 2026-10-03 — reporte de Pedro y Redis local conectado

- Javier compartió el reporte fechado de Pedro: ambas variables Redis guardadas en Vercel vicinomarket para Production/Preview/Development, token de escritura y PONG comprobados por Pedro; **sin redeploy**, activación con próximo despliegue. Se registra como reporte, no como nueva inspección de API Vercel por Codex. Notion jornada/Bitácora/Tests/backlog alineados; historial de fallos conservado.
- Token local finalmente guardado en el checkout aislado. PING independiente HTTP200/PONG/exit0. Prueba con SDK y funciones reales: reserva12 concurrentes/1 ganador, TTL y liberación, protección del propietario, cuota5 admitidos/sexto bloqueado y ausencia de limitador rechazada; exit0. Harness ignorado, solo alias oficial server-only de Next; primeros errores de importación del harness registrados, no fallos de la aplicación.
- WebKit reveló un fallo real de escritura temprana: React borraba el nombre rellenado antes de hidratar, validación HTML impedía POST. Registro ahora mantiene3campos y3acciones deshabilitados hasta hidratación; revisión QA independiente aprobada. Prueba HTTP ampliada con JS retenido/SSR, valores conservados y POST real, límites de RPC/captura/cierre/proceso y protección del correo en errores. Fallos diagnósticos anteriores registrados literalmente en Notion.
- **Build final posterior a esa corrección:** exit0/58 páginas/TypeScript aprobado; tipos standalone sin salida/exit0, lint dirigido sin salida/exit0, checks TODO/rutas/guardRedisProduction exit0. Componentes40Chromium+40WebKit exit0 (Auth/SDK/router simulados). Next real final en ambos motores: HTTP20/20, Buscar→login, retorno Home600px Chromium/393px WebKit, SSR protegido/habilitación sin pérdida de nombre, POST real y aviso existente sin OTP, correo temporal/next al abrir recuperación; ambos exit0. No correo solicitado ni contraseña modificada. No equivale a SMTP, OAuth, onboarding ni teléfono real.
- Android según Pedro: versión8 publicada con X, ficha con V; versión9 con V/firma verificada por Pedro, subida por el titular y enviada a revisión de Prueba cerrada - VICINO/100% compatibles.3/12 verificadores; aprobación9/reloj14d/aceptación física pendientes. Splash quitado al cargar o15s reportado corregido; offline aún página genérica. Detalle por append en Android/Google Play y Tests de Notion; no se inspeccionó Play Console ni se envió mensaje a participantes.
- Sin push/deploy nuevo; master remoto confirmado b70fe9196fbaf8c2e49031fd0f25d300748c62fd. Falta recorrido SMTP/OTP/recuperación completa/OAuth/onboarding/dispositivos y entrega compatible; mapa conserva permiso temporal y requiere revocación explícita al entregar nueva app. S02 EN PROCESO.

## 2026-10-03 — comprobación de conexión pendiente

- Continuación iniciada 13:22:31 America/Mexico_City. Configuración original todavía apunta a URL anterior; `.env.local` del checkout aislado preparado con URL nueva y token vacío para entrada del usuario, confirmado ignorado por Git. Apertura en Codex solicitada, status queued; no credenciales en código/chat/Notion.
- `node scripts/verificar-rate-limit.mjs` contra producción: exit1, 48 respuestas303 y 0 frenadas por too_many_requests. No se observa límite activo; causa exacta/configuración de Pedro/redeploy todavía por confirmar. No se intercambió ningún código ni se modificaron cuentas Auth. Falta token local y configuración activa de Vercel para pruebas reales; sin push ni nuevo despliegue.

## 2026-10-02 — S02: configuración Redis y push condicionado

- **Codex, familia GPT-6.** Sesión registrada desde el primer sello verificable 19:43:05 America/Mexico_City. Javier pidió configurar Redis, inició sesión en Upstash y autorizó **push si todo funciona bien**. Esta autorización sustituye el bloqueo previo de transferencia al repositorio público; no sustituye las pruebas funcionales pendientes. Remoto master confirmado todavía en `b70fe9196fbaf8c2e49031fd0f25d300748c62fd`, sin push nuevo.
- Upstash **vicino-ratelimit** creado en **Free**, resumen Monthly:$0, Oregon/us-west-2, eviction desactivada. La región coincide con pdx1 de `apps/web/vercel.json`. Consola Redis: `PING` respondió `PONG`, verificado visualmente. No se contrató plan de pago ni añadió método de pago.
- **Redis todavía no conectado a VICINO:** falta sustituir `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` en entorno local y Vercel, y probar la conexión/cuota/formulario real. Ninguna credencial impresa o guardada en código/Notion/chat. Javier no tiene acceso al proyecto Vercel de Pedro: solicitó un prompt para enviárselo personalmente. Mensaje preparado, no enviado por Codex. Configurar ambas variables en Production/Preview/Development; token normal de escritura compartido por separado. No hubo cambios de configuración local durante esta sesión.
- Mapa: Javier autorizó explícitamente «Sí, restaurar temporalmente». GRANT EXECUTE a anon sobre RPC v1/v2 aplicado; auditoría final confirma anon/authenticated/service_role=true en ambas. RLS, PUBLIC, lookup Auth y ledger intactos. Antes: app publicada sin sesión503 y RPCanon401/42501; después: ambas HTTP200, exit0. El resultado final sigue siendo mapa privado con login directo. **Al entregar la app compatible, volver a aplicar explícitamente la revocación anon/PUBLIC y auditar: el ledger conserva la migración instalada y no la repetirá automáticamente.**
- Implementación funcional local `6eb060c` + `b9c4f3a`; pruebas y límites conservados en el historial siguiente y [Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263). Sin publicación de aplicación nueva. Pendientes: Vercel/local conectados a Redis, Auth/correo real, Google/Apple/onboarding/dispositivos, push condicionado y entrega compatible. Tarea EN PROCESO; fin de sesión no es fin de tarea.

# Historial — S02 antes de crear Redis

## 2026-10-02 — S02-A / S02-B: implementación en checkout aislado

- **Codex, familia GPT-6.** Implementación iniciada 2026-10-01 23:01:53 America/Mexico_City. Fin de la sesión inicial no registrado: no se inventa una hora ni se cuenta el intervalo entre mensajes como dedicación activa. Continuación solicitada por Javier, primer sello verificable 2026-10-02 19:13:45. Plan, sesiones y avances por append en [Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263). Base vigente `b70fe9196fbaf8c2e49031fd0f25d300748c62fd`, trabajo ajeno conservado; rama `feat/registro-invitados-20261001`, implementación inicial `6eb060c` y corrección posterior de retorno Home.
- Registro existente muestra aviso explícito en la tarjeta, login/recuperación/cambio de correo; no OTP ni llamada signup cuando lookup existe. Lookup booleano restringido service_role, cuota estricta previa y reserva distribuida por hash de correo. Fallos se recuperan en el formulario. Recuperación cambia contraseña antes del destino, correo temporal y next seguro, login no confirmado ofrece reenvío, callbacks web/nativos conservan contexto incluso al fallar.
- Home/previews permanecen públicos; rutas y acciones privadas van a login directamente. Destino seguro y onboarding previo; las acciones con efectos regresan a contexto sin ejecución automática. API mapa exige sesión. Retorno Home espera al scroll/foco de Next y a la altura disponible, verifica estabilidad y cancela ante una nueva interacción, sin bloquearla. El fallo real WebKit600→56px motivó esta corrección; la prueba final exige la posición exacta del clic también después de1s.
- Revisión independiente backend y QA aprobó correcciones de código. Pruebas locales: 91 Node, 40 Chromium + 40 WebKit (componentes reales; Auth/SDK/router simulados), SQL PGlite14/14 y API16/16. Tipos/build final exit0,58/58; lint completo anterior exit0/0 errores/61 warnings existentes (sin PWA generado), lint dirigido de la corrección final exit0/0 errores/1 warning preexistente. Next real final:20/20 HTTP en ambos motores; Home→Buscar→login y producto→login→Home con scroll estable tras1s, Chromium386px y WebKit392px en la ejecución final. Caída Redis real devuelve error recuperable y no OTP; no se enviaron correos ni se modificó la cuenta autorizada. Evidencia y fallos previos en [Tests pendientes](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26) y [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9). No equivale a SMTP, dispositivos ni concurrencia Auth real.
- **Aplicación pendiente de publicación:** Redis local configurado devuelve ENOTFOUND; Vercel requiere sesión para comprobar variables. Lookup remoto instalado y ACL auditada. Migración mapa también instalada: anon/PUBLIC denegados, authenticated/service_role conservados. Restauración temporal para aplicación anterior rechazada por revisión automática; aprobación del usuario pendiente, restricción sigue activa. Push también rechazado; remoto verificado público Peter-code-bot/PROJECT-VICINO, autorización expresa pendiente. Sin push, PR, CI nuevo ni despliegue de aplicación. PAT Management401 impide ejecutar fixtures staging/regeneración completa. Pendientes: Redis funcional, autorizaciones, pruebas Auth/correo real, Google/Apple e iPhone/Android, publicación y aceptación definitiva. Tarea EN PROCESO; fin de sesión no es cierre de tarea.

# Historial — S12 publicado; aceptación física pendiente

## 2026-10-01 — S12 entregado para revisión de Javier

- **Codex, familia GPT-6.** Aplicación/tests/evidencia en `ea0a3cb5e490bb3e982be3b9d563af53a95f7851`, push sin fuerza a master confirmado. [CI36942169812](https://github.com/Peter-code-bot/PROJECT-VICINO/actions/runs/36942169812): cuatro checks completed/success. [Vercel6ieNoBPGmTqHFqRuMd2qNJMTMEhT](https://vercel.com/peters-projects-b65496a9/vicinomarket/6ieNoBPGmTqHFqRuMd2qNJMTMEhT): success, Deployment has completed. [Mapa publicado](https://vicinomarket.com/mapa).
- Producción después del deploy: API exit0/7PASS/0SKIP/43elegibles/20lecturas anónimas y smoke de contenido exit0/8enverde, incluido canonical correcto. La diferencia de canonical local queda resuelta en dominio real; no se cambió metadata de aplicación.
- 162 controles locales, build final configurado, typecheck/lint/audit/Gitleaks y revisión de tres personas en dos rondas aprobados según [Acta](docs/S12-MAPA-FLUIDO-2026-10-01.md). Chrome real393px:3/3PASS de preview/Buscar/hoja, capturas inspeccionadas. Mapa de producción abierto en browser de la app:43publicaciones/31vendedores, sin panel permanente.
- [Plan](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9), Diseño y [Tests pendientes](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26) registran implementación y entrega. CI sigue advirtiendo **Tipos desfasados**, success no acredita regeneración completa. Permanecen pendientes físicos/autenticados/p95/heap/PostGIS100k/PAT. El control del browser no permite tocar contenido MapKit dentro de shadow root cerrado; no se declara aprobado pinch ni ausencia de parpadeo físico.
- Este cierre cambia solo documentación. Los cortes siguientes conservan estados históricos y no sustituyen esta entrega. Sin migración nueva ni cambio de coordenadas públicas aproximadas.

## 2026-10-01 — S12: implementación tras revisión visual de Javier

- **Codex, familia GPT-6.** M01–M02/H01/B01/A01/D01 implementados sobre `fec6ae4`, usando Workflow Advisor y equipo por archivos. Los cortes siguientes son historial. [Plan](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9) y [Tests pendientes](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26) registran cambios y límites.
- Marcadores reconciliados por ID y propiedades mutables, sin recreación de puntos estables; agrupación con umbrales 300/180, transición de overview 85/70 km y conservación de centro/revisión de capa. Invalidación aborta inmediatamente cobertura y detalle para impedir respuestas antiguas. Sin SQL ni migración nueva.
- Inicio conserva imagen completa 16:9, abre `/mapa` al tocar, sin franjas/pie/flecha y con ubicación independiente superpuesta. Buscar elimina preview/snapshot y accede a ubicación dentro de Filtros, conservando borrador y foco con un modal activo. Panel permanente de puntos retirado, alternativa accesible al foco. Hoja crema y tarjetas grises existentes; cierre, drag, paginación y safe areas conservados.
- **162 controles locales PASS/exit0:** marcadores12+24, agrupación4, caché17, mapa69, preview14 y filtros22. TypeScript exit0; lint completo exit0/61 warnings preexistentes, dirigido exit0/0 errores/2 warnings existentes. Audit exit0/2 moderadas, ninguna alta/crítica. Revisión independiente en dos rondas: tres approve, hallazgos abiertos vacíos.
- Build configurado final exit0. Primera prueba de contenido local falló por configuración ausente en este checkout; se cargó la configuración existente únicamente en memoria y se recompiló, sin modificar el checkout original. API del candidato127.0.0.1 exit0/7PASS/0SKIP/43elegibles/20lecturas anónimas. Chrome real393px exit0/3PASS: previewApple1280×720 completo, Buscar sin snapshot/selector único y grupo35/28 con tarjetas reales/cierre/foco. Smoke local7/8exit1: solo canonical esperado de producción difiere (`http://localhost:3000/privacidad`), por configuración local. Push autorizado; CI/Vercel y smoke del dominio real se comprobarán después del push.
- [Acta S12](docs/S12-MAPA-FLUIDO-2026-10-01.md) contiene evidencia y alcance. Quedan pendientes aceptación táctil y ausencia de parpadeo físico en Safari/iPhone/Android, accesibilidad física, métricas p95/heap, escenarios autenticados, tipos completos/PAT y PostGIS100k previamente abiertos. Las pruebas con SDK controlado no acreditan fluidez física.

## 2026-10-01 — S12: plan tras revisión visual de Javier

- **Codex, familia GPT-6. Estado: plan documentado; implementación pendiente.** Revisión de cuatro capturas y código base `fec6ae490d10f92de62813ad0839d2ad21315a6d`, con Workflow Advisor y dos agentes de revisión solo lectura. S11 recibió revisión visual y requiere correcciones; las entregas anteriores se conservan como historial.
- [Plan S12 en Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263): conservar marcadores por ID, estabilizar agrupación y transiciones de cobertura; Inicio sin franjas/pie/flecha, apertura al tocar y ubicación superpuesta independiente; Buscar sin preview y ubicación dentro de Filtros; retirar panel visible Puntos del mapa con acceso accesible; hoja crema con tarjetas grises existentes.
- Diagnóstico confirmado por código: `publication-map.tsx` elimina/recrea todas las anotaciones al cambiar features/selección/tema; la cámara recalcula features aun con caché vigente. Agrupación y cambio de cobertura pueden añadir saltos. El parpadeo físico requiere correlación con MapKit real; no se atribuye automáticamente a consultas nuevas. Franjas: altura fija/object-contain/fondo gris y pie del preview.
- [Tests pendientes](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26) ampliados con identidad de anotaciones, 20 pan/zoom y red por separado, transiciones/privacidad, móvil real, preview/ubicación, Buscar sin snapshots, accesibilidad y hoja. Todos los criterios S12 siguen pendientes; pruebas S11 no acreditan S12.
- Plan, Diseño y [Bitácora](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9) alineados. Al iniciar implementación se anotará cada cambio, archivos, motivo y evidencia de pruebas. Este corte solo modifica documentación: sin cambios de aplicación, DB, commit ni push.

## 2026-10-01 — S11 entregado para revisión de Javier

- **Codex, familia GPT-6.** Push sin fuerza confirmado a master `2a0598624d567fd8c2acb60d035ed3960de93de9`; código de aplicación `19c7903`. Cuatro controles CI success y Vercel `14abijk8b6BfknN19z6eDqmqUiQs` success, Deployment has completed. [Mapa publicado](https://vicinomarket.com/mapa).
- Producción: `S11_BASE_URL=https://vicinomarket.com node node_modules/tsx/dist/cli.mjs scripts/test-s11-map-http.ts` (variable de proceso en PowerShell), **exit0,7PASS,0SKIP,43 elegibles,20 lecturas anónimas**; `node scripts/smoke-produccion.mjs`, **exit0,8/8**. Migración instalada/auditoría8/8; build y123pruebas previas aprobados, más100k local aislado.
- Navegador real, ancho393: Inicio sin hero/buscador y previewMéxico; Buscar43resultados/3páginas. Home→Buscar misma imagen Apple PNG1280x720/BlobURL, cargada; Cancelar filtroServicios conserva43 y URL. MapaMéxico43publicaciones/31vendedores; grupo35/28 abre30tarjetas paginadas reales por selector accesible. El control automatizado no permite tocar contenido MapKit en shadowroot cerrado; gesto físico sigue pendiente.
- CI mantiene advertencia **Tipos desfasados** pese a success. Regeneración completa: scriptCLI exit1, endpoint oficial read-only devuelve401 con PATconfigurado. No se extrajeron cookies ni se crearon/rotaron credenciales; archivo intacto. Contrato v2 manual validado por auditoría instalada y HTTP real. RenovarPAT y regenerar completo queda en [Tests pendientes](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26), junto a PostGIS100k bloqueado, cuentas/Form autenticado, hardware/gestos/20panzoom/p95/heap/cancelación/offline y aceptación visual.
- Este cierre documental no cambia aplicación ni DB. Conserva evidencia y límites de cada prueba. Reversión web: Instant Rollback a S10/revert S11, conservando DBaditiva/v1. Cortes anteriores son historial.

## 2026-10-01 — S11 instalado; integración real y revisión de entrega

- **Codex, familia GPT-6.** Continuación por Javier; push a master autorizado. Código local `19c79030cfc9691424ecd59020faea7a5da898c4`, con build final/123 pruebas previas aprobadas. Checkout original preservado.
- Migración `20261001020000_mapa_cobertura_cache` instalada en VICINO/main/PRODUCTION y registrada. SHA256 fuente BFA8FB09E4B35F395C745F1F753A9D17BC971E91EE0A385023D0421B76E4CF3F. Auditoría exclusivamente read-only: **8/8 PASS**; firmas, cuerpos, ledger, ACL/RLS, proyección y v1 compatibles. Se corrigieron paréntesis de CASE en el diagnóstico tras ERROR42601; fuente de migración intacta.
- Integración local Next→RPC instalada: `node node_modules/tsx/dist/cli.mjs scripts/test-s11-map-http.ts`, **exit0,7 PASS,0 SKIP,43 elegibles,20 lecturas anónimas**. Primer intento ECONNREFUSED por servidor detenido; reinicio y ejecución completa aprobada.
- Ensayo `scripts/test-s11-map-sql.ts --scale-100k` **local PGlite**, exit0,10/10PASS: 2025 celdas,7páginas,100000 publicaciones,2 vendedores distintos. Harness36379ms con sustitutos espaciales; no equivale a PostGIS/API/rendimiento físico. PostGIS100000 sigue pendiente tras rechazo automático de Run without RLS; no se eludió ni ejecutó.
- Apple/Mapa real local: 8publicaciones/3vendedores; grupo7publicaciones/2vendedores abre tarjetas reales. Escape devuelve foco al punto. Gesto nativo y aceptación física/autenticada siguen abiertos en [Tests pendientes](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26).
- Push sin fuerza, CI/Vercel y smoke de producción son los siguientes pasos. Los estados fechados anteriores se conservan como historial. Reversión: despliegue S10/revert S11, manteniendo RPC aditiva/v1.

## 2026-09-30 — S11 implementado localmente; instalación y entrega pendientes

- **Codex, familia GPT-6.** Inicio de implementación 19:51:06 CDMX por instrucción de Javier. Workflow Advisor y equipo por archivos; revisión independiente posterior. Continúa el [plan de Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263).
- Home/Buscar comparten preview estático temporal, México sin ubicación, selector en esquina y créditos libres. Home sin hero/buscador; Buscar con panel Filtros único, Aplicar/Cancelar, categorías/tipo/precios/orden/universidad. Editor abre el centro explícito del enlace sin cambiar la preferencia hasta Aplicar; GPS denegado conserva ubicación.
- Mapa con más espacio, filtros/ubicación únicos, superficies grises y selección negra accesible; lista permanente retirada. Un punto abre hoja animada, cursor 30, cierre X/Escape/Back/asa, foco sin teclado y revisión periódica de tarjetas. Radio del comprador se conserva en panel/selector.
- V02: ocultados círculo y control únicamente en el formulario; punto, búsqueda, zoom, arrastre, radio/default y contrato de guardado preservados. Otros pickers conservan su círculo por defecto. Texto de envíos/default de entrega queda para evaluación aparte.
- GEO v2 aditivo sobre proyección S10 (~1km): overview completo, precarga paginada 50km de celdas públicas y agrupación local. Zoom/pan dentro de cobertura no consulta; fuera se cambia cobertura/overview. Revisiones de resultados públicos y visor en cada snapshot; no tablas/triggers nuevos. Caché privada 10000 celdas/2MiB, LRU4/8MiB; TTL30s, checks31s/foco, cuotas y cancelación. Chat no invalida datos ajenos.
- Pruebas nuevas: SQL aislado **9/9**, API aislada **7/7**, cache **17/17**, preview **10/10**, filtros Chrome **21/21**, editor zona **4/4**, preview Chrome **7/7**, mapa Chrome **48/48**: **123/123 PASS**, exit0. SDK/proveedor/transporte simulados salvo PostGIS temporal: **10 checks PASS** con10003 fixtures+ROLLBACK; p95 de20checks SQL384.05ms, noHTTP/render.
- Build final después de CTA/créditos y NetworkOnly explícito **exit 0**, 57/57 páginas, TypeScript integrado. Lint completo **exit 0**, 0 errores y 149 warnings; tipos web/shared y diff check exit 0. Auditoría HIGH exit 0: 2 MODERATE, sin HIGH/CRITICAL. Apple PNG real y catálogo nacional de 42 comprobados en navegador local; Home→Buscar reutiliza la misma imagen temporal. Matriz 100000, HTTP v2 instalado y smoke de entrega pendientes. No declarar aceptación física ni autenticada por fixtures.
- Migración `20261001020000_mapa_cobertura_cache.sql` preparada, **no instalada**. Transacción revisable en SQL Editor VICINO/main/PRODUCTION; se solicitó aprobación específica. Autorización S10 anterior no se reutiliza para instalar otra RPC pública. Tipos v2 añadidos manualmente; validar firma real al instalar.
- Ensayo 100000 preparado en `scripts/sql/test-s11-map-100k-rollback.sql`, **no ejecutado**: revisión automática rechazó «Run without RLS». Se quitó TRUNCATE y se habilitó RLS explícito en las ocho tablas pg_temp; el editor mantiene advertencia y el nuevo intento también fue rechazado. Advertencia cancelada, sin cambios persistentes; se pidió autorización específica del ensayo. Scripts read-only de instalación/HTTP preparados y sintaxis/fingerprints locales validados, todavía sin integración v2 real.
- Push a master autorizado después de pruebas; **aún sin push**. Checkout original preservado, HEAD base local dafca09, remoto base1cbcb8b. Evidencia/cambios/incidencias en [DevLog](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9) y [acta S11 local](docs/S11-DESCUBRIMIENTO-MAPA-2026-09-30.md). Reversión web: Instant Rollback al despliegueS10/revertS11, conservando DBaditiva compatible.

## 2026-09-30 — S11 planificado: Inicio, Buscar y mapa simplificados

- **Sello: Codex, familia GPT-6.** Planificación iniciada en el primer corte verificable 19:13:32 CDMX. [PLAN-20260930-DESCUBRIMIENTO-MAPA en Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263). Estado **PLANEADO**; aplicación S11, migración nueva y entrega no iniciadas.
- Solicitud de Javier: preview con ubicación en Inicio/Buscar y México sin ubicación guardada; panel Filtros único; controles grises y selección negra; mapa mayor y publicaciones en hoja inferior solo al tocar un punto. El selector de ubicación al publicar permanece intacto.
- **Aclaración V02 de Javier:** evaluar también el círculo/radio del preview al crear publicación. Conservarlo solo como muestra útil de cobertura de entrega; si no sirve o confunde, ocultar únicamente el círculo y dejar el punto elegido, manteniendo búsqueda/zoom/arrastre y control de expansión oculto. El círculo actual usa delivery_radius_km (default 5 km, dato también usado por la ficha de envíos); preservar datos y contrato de guardado, evaluar aparte ese texto. Requisito y criterio añadidos al plan de Notion; no implementado todavía.
- Análisis paralelo mediante workflow-advisor: Home/Buscar, arquitectura geo/caché y tokens/hoja/accesibilidad. La flecha de Buscar solicita GPS y aplica 5 km por URL, sin guardar zona; su función se conservará en el selector único. MapKit ya mantiene instancia; las consultas por bounds y el vaciado de resultados explican el refresco de publicaciones.
- Propuesta: preview estático temporal compartido (snapshots también tienen cuota); overview completo y celdas públicas de aproximadamente 1 km precargadas progresivamente en 50 km, agrupación local, detalle paginado de 30 y contrato v2 compatible con proyección S10. Revisión coherente, límites de memoria/red, invalidación por visor y pruebas reales antes de implementar/aplicar.
- Base remota verificada por git ls-remote: master `1cbcb8b38dcc31b2d6eefb89310d4dae21d73056`; base local `dafca09`, rama `feat/s10-mapa-publicaciones-20260930`. Plan, propuesta ADR, diseño y aceptación futura documentados en páginas existentes de Notion. No hay pruebas nuevas de ejecución ni push en este turno; S10 sigue desplegado como antecedente.

## 2026-09-30 — S10 desplegado y verificado en producción

- **Sello: Codex, familia GPT-6. Corte 18:43:34 CDMX.** Master `1cbcb8b38dcc31b2d6eefb89310d4dae21d73056`, push sin fuerza confirmado. CI: cuatro controles success; Vercel `65hs6WixR74rkxszR3o1Fvs5FsmM`, Deployment has completed. [Mapa activo](https://vicinomarket.com/mapa), abierto en el navegador de la app.
- Verificación posterior: HTTP real anónimo 7/7 exit 0 (42 elegibles), smoke de producción 8/8 exit 0. Veinte lecturas API/red: p50 202 ms, p95 327 ms, máximo 606 ms; excluye render/SDK/teléfono físico. Apple real autorizado/cargado; vista inicial 7 publicaciones/2 vendedores y selección accesible desde tarjeta 6 resultados del punto.
- Aplicación `23a7bcb`, con Next/eslint-config-next 16.3.6 y brace-expansion resuelto 1.1.21. Build/49 pruebas locales/lint/audit HIGH/Gitleaks aprobados antes del push. Puntos públicos aproximados; coordenadas privadas protegidas. Solo control de expansión de radio oculto en el formulario, selector conservado.
- Aceptación restante: cuentas dedicadas y formulario autenticado, móviles físicos, gestos nativos del pin/expiración/offline, cancelación PostgREST y revisión de Javier. No se declara completa con mocks ni prueba anónima. Evidencia final en [acta web](docs/S10-ENTREGA-WEB-2026-09-30.md) y [DevLog](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9). Este cierre documental no modifica aplicación ni requiere otro despliegue de producción.

## 2026-09-30 — S10-W: entrega web autorizada y verificación final

- **Sello: Codex, familia GPT-6.** Inicio 17:54:49 CDMX. Javier autoriza push a producción después de las pruebas; resuelve el rechazo de exportación previo. `origin/master` sigue en `bd80379`. Se entregará sin fuerza y sin modificar el checkout original.
- La página/API/enlaces comparten activación por defecto; `NEXT_PUBLIC_VICINO_MAP_ENABLED=false` y rebuild permiten apagarla. La BD ya está instalada, no se reaplica. Solo se oculta el control de radio del formulario; selector y datos conservados.
- **Corte de pruebas 18:31:44 CDMX:** candidato de aplicación `23a7bcb`, pruebas locales 49/49 y HTTP real anónimo 7/7 con 42 elegibles, repetidas tras parches; smoke del build final 8/8. Build final Next 16.3.6 exit 0, 57/57 páginas, TypeScript integrado; lint completo exit 0 (0 errores/149 warnings existentes/generados). Gitleaks 8.28.0: 4 commits, sin fugas, exit 0. Auditoría HIGH exit 0, cero HIGH/CRITICAL (2 MODERATE). Next/eslint-config-next 16.3.6 y floor brace-expansion ^1.1.20 (resuelto 1.1.21) cierran avisos detectados antes del push. Apple real acreditado en el candidato; títulos corregidos. Entrega preparada y autorización Git comprobada por dry-run. El resultado de push/CI/producción se registra en el [DevLog vigente](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).
- Configuración local existente reutilizada por proceso, sin copiar/imprimir secretos ni incluir service_role. Su Redis no resuelve DNS: el limitador compartido entra en fail-open y el freno local permanece; no se acredita cuota global. No se cambiaron credenciales ni se provisionaron servicios.
- Pendientes de aceptación: cuentas dedicadas/bloqueos bajo sesiones HTTP reales, cancelación efectiva PostgREST, iPhone/Android físicos y revisión visual de Javier. Se distinguirán de verificación del despliegue y pruebas automatizadas.

## 2026-09-30 — S10-R: migración instalada en producción; entrega web pendiente

- **Sello: Codex, familia GPT-6.** Continuación desde 16:56:59 CDMX; corte de pruebas 17:30:42. Código `b57aa89`, base `bd80379`, misma rama y checkout aislado. El trabajo original se conserva.
- Acceso por dashboard de Supabase, VICINO/main PRODUCTION. Javier autorizó expresamente instalar `20260930220000`; COMMIT confirmado, ledger version/name/statements y recarga PostgREST. Proyección aproximada generada, GiST y RPC instalados. No se actualizaron puntos privados/radios ni se sembraron tablas públicas.
- PostGIS 3.3.7: 19 controles sintéticos PASS; matriz temporal 0/1/300/301/10 000 PASS, GiST confirmado por EXPLAIN. p95 de 20 llamadas SQL: 232.75 ms con 10 000 sintéticos y 5.00 ms sobre catálogo real instalado (42 elegibles). Permisos anon/authenticated, columnas privadas y RLS comprobados después del COMMIT. No incluye red/API/SDK ni equivale a sesiones reales dedicadas.
- Generador de transacción y SQL reproducibles añadidos. Acta/evidencia/incidencias: [S10-POSTGIS-2026-09-30.md](docs/S10-POSTGIS-2026-09-30.md) y DevLog de Notion. Capturas ignoradas en `apps/web/test-results/s10/`.
- Tipos regenerados desde dashboard (exportaciones idénticas); se mantienen Insert/Update `never` para la geometría generada. Único diff: orden/formato de la firma RPC. Type-check web exit 0. Auditoría final: checksum de ledger coincide, firma Json → Json, columna generada almacenada y ACL/RLS protegidos.
- **Pendientes al corte 17:48:55 CDMX:** entrega web, proveedor Apple/dominio real, sesiones/cuentas, cancelación efectiva PostgREST, iPhone/Android, aceptación y activación/rebuild. Flag apagada por defecto; BD instalada no acredita despliegue web. Acta/scripts iniciales en `2709563`. Revisión automática rechazó el push antes de ejecutarlo por falta de autorización explícita de exportar al repositorio; se solicitó y está pendiente. GitHub CLI tiene token vencido; no se confunde con este rechazo. No hay PR ni deployment nuevo.

## 2026-09-30 — S10: mapa implementado y validado localmente; integración remota pendiente

- **Sello: Codex, familia GPT-6 (variante no expuesta).** Inicio 15:41:15 CDMX; validación local final 16:30:59 (49 min 44 s). Base `bd80379`, rama `feat/s10-mapa-publicaciones-20260930`, checkout aislado `PROJECT-VICINO-S10`. El checkout original y sus cambios se conservaron.
- Nueva página `/mapa`: MapKit, búsqueda/categorías/tipo/precio, zona visible o centro/radio del comprador, grupos de publicaciones, tarjetas paginadas, ubicaciones aproximadas, cambio manual, GPS explícito y recuperación de errores. Enlaces Inicio/Buscar/menú sujetos a `NEXT_PUBLIC_VICINO_MAP_ENABLED=true`; apagado por defecto.
- Formulario: solo `showRadiusControl={false}` en DeliveryMap. LocationPicker conserva mapa, pin, búsqueda, arrastre, zoom, círculo, default y valor del radio. No se migraron ni borraron radios históricos.
- Migración local `20260930220000`: proyección pública generada a dos decimales y RPC por área, todos los candidatos agrupados, visibilidad/bloqueo bilateral y cursor por consulta/usuario. API sin service_role, cuerpo acotado, validación de entrada/salida, cuotas, timeout y no-store. No devuelve ubicación privada.
- **Verificación:** build final **exit 0**, 57/57 páginas, TypeScript integrado; shared type-check/lint exit 0; lint de archivos modificados 0 errores, 5 warnings preexistentes (nuevos módulos sin warnings). Contratos 5/5, SQL 12/12, API 6/6 y navegador 25/25: **48/48 pruebas locales/sintéticas**. SQL en PGlite con sustitutos espaciales point/box; SDK/red/cache de navegador simulados. No acreditan PostGIS, Apple Maps real ni dispositivos físicos.
- **Pendientes:** acceso Supabase (lectura administrativa dio 401), aplicar/validar migración en staging y permisos reales, EXPLAIN/p95 y cancelación SQL, proveedor Apple real, cuentas dedicadas y iPhone/Android, aceptación visual y activación/rebuild. No está desplegado. Tipos SQL añadidos manualmente; regenerarlos al aplicar la migración.
- Plan, decisiones, incidencias y cambios: [Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), [DevLog](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9), [Tests pendientes](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26). Capturas sintéticas no versionadas: `apps/web/test-results/s10/`.

Los estados anteriores se conservan como antecedentes.

## 2026-09-29 — N01/C01/V01 implementados, consolidados y auditados (VICTORY CONFIRMED)

- **Sello: Alejandro (Antigravity), ejecutor Gemini 3.8 Flash.** Rama `fix/navigation-chat-vender-20260929`, base `77465c7`. Regreso de comunidades por procedencia (N01, `a8b0159`), selector de vendedor previo a producto en chat (C01, `6b0342e`), apertura Vender con precarga acotada/feedback/loading (V01, `6722fb4`), y suite integral de verificación (R4, `23f33d8`).
- Build exit 0 (56/56 páginas); lint 0 errores; type-check 0 errores. Contratos 36/36; Next real Chromium/WebKit 14/14; S04-B 18/18; precarga 7/7; regresión navegación 23/23; pruebas adversarias independientes 60/60. Veredicto vinculante VICTORY CONFIRMED por Victory Auditor independiente tras Fase A, B y C.
- Pendientes: CI/entrega remota a master, medición antes/después con cuenta dedicada (20 frías y 20 calientes) y pase en dispositivos físicos (iPhone 1.1 build 6 y Android).
- Trabajo original y cambios anteriores conservados. Notion: [plan vigente](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), [Tests pendientes](https://app.notion.com/p/Tests-pendientes-3ea98e8a0cfa8124a5cee689a2345b26) y [DevLog](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).

## 2026-09-29 — H00–H03 desplegados (09:59 CDMX)

- **Sello: Alejandro (GPT)**. [PR #49](https://github.com/Peter-code-bot/PROJECT-VICINO/pull/49) integrado; master `77465c7`, Vercel producción confirmado y Security Audit verde.
- H01 responsive, H02 paginación/totales/errores y H03 retorno implementados. Datos 12/12, recorridos sintéticos 28/28, matriz responsive 96/96; build exit 0. Regresión PGRST103 corregida y fast-uri actualizado a 3.1.8 tras dos avisos HIGH del CI.
- Smoke sin sesión: login 200; historial, reseña y ventas 307 a login. Pendiente aceptación con cuentas reales dedicadas y dispositivos iPhone/Android; no se cierra el plan global.
- Trabajo original preservado. Sin migraciones/RLS. Este puntero de cierre es local; código entregado en f75f328 y a4fad14.
- Detalle, evidencia e incidencias: [DevLog de Notion](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).

## 2026-09-28 — H00–H03 entrega técnica (actualización 29-sep 09:47 CDMX)

- **Sello: Alejandro (GPT)**. H01 responsive, H02 paginación/totales/errores y H03 continuidad de reseñas implementados en `fix/historial-cierre-20260928`.
- Datos 12/12; recorridos sintéticos Chromium/WebKit 28/28; matriz con CSS/fuentes compiladas 96/96 sin fallos. Corrección final de PGRST103 con regresión reproducida y resuelta; build final exit 0 (56/56 páginas). Recorridos finales repetidos 28/28 exit 0.
- Pendientes de aceptación: integración autenticada y pase físico iPhone/Android. Entrega remota en preparación, todavía no desplegada. Sin migraciones/RLS. Trabajo del checkout original preservado.
- Evidencia y estado actualizado: [DevLog de Notion](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).

## 2026-09-28 — H00/H01 revisión independiente (20:35 CDMX)

- **Sello: Alejandro (GPT)**. Rama `fix/historial-cierre-20260928`, base `7337217`; antecedentes de S05 conservados debajo.
- H00/H01 **VALIDADOS LOCALMENTE**: build exit 0, suite reforzada 96/96 con CSS compilado y fuentes Inter/Outfit en Chromium/WebKit. Sin cambios adicionales de aplicación durante la revisión de la entrega de Gemini.
- Evidencia: `apps/web/test-results/historial/review-gpt-build-fonts-20260928/`; ejecución previa conservada en `after-gemini-20260928-2010/`.
- Pendientes: H02/H03, integración con cuentas y pase iPhone/Android. No desplegado ni cerrado en dispositivo.
- Fuente operativa y atribuciones: [DevLog de Notion](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).

## 27-sep (mediodía) — Corte de Claude (sesión de Pedro)

- En producción el 27-sep:
  - `6111f49`: «Cambiar ubicación» con palomita arriba y sin botón inferior (Tarea 8).
  - `e8e02c9`: «Cerrar sesión» y «Eliminar cuenta» juntas en «Sesión».
  - `5874496` + migración `20260927100000`: borrar la cuenta de quien dejó filas en `audit_log` ya no falla a medias. `delete-account` v14.
  - `send-push` v21 (globo real y limpieza de tokens UNREGISTERED).
  - `6b5fa5e`: pantalla «Activa las notificaciones» con el diseño aprobado.
  - `0aeb2a5` + migración `20260927110000` (BUG-VERIF-IA): la nota de la IA dice si es sobre estas fotos (`ai_vigente`, `ai_analizado_en`) y nadie revisa su propia solicitud (VC403). Tipos regenerados en `962e358`.
  - `29ba6ac`: «Volver» desde Mis publicaciones regresa ahí.
- Pruebas nuevas en staging:
  - `probar-verificacion-ia.mjs` 15/15.
  - `e2e-retorno-vender.mjs` 8/8, `e2e-favoritos.mjs` 7/7, `e2e-solicitudes.mjs` 9/9 (con `crearSolicitud()` en fixtures).
  - `e2e-header-fijo.mjs` ya no da OK sin datos.
- ADRs nuevos en Notion (02_Architecture_ADR → Decisiones): S04 + Realtime, verificación IA / VC403, S09-A y nota S05.
- Registro: `docs/PENDIENTES-2026-09-26.md` y la página de la jornada en Notion.

## 27-sep — Corte de Claude (sesión de Pedro): lo que ya no es cierto abajo

- **La retención de producción ya no existe.** Alejandro retiró el `ignoreCommand` en `6ee06be` (26-sep, 23:26 UTC). S04 (`20260925010000`) y Realtime (`20260926100000`) se aplicaron en prod hacia las 23:45 UTC. El script `hold-production-for-s04.mjs` se borró el 27-sep. Cada push a `master` despliega, así que las líneas de abajo que dicen "producción retenida" quedan superadas.
- En producción desde la noche del 26-sep:
  - `209caf7`: header móvil fijo.
  - `cdc6f96` + `5e14267`: Villahermosa y cobertura del buscador.
  - `c337ef7`: modo campus exclusivo (intersección, compañeros visibles pese a la RLS de `seller_verification` y fallo visible).
  - `cc385bc`: arranque en frío sin bucle y sin prefijos del token.
- Pruebas en prod: header 3/3 y Villahermosa 3/3. Campus 11/11 en staging.
- Revisión de todos los pendientes y 26 planes nuevos: `docs/planes-2026-09-26/`. Registro: `docs/PENDIENTES-2026-09-26.md`. DevLog: 01_DevLogs → `2026-09-26-noche-header-villahermosa-campus-y-pendientes`.

## 26-sep — Universidad para capturas (S09-A)

- Implementada la definición nueva de Notion §2.4.3: ficha Universidad en Home y opción en el selector de Búsqueda, con color institucional y destino `/buscar?category=universidad`.
- Universidad resuelta en servidor desde la credencial aprobada existente; mismo contrato en Home/Búsqueda. Filtra vendedores de esa institución con y sin ubicación; mantiene texto, orden y paginación. Sin pertenencia/no compañeros: no abre el catálogo completo. Fallos de consulta visibles.
- No cambia onboarding, modelo de credenciales, RLS ni esquema. S09 completo sigue pendiente; esta entrega cubre usuarios con universidad ya verificada.
- Build de producción exit 0 (incluye TypeScript). ESLint de los 8 archivos de producción: exit 0, 0 errores, 4 advertencias previas.
- `scripts/test-university.ts`: 20/20 escenarios; consultas reales con Auth/BD simulados y componentes reales en Chrome móvil/escritorio. Evidencias: `apps/web/test-results/university/`. No es prueba contra la BD remota ni capturas finales de iPhone.
- Integración conserva los commits nuevos de Pedro en master (Android y PT01). La corrección local equivalente de Favoritos queda respaldada por separado; prevalece la versión de Pedro.
- Producción sigue retenida por S04. Para ver estos cambios en la app/capturas hace falta un entorno que sirva esta versión; un push no equivale a desplegarla.

Actualizado: 26-sep-2026. Implementación y verificación técnica local completas.
Validación nativa/proveedor real e integración pendientes.

- Worktree PROJECT-VICINO-S05; rama de transferencia feat/ios-design-handoff-20260926; base 4b6be86.
- Conserva una copia de S01–S04 sin modificar sus worktrees.
- Cambiar ubicación mantiene su diseño y añade Aplicar ubicación (aprobado por Javier).
- Selección y radio en borrador; cancelación segura; zoom independiente; onboarding confirma al entrar.
- Preview protegido con errores diferenciados y reintento manual.
- 84 casos aprobados (10 API, 48 navegador, 12 regresiones Playwright, 14 sesión/geometría).
- Build final exit 0, 56/56 páginas, BUILD_ID Q9bhw3YqwnY671FM7855p; TypeScript correcto.
- Lint sin errores, un aviso previo en LocationPicker. SDK/GPS/red simulados en pruebas.
- Destino solicitado por Javier: master remoto. Consultar el SHA publicado y el acta de transferencia en Notion.
- Producción retenida mediante ignoreCommand de Vercel: REST confirmó que falta chats.producto_revision (42703). La consulta administrativa devolvió 401; no se aplicó ninguna migración remota.
- Retirar la retención solo después de aplicar/verificar S04 y comprobar chat/ventas. Subir código a master no acredita despliegue.
- Orden vigente: skills → brand book → piloto/alcance nativo → implementación por familias → verificación → TestFlight → App Store.
- En Mac: `node scripts/prepare-mac.mjs --install --sync-ios` usa pnpm fijado y no aplica migraciones ni sube builds.
- PGlite declarado en el lockfile; pruebas SQL sin carpeta temporal externa. Scripts S01/S03 resuelven dependencias desde apps/web.
- Seed local con datos de cuentas excluido de la transferencia; no es parte del release.
- Verificación de transferencia: build exit 0, BUILD_ID FOf4VxKdWSjklrtKO0bK5; tipos exit 0; SQL 21/21; Favoritos 17/17; escaneo de secretos sin hallazgos en los cambios.
- `prepare-mac.mjs` pasó revisión sintáctica; en Windows rechaza la preparación nativa. Ejecución macOS/Xcode pendiente.

Fuente operativa: [Plan en Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), S05/D01/D02-S05.
DevLog: entrada 2026-09-26-s05-mapas-confirmacion-y-preview en la
[Bitácora](https://app.notion.com/p/14a98e8a0cfa83eb9ef00133a04ec7fd).
