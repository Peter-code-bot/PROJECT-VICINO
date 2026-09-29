# Dev Log — 16 de septiembre de 2026

**Proyecto:** VICINO
**Rama:** `master`, desplegada en producción (`vicinomarket.com`)
**Punta al cerrar la jornada:** `afb7c6e`
**Estado:** cerrado y verificado en producción

---

## Resumen

Se cerraron tres áreas del plan de implementación integral: verificación de identidad, notificaciones, y el detalle de solicitud con los filtros unificados. Salió en tres commits más un merge con el rediseño visual que venía en paralelo.

Lo importante de la jornada no fue lo que se construyó, sino lo que la revisión adversarial encontró en lo recién construido: **diez fallos críticos, todos cerrados antes del push.** Varios existían desde antes y nadie los había visto.

| Métrica | Valor |
| --- | --- |
| Commits propios | 3 (+1 merge) |
| Archivos tocados | 36 |
| Líneas | +6 927 / −992 |
| Archivos nuevos | 20 |
| Migraciones aplicadas | 3 |
| Fallos críticos cerrados | 10 |
| Casos de prueba nuevos | 29 |

Commits: `b670bba` (verificación), `9f1ab8d` (notificaciones), `513edc3` (solicitudes y filtros), `afb7c6e` (merge).

---

## Lo que se construyó

### Área III — Verificación de identidad

- **Los datos se bloquean tras subir.** Cambiar el tipo de documento o la universidad con fotos ya subidas abre una confirmación; al aceptar se descartan las tres imágenes y el trámite vuelve a revisión. Antes cambiaba en silencio y el trámite quedaba incoherente.
- **El aviso de privacidad se abre encima.** Era un enlace que navegaba fuera, y los archivos elegidos en un campo de archivo no sobreviven a una navegación: volver significaba repetir las tres fotos. El texto legal se extrajo a un componente que leen los dos sitios, la página y el modal. Copiarlo habría dejado a alguien aceptando una versión distinta de la publicada, y un aviso desincronizado no acredita nada.
- **El motor de IA ahora sí coteja.** Recibía UNA ruta y se disparaba al subir el frente, así que el modelo nunca veía la selfie ni el reverso: era imposible que comparara caras, aunque el panel presentara su respuesta como si lo hubiera hecho. Ahora las tres imágenes van en una sola llamada.
- **Miniaturas y visor en el panel de admin.** Los tres enlaces «Ver imagen» abrían el navegador del sistema desde el APK, o sea que sacaban al revisor de la app.
- **Rechazar funciona.** Fallaba el 100 % de las veces.

### Área IV — Notificaciones

- **Pantalla de preferencias** arriba de «Editar perfil», con cuatro tipos.
- **Paso de permiso en el alta**, con el valor explicado antes del diálogo del sistema. El hook dejó de pedir el permiso en silencio al arrancar: en iOS negarlo es definitivo, y un permiso que aparece sin explicación se niega. El arranque silencioso no ganaba permisos, los quemaba.
- **Auditoría del push** con matriz de prioridades y la causa estructural: no existe ningún disparador de push sobre la tabla de notificaciones, así que varios eventos sólo llenan la campana.

### Detalle de solicitud y filtros

- La categoría se apoya en la **esquina inferior derecha de la foto**, sobresaliendo 10 px, con fondo opaco propio para que se lea sobre una foto clara.
- El presupuesto es **texto**, en el color principal. Ni verde ni con forma de botón.
- Los dos carruseles de categorías pasan a un botón que abre una **cuadrícula con todas a la vez**, sin bordes rígidos. En el carrusel, las categorías del final no existían para quien no arrastraba, y arrastrar en móvil competía con el gesto de cambiar de pestaña.

---

## Lo que encontró la revisión adversarial

Tres revisiones independientes, una por área. Diez críticos, todos cerrados. Los seis que vale la pena registrar:

### 1. La evidencia se podía suplantar

Las rutas de las imágenes venían del cliente y sólo se comprobaba que empezaran por el identificador de quien llamaba. La policy del bucket permite **cualquier nombre** bajo el propio prefijo, así que la secuencia era:

1. Subir por el formulario los documentos que ve el moderador.
2. Subir aparte, con la consola, otro juego de fotos que sí casan entre sí.
3. Llamar a la acción con esas otras rutas.

