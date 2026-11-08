# Enlaces de contacto del negocio — 8-nov-2026

> Rama `feat/enlaces-negocio-20261108` sobre `master` `192876f`. Change OpenSpec:
> `openspec/changes/2026-11-08-enlaces-negocio/`. Primera entrega del pendiente
> INT-CRM-20261104 (contacto, redes y resenas por negocio).

Cada negocio puede enlazar desde su ficha publica los canales que ya tiene fuera de
VICINO: su Instagram, su WhatsApp, su ficha de Google Maps y el enlace oficial para
dejarle una resena en Google. Son enlaces **salientes**: VICINO no lee ni sincroniza
mensajes ni resenas de ningun proveedor. Lo unico que se mide es cuantas veces se abre
cada enlace desde la ficha, sin saber quien lo abrio.

## Que ve cada quien

| Donde | Quien | Que |
| --- | --- | --- |
| `/perfil/editar`, bloque Modo Vendedor | El vendedor | Cuatro campos opcionales: Instagram, WhatsApp, Google Maps, Resenas Google. Vacio = quitar. **Apagar el modo vendedor quita los cuatro** (son datos publicos). |
| `/vendedor/[id]` | Cualquiera (invitado o con sesion) | Botones Instagram, WhatsApp y Google Maps, debajo de la zona. |
| `/vendedor/[id]` | Quien ya le compro a ese negocio (una `sale_confirmations` en `completed`) | Ademas, el boton "Resena en Google". |
| `/perfil` | El dueno | Los mismos botones, incluida la resena, para comprobar que abren. Sus clics no se cuentan. |
| `/seller/analytics` | El vendedor | "Clics a tus enlaces (ultimos 30 dias)", por canal, con la aclaracion de que un clic no es un mensaje ni una venta y de que el conteo es orientativo. |

## Donde esta cada cosa

| Pieza | Archivo |
| --- | --- |
| Normalizadores, patrones y armado de URL | `packages/shared/src/utils/enlaces-negocio.ts` |
| Esquema Zod `enlacesNegocioSchema` | `packages/shared/src/validators/profile.ts` |
| Migracion (columnas, CHECK, grants, 2 RPC, tabla de clics, RLS, purga) | `supabase/migrations/20261108120000_enlaces_de_contacto_del_negocio.sql` |
| Guardado desde el formulario (segundo RPC tras el del perfil) | `apps/web/app/(marketplace)/perfil/actions.ts` |
| Campos del formulario y aviso de desactivacion | `apps/web/app/(marketplace)/perfil/profile-form.tsx` |
| Botones de la ficha (con la excepcion de Android) | `apps/web/components/profile/enlaces-negocio.tsx`, `apps/web/lib/perfil/abrir-enlace-externo.ts` |
| Hueco `enlacesNegocio` en la cabecera | `apps/web/app/(marketplace)/perfil/profile-header.tsx` |
| Ficha publica (SELECT + regla de la resena) | `apps/web/app/(marketplace)/vendedor/[id]/page.tsx` |
| Perfil propio (SELECT del nucleo y render) | `apps/web/lib/profile-session-data.ts`, `apps/web/app/(marketplace)/perfil/profile-session.tsx` |
| Server Action que cuenta el clic y su cubeta de freno | `apps/web/app/actions/enlaces-negocio.ts`, `apps/web/lib/perfil/cubeta-clic.ts` |
| Freno por usuario/IP del clic (sin analitica) | `apps/web/lib/rate-limit.ts` (`clicEnlaceRateLimit`) |
| Tarjeta de clics | `apps/web/app/seller/analytics/page.tsx` |
| Tipos de la base (editados a mano; ver abajo) | `apps/web/types/database.types.ts` |
| Pruebas (28 casos) | `apps/web/lib/perfil/enlaces-negocio.test.ts` (12), `apps/web/lib/perfil/abrir-enlace-externo.test.ts` (3), `apps/web/app/actions/enlaces-negocio.test.ts` (6), `apps/web/app/(marketplace)/perfil/actions.enlaces.test.ts` (7) |

## Formatos, con su fuente

