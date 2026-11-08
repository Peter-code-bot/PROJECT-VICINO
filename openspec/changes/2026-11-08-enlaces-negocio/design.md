# Design — Enlaces de contacto del negocio

## Flujo de datos

```
Editar perfil (profile-form.tsx)
  └─ FormData: ...campos del perfil + instagram_usuario, whatsapp_numero,
               google_maps_url, google_resenas_url
       └─ updateProfile (perfil/actions.ts)
            1. updateProfileSchema        → valida el perfil
            2. enlacesNegocioSchema       → normaliza y valida los enlaces (ANTES de escribir)
               (modo vendedor apagado → los cuatro en NULL: se quitan)
            3. rpc update_profile_and_pause_products
            4. rpc actualizar_enlaces_negocio   (solo si el form trae los campos)

Ficha /vendedor/[id] y /perfil
  └─ SELECT ... instagram_usuario, whatsapp_numero, google_maps_url, google_resenas_url
       └─ <EnlacesNegocio>  → listarEnlacesNegocio() arma href por proveedor
            └─ <a target=_blank> + registrarClicEnlaceNegocio() (Server Action, sin esperar)
               (Android + host *.google.com → Browser.open en vez de la navegacion)
                 └─ rpc registrar_clic_enlace_negocio(vendedor, canal)  → INSERT clics_enlaces_negocio

/seller/analytics
  └─ 4 × SELECT count(*) FROM clics_enlaces_negocio WHERE vendedor_id = yo AND canal = c AND created_at > now()-30d
```

## Tres capas de validacion, un solo patron

| Capa | Donde | Para que |
| --- | --- | --- |
| Cliente/servidor Next | `normalizar*` + `enlacesNegocioSchema` en `@vicino/shared` | Limpiar lo pegado (`@`, URL completa, espacios, `+`, `00`, mayusculas en el host) y dar el mensaje de su campo. |
| RPC | `actualizar_enlaces_negocio` | El mismo mensaje aunque alguien llame al RPC sin pasar por la app. |
| CHECK | `profiles_*_formato` | Ultima linea; sin mensaje amable, con garantia. |