El modelo analizaba unas imágenes y el panel enseñaba otras, con el cartel de que la IA lo aprobaba encima. Es fabricar la evidencia con la que decide el revisor, que es peor que forzar el estado porque no deja huella. Variante más barata: pasar la misma ruta como selfie y como frente hacía que el cotejo comparara la foto del documento consigo misma, o sea 100 % de coincidencia gratis.

**Arreglo:** las rutas salen de la fila, no del cliente. Se analiza exactamente lo que el moderador va a ver.

### 2. Un rechazo automático le bastaba una corazonada

Sólo uno de los cinco caminos a «rechazado» exigía confianza mínima. Una respuesta con 35 % de confianza en el cotejo de rostro, y con el propio modelo pidiendo revisión humana, rechazaba igual.

Y un rechazo es en la práctica **irreversible**: «rechazado» es un estado resuelto, así que el cron de purga borra las tres imágenes en menos de una hora y la cola del panel sólo lista «pendiente». Ni el admin lo ve, ni quedan documentos que revisar.

**Arreglo:** los cinco caminos piden un hallazgo fundado. Si el frente no se lee, «no es una credencial válida» y «el nombre no coincide» no pueden ser evidencia de nada: son consecuencia de no ver.

### 3. Rechazar no funcionaba, el 100 % de las veces

El panel hacía una escritura directa sobre `status`, `reviewed_at` y `reviewer_note`. Una migración de agosto revocó la escritura de tabla al rol de usuario autenticado y devolvió el privilegio sólo a siete columnas; `reviewed_at` y `reviewer_note` no están entre ellas **a propósito**, porque son el veredicto.

Un admin es el rol autenticado ante Postgres —lo que le da poder es una policy, que es seguridad de fila, no un privilegio— y **un privilegio ausente se comprueba antes que cualquier policy**. De ahí que aprobar sí funcionara: pasa por una función con privilegios del propietario. Rechazar no tenía equivalente, y el admin leía un «permiso denegado» crudo debajo del botón de confirmar.

**Arreglo:** una función de rechazo atómico, espejo de la de aprobar.

### 4. La insignia de verificado era asimétrica

Dos fallos con la misma raíz:

- Aprobar sumaba 30 puntos de confianza **sin mirar si el perfil ya estaba verificado**.
- El vendedor puede devolver su propia verificación a «pendiente» desde su pantalla, porque borrar una foto lo hace y la policy de la tabla lo exige.

O sea que el ciclo aprobar → pendiente → aprobar era repetible y **regalaba 30 puntos cada vuelta**, con los rankings en producción ordenando por eso. Y al volver a pendiente nadie retiraba nada: quedaba un perfil que decía «identidad verificada» con cero documentos.

**Arreglo:** la invariante vive en la base, no en cada escritor. Hay tres que mueven ese estado —el panel, el vendedor y la revisión automática— y escribirla en cada uno garantizaba que el cuarto se olvidara.

### 5. Inyección de prompt por el nombre de la universidad

El valor se interpolaba entre comillas dentro del texto que lee el modelo. Un nombre con un salto de línea y una comilla cerraba la sección de datos y podía dictar la respuesta entera, incluido el cotejo facial, que es lo que da la insignia.

**Arreglo:** los datos de la cuenta van serializados, con cota de forma en el valor y una instrucción explícita de que su contenido es un valor y nunca una orden.

### 6. La pantalla de notificaciones prometía un control que el backend no ejercía

La función de push construía el mensaje leyendo sólo el token y el nombre. Apagar «Mensajes de chat» no apagaba nada, y la función de base de datos creada justo para consultarlo no tenía un solo llamador.

**Arreglo:** la consulta, y falla **abierto** si no la puede leer. Un sistema de preferencias que se traga el mensaje de quien quiere comprarte hace más daño que un aviso de más.

### Los otros cuatro, en una línea

- **Carrera con el revisor:** el análisis tarda hasta 28 s y escribía sin mirar el estado, así que si un admin aprobaba en esa ventana la escritura ponía «rechazado» dejando el perfil verificado.
- **Se escribía en todas las filas del historial:** el identificador de usuario no es único en esa tabla, así que subir una foto resucitaba en la cola un rechazo viejo con su nota de revisión, que el admin no puede limpiar.
- **La pantalla podía mentir para siempre:** si fallaba el borrado del bucket, las tarjetas seguían diciendo «Subido correctamente» sobre una fila vacía.
- **El token de push dejaba de refrescarse** tras cerrar y volver a entrar en la misma sesión de app, porque el regreso es una navegación blanda.

---

## Base de datos

Tres migraciones, aplicadas y verificadas contra producción.