| Canal | Lo que se guarda | Lo que se abre | Fuente |
| --- | --- | --- | --- |
| Instagram | `instagram_usuario`: solo el usuario, en minusculas, 1-30 caracteres, letras/numeros/`_`/`.` sin punto final ni dos seguidos. Se acepta pegado con `@` o con la URL completa. | `https://www.instagram.com/<usuario>/` | Formato de perfil publico de Instagram (el Centro de ayuda no se pudo leer por script; queda como convencion conocida). |
| WhatsApp | `whatsapp_numero`: solo digitos, formato internacional, **11-15 digitos**, sin `+`, ceros, parentesis ni guiones. Un numero local de 10 digitos se **rechaza con mensaje**: no se rellena la lada (seria inventar un dato) y el formulario la pide en voz alta ("52 y tus 10 digitos"). | `https://wa.me/<numero>?text=<mensaje codificado>`. El mensaje ("Hola, vi tu negocio en VICINO y me interesa.") le dice al negocio de donde viene la persona. | faq.whatsapp.com/5913398998672934: "No incluyas ceros, parentesis ni guiones"; `?text=` debe ir URL-encoded. |
| Google Maps | `google_maps_url`: la URL que el vendedor copia de Maps (Compartir), acotada a `https` y a una lista CERRADA de hosts: `google.com(.mx)/maps`, `maps.google.com(.mx)`, `maps.app.goo.gl`, `goo.gl/maps`, `g.page`. Sin segmentos `.`/`..` (ni `%2e`) ni `\` en la ruta, y sin caracteres de control ni espacios Unicode (lista explicita, identica en JS y en Postgres). Maximo 500. | La misma URL. Con la app de Maps instalada, la abre la app (ver la excepcion de Android abajo). | developers.google.com/maps/documentation/urls/get-started: sin API key; `api=1` obligatorio en las URL construidas; URLs limitadas a 2,048 caracteres. |
| Resenas de Google | `google_resenas_url`: solo `https://g.page/r/<id>/review` (la forma actual), `https://g.page/<nombre>/review` (la antigua, con o sin `/` final) o `https://search.google.com/local/writereview?placeid=<id>`. Maximo 300. | La misma URL, solo tras una compra completada. | support.google.com/business/answer/3474122 y /contributionpolicy/answer/7400114: prohibido ofrecer incentivos y "selectively solicit positive reviews". Por eso no hay premio, no hay filtro por nota y no se pide a cualquiera. |

Los mismos patrones viven tres veces a proposito: en `@vicino/shared` (mensaje amable
antes de mandar), en el RPC (mensaje amable aunque alguien salte el cliente) y en los CHECK
(ultima linea). Si uno cambia, cambian los tres. La clase de caracteres prohibidos es una
lista explicita de puntos de codigo y no `\s`, porque el `\s` de JavaScript y el de
Postgres no cubren el mismo conjunto (U+0085, y en Postgres depende del locale).

## Base de datos

- Cuatro columnas nuevas en `profiles`, con `GRANT SELECT` a `anon` y `authenticated`
  (la ficha se sirve a invitados). **Sin INSERT ni UPDATE por columna**: solo las escribe
  `actualizar_enlaces_negocio()`. Poner un enlace exige sesion y `es_vendedor = TRUE`;
  quitarlos (los cuatro en NULL) se permite siempre, para que un comercio que dejo de
  vender pueda retirar su numero sin volver a activar nada. Cada parametro en NULL o
  vacio borra ese enlace.
- Va en un RPC aparte y no en `update_profile_and_pause_products` porque ampliar esa firma
  crearia una sobrecarga (PostgREST 300) y porque los enlaces tienen sus reglas y mensajes.
  El formulario llama a los dos, en ese orden; si el segundo falla, lo dice sin ocultar
  que el perfil si se guardo, y revalida igual.
- Con el modo vendedor apagado, el formulario manda los cuatro en vacio: **apagar el modo
  vendedor quita los enlaces** (al reves que `nombre_negocio`, que se conserva). El aviso
  de desactivacion lo dice.
- `clics_enlaces_negocio`: una fila por clic con `vendedor_id`, `canal`, `con_sesion` y
  `created_at`. Nada de quien toco (ni id, ni IP, ni agente). RLS: el vendedor lee solo
  las suyas; nadie inserta desde el cliente. `registrar_clic_enlace_negocio()` es
  ejecutable por `anon` y devuelve FALSE sin error cuando no toca contar: dueno, canal sin
  configurar, perfil no vendedor u oculto, **20 clics por minuto** ya contados a ese
  negocio o **5,000 por hora** en toda la plataforma. Un `pg_advisory_xact_lock` por
  negocio evita que llamadas concurrentes se salten el tope. Los topes existen porque la
  llave anon es publica y el freno de Upstash solo cubre lo que pasa por la Server Action.
  Consecuencia asumida: la metrica es orientativa, no auditada.
- Retencion: **90 dias**, purga diaria con pg_cron (`purgar-clics-enlaces-negocio`,
  04:23 UTC) creada en la misma migracion. Indices en `(vendedor_id, created_at)` y en
  `created_at` para los topes y la purga. El job borra con los permisos de quien aplico
  la migracion (debe ser `postgres`, dueno de la tabla); el bloque VERIFY lo comprueba.