El patron es identico en las tres: lista cerrada de hosts de Google, rechazo de segmentos
`..`/`%2e`/`\`, y una clase EXPLICITA de puntos de codigo prohibidos (controles, DEL,
espacios Unicode) en vez de `\s`, porque el `\s` de JavaScript y el de Postgres no cubren
el mismo conjunto. `whatsapp_numero` pide 11-15 digitos sin cero inicial: un numero local
de 10 digitos se rechaza con mensaje, no se le inventa la lada.

## Por que un RPC aparte

Ampliar `update_profile_and_pause_products` con cuatro parametros mas habria creado una
**sobrecarga** (CREATE OR REPLACE con otra aridad deja las dos firmas vivas y PostgREST
responde 300 ante la ambiguedad). Ademas los enlaces tienen reglas y mensajes propios.

Consecuencia aceptada: dos escrituras no atomicas. Si la segunda falla, el perfil ya quedo
guardado: se revalida igual y el mensaje lo dice ("Tu perfil se guardo, pero los enlaces
de tu negocio no. ..."), como ya hace el formulario con el `@` (`setUsername` +
`updateProfile`). Los codigos 22023 y el 42501 de "activa el modo vendedor" se muestran
tal cual (son del usuario); cualquier otro va a Sentry con un mensaje generico.

Proteccion contra clientes viejos: el RPC de enlaces solo se llama si el `FormData` **trae**
alguno de los cuatro campos (`formData.has`). Un formulario abierto antes del deploy no los
trae, y sin esa guarda los habria borrado.

Al reves que `nombre_negocio`, **apagar el modo vendedor quita los enlaces**: son columnas
publicas legibles por PostgREST aunque la ficha deje de pintarlas, y apagar el modo es la
unica puerta que le queda a un comercio que ya no vende (los campos solo se ven con el modo
encendido). El RPC permite poner los cuatro en NULL sin exigir `es_vendedor`; poner un
enlace si lo exige.

## Medir sin leer

`clics_enlaces_negocio` guarda `vendedor_id`, `canal`, `con_sesion`, `created_at`. No guarda
quien toco. Eso responde a "medicion del origen sin capturar el contenido de
conversaciones": sabemos cuantas personas abrieron cada canal desde la ficha, y nada mas.
Un clic no es un mensaje ni una venta, y la pantalla lo dice.

El RPC es ejecutable por `anon` (los invitados tambien tocan). Frenos:

- Server Action: `clicEnlaceRateLimit` 20/min por cubeta (Upstash). La cubeta es el id de
  usuario con sesion y, sin sesion, un resumen SHA-256 de la IP con la fecha del dia
  (`lib/perfil/cubeta-clic.ts`): Upstash nunca ve la IP en claro. El limitador va con
  `analytics: false`, porque la analitica de `@upstash/ratelimit` persiste cada
  identificador en Redis sin caducidad y eso contradiria la promesa.
- RPC: devuelve FALSE sin error si el dueno toca lo suyo, si el canal no esta configurado,
  si el perfil no es vendedor o esta oculto, si el negocio ya tiene 20 clics en el ultimo
  minuto o si la plataforma ya conto 5,000 en la ultima hora. Un `pg_advisory_xact_lock`
  por negocio serializa las llamadas concurrentes para que el tope no se pase en N. Sin
  error a proposito: la respuesta no debe servir para adivinar nada de un perfil. Los
  topes son la barrera real, porque la llave anon es publica; el precio es que la metrica
  es orientativa, no auditada, y la pantalla lo dice.
- Retencion: purga diaria a 90 dias con pg_cron (`purgar-clics-enlaces-negocio`), en la
  misma migracion, con indice en `created_at`. El job corre con los permisos de quien
  aplico la migracion (`postgres`, dueno de la tabla); VERIFY lo comprueba.
- RLS: el vendedor lee solo sus filas; nadie inserta, actualiza ni borra desde el cliente.
- La pantalla del vendedor cuenta con `count` por canal (head), no trayendo filas: PostgREST
  corta en 1,000 y el total saldria truncado en silencio. Un error de la consulta se
  reporta y se pinta "—", no cero.

## La resena de Google

Google prohibe incentivar resenas y pedirlas de forma selectiva ("selectively solicit
positive reviews", politica de contenido de Maps). VICINO ademas quiere que la resena de la
compra viva dentro de VICINO. Por eso:

- El enlace se guarda tal cual lo genera Google (`g.page/r/<id>/review`, la forma antigua
  `g.page/<nombre>/review`, o `search.google.com/local/writereview?placeid=`), nada mas.
- Se ofrece **solo** a quien tiene una `sale_confirmations` en `completed` con ese negocio.
  Sin premio, sin filtro por calificacion, sin pedirla antes de una experiencia real.
- El dueno lo ve para comprobar que abre; sus clics no cuentan.
- Es una regla de PANTALLA: la columna es publica como las otras tres (y el enlace ya es
  publico en Google). Lo que se protege es no pedir la resena a cualquiera.

## Como se abren en la app nativa

`<a target="_blank" rel="noopener noreferrer nofollow ugc">`. Capacitor pasa al sistema la
navegacion a cualquier host que no este en `server.allowNavigation` (Android:
`Bridge.launchIntent` → `Intent.ACTION_VIEW`; iOS: `UIApplication.open`), y el sistema abre la
app del canal si esta instalada o el navegador si no. Android no soporta ventanas
multiples en el WebView, asi que `target=_blank` se trata como navegacion de nivel superior
y pasa por ese mismo camino.

La trampa: `capacitor.config.ts` lleva `*.google.com` en `allowNavigation` por el OAuth, y
en Android esa mascara casa `www.google.com`, `maps.google.com` y `search.google.com`
(`google.com` a secas y `*.google.com.mx` no). Un enlace de Maps copiado del navegador o el
de resenas de `search.google.com` cargaria la web de Google encima de la ficha. Para esos
hosts, y solo en Android, el componente hace `preventDefault` y abre con
`@capacitor/browser` (ya en el binario publicado; lo usa el OAuth nativo y Wallet). iOS abre
con `UIApplication.open` aunque el host este en la lista (`createWebViewWith`). Se descarto
`window.open(url, "_system")` (sin cordova-plugin-inappbrowser `_system` es solo un nombre de
ventana) y `@capacitor/app-launcher` para hoy (plugin nuevo = `cap sync` = AAB nuevo); queda
como opcion para el siguiente AAB, igual que quitar `*.google.com` de `allowNavigation`.
**Todo esto esta sostenido por lectura del codigo de Capacitor 8; queda por comprobar en
dispositivos fisicos.**

## Privacidad

- `telefono` sigue sin salir de la ficha publica; `whatsapp_numero` es un dato distinto,
  que el vendedor pone a sabiendas de que es publico (el formulario lo dice) y que puede
  retirar vaciando el campo o apagando el modo vendedor.
- El texto prellenado de WhatsApp no lleva nada de la persona.
- `rel="nofollow ugc"`: el destino lo escribe el vendedor.
- `whatsapp_numero` y las URL son legibles por `anon` via PostgREST (filtrables y
  paginables): son datos publicos y raspables, y el formulario lo dice.
- Clics: nada de quien toco en la base; IP solo como resumen con fecha en la cubeta del
  freno, sin analitica. Retencion 90 dias; el unico dato temporal es `created_at`.
- Hallazgo colateral, fuera de esta rama: los demas limitadores del repo llevan
  `analytics: true` y persisten IPs e ids de usuario por hora en Upstash sin caducidad.

## Pruebas

- `apps/web/lib/perfil/enlaces-negocio.test.ts` (12): normalizadores, lista cerrada de
  hosts, segmentos `..`, caracteres prohibidos, armado de URL, orden de la lista y el
  esquema (dominios ajenos, `javascript:`, numero sin lada).
- `apps/web/lib/perfil/abrir-enlace-externo.test.ts` (3): la mascara `*.google.com` de
  Android, host por host; iOS y web nunca interceptan.
- `apps/web/app/actions/enlaces-negocio.test.ts` (6): la Server Action con `cargarReal`
  (cubeta por usuario o resumen de IP, entrada invalida, freno cerrado, error del RPC a
  Sentry, y que el RPC no recibe nada de quien toca).
- `apps/web/app/(marketplace)/perfil/actions.enlaces.test.ts` (7): el tramo de enlaces de
  `updateProfile` (orden de los RPC, valores normalizados, un enlace malo frena todo, form
  viejo no borra, modo vendedor apagado quita, 22023/42501 y Sentry).
- SQL: bloque VERIFY al final de la migracion, con la prueba bajo `SET LOCAL ROLE` y las
  comprobaciones del job de pg_cron y del dueno de la tabla.
- Dispositivo: matriz por host en `docs/ENLACES-NEGOCIO-2026-11-08.md`.

## Riesgos

| Riesgo | Mitigacion |
| --- | --- |
| Un vendedor pega su numero local de 10 digitos. | Se rechaza con mensaje ("52 y tus 10 digitos"); no se inventa la lada. Si duele, aceptar 10 con confirmacion explicita. |
| Enlaces a sitios ajenos en una columna publica. | CHECK + RPC acotan a https y a una lista CERRADA de hosts de Google (nada de `google.<tld>` abierto), y rechazan segmentos `..`/`%2e`/`\` y caracteres de control. Instagram y WhatsApp se arman, no se guardan. Queda `maps.google.com/url?q=` si Google redirigiera: fuera de nuestro control. |
| Inflar o saturar clics (la llave anon es publica). | Freno por cubeta en la accion; en el RPC, lock por negocio, 20/min por negocio y 5,000/h global; dueno excluido; purga a 90 dias. La metrica se declara orientativa. |
| El WebView carga la web de Google encima de la ficha (Android, hosts `*.google.com`). | `Browser.open` para esos hosts; probar en fisico; en el siguiente AAB quitar `*.google.com` de `allowNavigation` o adoptar `@capacitor/app-launcher`. |
| El freno guarda la IP de quien toca. | Resumen con fecha en vez de IP y `analytics: false`. Los demas limitadores siguen como estaban (hallazgo aparte). |
| Tipos editados a mano divergen del generador. | `node scripts/gen-types.mjs` tras aplicar la migracion; CI avisa. |