| Migración | Qué hace |
| --- | --- |
| `20260916170000_rechazo_de_verificacion_atomico` | La función que faltaba para poder rechazar. |
| `20260916180000_preferencias_de_notificaciones` | Columna de preferencias en perfiles, su privilegio por columna, y dos funciones: una para escribir y otra para que el push lea la preferencia. |
| `20260916190000_insignia_de_verificacion_simetrica` | Disparador que retira insignia, puntos y nivel cuando una verificación deja de estar aprobada, y aprobación idempotente en los puntos. |

Dos decisiones que conviene no revertir:

- **Las preferencias son una columna de tipo JSON, no una columna booleana por tipo.** En la tabla de perfiles los privilegios van columna por columna, así que cada columna nueva cuesta una migración y su privilegio, y un privilegio olvidado rompe **todo** lectura que la nombre. Es la causa recurrente de incidentes de este repo. Con JSON, añadir un tipo es añadir una clave. Se paga con que la base valida forma y no contenido, y eso es deliberado.
- **Clave ausente significa encendido.** Ningún perfil existente necesita relleno y un tipo nuevo nace encendido sin backfill. Falla abierto a propósito.

---

## Verificación

- Comprobación de tipos, linter y build en verde, antes y después del merge.
- **85 casos** en cinco suites de node, más el validador de producto.
- **64 casos** de la suite de fases de Playwright.
- **6 casos nuevos** de Playwright en los dos viewports que exige la regla del repo (375×812 y 1280×800). Uno comprueba que la preferencia sobrevive a una recarga, que es lo único que demuestra que la escritura llegó a la base y no sólo que el optimismo pintó.
- **26 casos** del veredicto de verificación, y se comprobó que tienen dientes: **4 de los 26 fallan contra la versión anterior** del código.
- La invariante de la insignia se probó **contra producción dentro de una transacción que aborta**: 4 de 4 casos, incluida la idempotencia de la resta, sin dejar rastro en el registro de migraciones ni en los datos.
- Smoke de producción tras el despliegue: **8 de 8**.
- Medido en el navegador sobre producción: la etiqueta de categoría sobresale exactamente **10 px** del borde de la foto, y el color del presupuesto es idéntico al del título.

---

## Pendientes al cerrar

1. **Desplegar la función de push.** El código ya respeta la preferencia, pero esa función no se despliega con el push a master. Hasta entonces los interruptores de chat y ventas se guardan y no se respetan.
2. **Definir la clave de seguridad del panel en Vercel.** Sin esa variable, el diálogo de seguridad no deja cambiar ningún rol.
3. **La subida al bucket no comprueba el consentimiento biométrico.** El único guardia es la casilla del formulario, que se salta con la consola abierta. El servidor sí lo exige antes de analizar, así que nada se procesa sin consentimiento, pero la selfie puede llegar al bucket sin él. Cerrarlo es una policy nueva y antes hay que comprobar en qué orden se registra el consentimiento, o rompe el alta.
4. **La aprobación automática por IA nace apagada.** Un aprobado por ese camino no reparte insignia ni puntos, y hace que el cron borre los documentos y saque la fila de la cola: nadie podría arreglarlo después.
5. **Dependencia muerta de un proveedor de IA que no se usa.** El proveedor real es OpenAI; ya se corrigió la etiqueta del panel, que nombraba al otro.
6. **Un perfil aprobado sin insignia en producción**, anterior a esta jornada. Conviene saber por qué quedó así antes de fiarse del contador.

---

## Lecciones

1. **La revisión adversarial paga.** Diez críticos en código que ya pasaba comprobación de tipos, linter y build. Los tres peores eran razonamientos sobre lo que el sistema permite, no errores de sintaxis: ninguna lectura amable del diff los habría encontrado.
2. **Una invariante con varios escritores va en la base.** La insignia tenía tres escritores y la regla no estaba en ninguno.
3. **Lo delicado tiene que poder probarse.** La decisión del veredicto vivía dentro de un módulo de servidor, donde toda exportación es un endpoint público y una que no sea asíncrona es un error en ejecución: no había forma de exportarla para probarla. Se extrajo a su propio módulo y pasó de cero casos a 26.
4. **Un clic de prueba anterior a la hidratación se pierde en silencio** y la prueba lee el valor del servidor sin que nada falle. Da rojos falsos que parecen fallos de producto. Hace falta una marca de «listo» que ponga el cliente.
5. **Si la prueba no falla contra la versión anterior, no está probando el arreglo.** Se comprobó a propósito.