### Aplicar en produccion (lo hace Pedro)

```bash
node scripts/apply-migration.mjs supabase/migrations/20261108120000_enlaces_de_contacto_del_negocio.sql --dry-run
```

```bash
node scripts/apply-migration.mjs supabase/migrations/20261108120000_enlaces_de_contacto_del_negocio.sql
```

```bash
node scripts/gen-types.mjs
```

Los tipos de `database.types.ts` de esta rama se editaron a mano (cuatro columnas, la
tabla y los dos RPC) para que compile sin tocar produccion; `gen-types` los reemplaza y
deberia dejar el mismo resultado. Despues, correr el bloque VERIFY del final de la
migracion (grants, job de pg_cron con `username = postgres`, dueno de la tabla) y la
prueba bajo rol real que ahi se describe.

## Privacidad y alcance real de los controles

- Las cuatro columnas tienen `SELECT` para `anon`: cualquiera con la llave publica puede
  leerlas por PostgREST, filtrar y paginar. Es decir, **`whatsapp_numero` es un dato
  publico y raspable** en masa, igual que un numero puesto en una bio de Instagram. El
  formulario lo dice ("Pon solo lo que ya sea publico") y el vendedor lo escribe a
  sabiendas; `telefono` sigue sin salir de la ficha. La via de autoservicio para
  retirarlo es vaciar el campo o apagar el modo vendedor.
- La regla "resena de Google solo tras una compra" es de **pantalla**: la URL es publica
  como las otras tres. Lo que se protege es no PEDIR la resena a cualquiera, no el
  enlace en si (que ya es publico en Google).
- Los clics no guardan quien toco. La IP de un invitado entra en la cubeta del freno
  como resumen SHA-256 con la fecha del dia (nunca en claro) y `clicEnlaceRateLimit` va
  **sin analitica**: la analitica de `@upstash/ratelimit` persiste el identificador de
  cada cubeta en Redis sin caducidad. Hallazgo colateral, fuera de esta rama: el resto de
  limitadores del repo la llevan encendida y guardan IPs e ids de usuario por hora.
- El texto prellenado de WhatsApp no lleva nada de la persona.

## Como se abren los enlaces en la app

Son `<a target="_blank" rel="noopener noreferrer nofollow ugc">`. En la web abren
pestana; en Android, Chrome entrega `wa.me`, `instagram.com` y Maps a la app instalada
por App Links. En la app nativa, Capacitor pasa al sistema la navegacion a cualquier host
que **no** este en `server.allowNavigation` de `capacitor.config.ts`, y el sistema abre
WhatsApp, Instagram o Maps si estan (o el navegador si no).

**Excepcion, Android:** `allowNavigation` trae `*.google.com` (por el OAuth), y esa
mascara casa `www.google.com`, `maps.google.com` y `search.google.com`. Un enlace de Maps
copiado del navegador (`www.google.com/maps/...`) o el de resenas
(`search.google.com/local/writereview`) cargaria la web de Google **encima de la ficha**,
sin volver. Para esos hosts, y solo en Android, el boton abre con `@capacitor/browser`
(pestana del sistema con su boton de cerrar), que ya va en el binario publicado: no hace
falta AAB nuevo. `lib/perfil/abrir-enlace-externo.ts` reproduce la mascara tal cual
(`google.com` a secas y `*.google.com.mx` no casan). iOS no tiene el problema: con
`target=_blank` WebKit pide una ventana nueva y Capacitor la abre con `UIApplication.open`
aunque el host este en la lista. Para el siguiente AAB conviene decidir si se quita
`*.google.com` de `allowNavigation` (el OAuth nativo ya usa `Browser.open`) o se adopta
`@capacitor/app-launcher`. **Todo esto hay que comprobarlo en un Android y un iPhone
fisicos**; es el primer punto de la lista de abajo.

## Como probar

Web (local o preview de Vercel):

1. Como vendedor, `/perfil/editar` → Modo Vendedor → "Contacto y redes del negocio".
   Pegar `@MiTienda`, `+52 (222) 123-4567`, un enlace de Maps sin `https` y el enlace de
   resenas de Google. Guardar. Los cuatro deben quedar normalizados al recargar.
2. Probar un error por campo: usuario con espacio, numero de 10 digitos (sin lada), URL
   de otro dominio, enlace de resenas que no sea de Google. El mensaje nombra el campo y
   NO se guarda nada (ni el perfil).
3. Dejar un campo vacio y guardar: ese boton desaparece de la ficha. Apagar el modo
   vendedor y guardar: desaparecen los cuatro (y `GET /rest/v1/profiles?select=whatsapp_numero`
   con la llave anon ya devuelve null para ese perfil).
4. Abrir `/vendedor/<id>` sin sesion: botones Instagram, WhatsApp y Maps; sin resena.
   Con una cuenta que le haya comprado (venta completada): aparece "Resena en Google".
5. Tocar cada boton y luego, como el vendedor, ver `/seller/analytics`: el conteo del
   canal sube. Tocar como dueno: no sube. Clic central del raton: tambien cuenta.

Android instalado (APK/AAB actual, no hace falta uno nuevo) e iPhone, por host:

6. `wa.me` y `instagram.com` con las apps instaladas: abre WhatsApp / Instagram. Sin la
   app: abre el navegador del sistema.
7. Maps con enlace `maps.app.goo.gl/...` o `g.page/...`: abre la app de Maps (o el
   navegador). Maps con enlace `www.google.com/maps/...` o `maps.google.com/...`:
   **Android** abre una pestana del sistema (Custom Tab) y al cerrarla vuelve a la ficha;
   **iOS** abre Safari o Maps. En ningun caso la web de Google debe quedar encima de la
   ficha sin boton de volver.
8. Resena con `g.page/r/.../review`: como el punto 7, caso app. Resena con
   `search.google.com/local/writereview`: como el punto 7, caso Custom Tab.
9. Volver a VICINO en todos los casos: la ficha sigue donde estaba.

Pruebas automaticas: desde `apps/web`

```bash
node --import tsx --test lib/perfil/enlaces-negocio.test.ts lib/perfil/abrir-enlace-externo.test.ts app/actions/enlaces-negocio.test.ts "app/(marketplace)/perfil/actions.enlaces.test.ts"
```

## Decisiones tomadas en esta rama (se pueden revertir)

| # | Decision | Alternativa |
| --- | --- | --- |
| D1 | Los cuatro enlaces estan disponibles para todo vendedor (casual y negocio). | Solo `seller_type = business`. |
| D2 | La resena de Google solo se ofrece a quien tiene una venta completada con ese negocio. | Mostrarla a cualquiera (va contra la politica de Google de solicitud selectiva y contra "la resena de la compra vive en VICINO"). |
| D3 | Clics sin identidad; `con_sesion` como unica distincion; IP solo como resumen con fecha en el freno, sin analitica; retencion 90 dias. | Guardar quien toco (permitiria embudos por persona; mas datos personales). |
| D4 | `<a target=_blank>` en vez de un plugin nativo; en Android, `Browser.open` solo para los hosts `*.google.com` que `allowNavigation` dejaria dentro del WebView. | `@capacitor/app-launcher` para todo (AAB nuevo), o quitar `*.google.com` de `allowNavigation` (AAB nuevo). |
| D5 | Texto prellenado fijo en WhatsApp, sin datos de la persona ni del producto. | Incluir el producto que miraba (requiere pasar contexto a la ficha). |
| D6 | WhatsApp exige 11-15 digitos: un numero local de 10 se rechaza con mensaje. NO se antepone la lada. | Aceptar 10 digitos (enlace roto probable) o anteponer 52 (inventa un dato). |
| D7 | Apagar el modo vendedor quita los cuatro enlaces (son publicos); `nombre_negocio` y lo demas se conservan como antes. | Conservarlos ocultos (quedarian legibles por PostgREST sin via para retirarlos). |
| D8 | Diseno: los botones usan las clases de `ChipCategoria` (`product-card-tab`); solo se anadio una fila al aviso de desactivacion. | Lo que diga la revision visual. |

## Pendientes

- Diseno: revision visual de Alejandro de los botones y de la fila nueva del aviso de
  desactivacion; no se toco nada mas de la cabecera.
- Revisar a los 60 dias si la retencion (90 dias) y los topes (20/min por negocio,
  5,000/h global) siguen bien para el trafico real.
- Siguiente AAB: decidir entre quitar `*.google.com` de `allowNavigation` o adoptar
  `@capacitor/app-launcher`, para que ningun host dependa de la excepcion de Android.
- `inert` en el bloque colapsado del formulario de vendedor (los campos siguen en el DOM y
  son enfocables con Tab cuando el modo vendedor esta apagado; patron previo del bloque).
- Ofrecer el enlace de resena de Google tambien al cerrar la resena interna de una compra.
- Decidir si los enlaces aparecen tambien en la ficha de producto.
- Fuera de esta rama: los demas limitadores de `rate-limit.ts` llevan `analytics: true` y
  persisten IPs e ids por hora en Upstash sin caducidad; revisar.
- Lo que no entra aqui: leer o responder mensajes y resenas (bandeja). Es otra decision,
  con sus requisitos de Meta y Google; ver la propuesta OpenSpec.
