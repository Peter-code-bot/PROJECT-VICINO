# Design — Enlaces de contacto del negocio

## Flujo de datos

```
Editar perfil (profile-form.tsx)
  └─ FormData: ...campos del perfil + instagram_usuario, whatsapp_numero,
               google_maps_url, google_resenas_url
       └─ updateProfile (perfil/actions.ts)
            1. updateProfileSchema        → valida el perfil
            2. enlacesNegocioSchema       → normaliza y valida los enlaces (ANTES de escribir)
            3. rpc update_profile_and_pause_products
            4. rpc actualizar_enlaces_negocio   (solo si es vendedor y el form trae los campos)

Ficha /vendedor/[id] y /perfil
  └─ SELECT ... instagram_usuario, whatsapp_numero, google_maps_url, google_resenas_url
       └─ <EnlacesNegocio>  → listarEnlacesNegocio() arma href por proveedor
            └─ <a target=_blank> + registrarClicEnlaceNegocio() (Server Action, sin esperar)
                 └─ rpc registrar_clic_enlace_negocio(vendedor, canal)  → INSERT clics_enlaces_negocio

/seller/analytics
  └─ SELECT canal FROM clics_enlaces_negocio WHERE vendedor_id = yo AND created_at > now()-30d
```

## Tres capas de validacion, un solo patron

| Capa | Donde | Para que |
| --- | --- | --- |
| Cliente/servidor Next | `normalizar*` + `enlacesNegocioSchema` en `@vicino/shared` | Limpiar lo pegado (`@`, URL completa, espacios, `+`, `00`) y dar el mensaje de su campo. |
| RPC | `actualizar_enlaces_negocio` | El mismo mensaje aunque alguien llame al RPC sin pasar por la app. |
| CHECK | `profiles_*_formato` | Ultima linea; sin mensaje amable, con garantia. |

El patron es identico en las tres. `whatsapp_numero` pide 10-15 digitos sin cero inicial:
el minimo de 10 corta el error mas comun (numero local sin lada) sin inventar la lada.

## Por que un RPC aparte

Ampliar `update_profile_and_pause_products` con cuatro parametros mas habria creado una
**sobrecarga** (CREATE OR REPLACE con otra aridad deja las dos firmas vivas y PostgREST
responde 300 ante la ambiguedad). Ademas los enlaces tienen reglas y mensajes propios, y
se conservan al desactivar el modo vendedor igual que `nombre_negocio`.

Consecuencia aceptada: dos escrituras no atomicas. Si la segunda falla, el perfil ya quedo
guardado y el mensaje lo dice ("Tu perfil se guardo, pero los enlaces de tu negocio no.
..."), como ya hace el formulario con el `@` (`setUsername` + `updateProfile`).

Proteccion contra clientes viejos: el RPC de enlaces solo se llama si el `FormData` **trae**
alguno de los cuatro campos (`formData.has`). Un formulario abierto antes del deploy no los
trae, y sin esa guarda los habria borrado.

## Medir sin leer

`clics_enlaces_negocio` guarda `vendedor_id`, `canal`, `con_sesion`, `created_at`. No guarda
quien toco. Eso responde a "medicion del origen sin capturar el contenido de
conversaciones": sabemos cuantas personas abrieron cada canal desde la ficha, y nada mas.
Un clic no es un mensaje ni una venta, y la pantalla lo dice.

El RPC es ejecutable por `anon` (los invitados tambien tocan). Frenos:

- Server Action: `clicEnlaceRateLimit` 20/min por usuario o por IP (Upstash).
- RPC: devuelve FALSE sin error si el dueno toca lo suyo, si el canal no esta configurado,
  si el perfil no es vendedor o esta oculto, si el negocio ya tiene 20 clics en el ultimo
  minuto o si la plataforma ya conto 5,000 en la ultima hora. Sin error a proposito: la
  respuesta no debe servir para adivinar nada de un perfil. Los topes son la barrera real,
  porque la llave anon es publica y el freno de Upstash no cubre a quien llama a PostgREST
  directo; el precio es que la metrica es orientativa, no auditada, y la pantalla lo dice.
- Retencion: purga diaria a 90 dias con pg_cron (`purgar-clics-enlaces-negocio`), en la
  misma migracion, con indice en `created_at`.
- RLS: el vendedor lee solo sus filas; nadie inserta, actualiza ni borra desde el cliente.
- La pantalla del vendedor cuenta con `count` por canal (head), no trayendo filas: PostgREST
  corta en 1,000 y el total saldria truncado en silencio. Un error de la consulta se
  reporta y se pinta "—", no cero.

## La resena de Google

Google prohibe incentivar resenas y pedirlas de forma selectiva ("selectively solicit
positive reviews", politica de contenido de Maps). VICINO ademas quiere que la resena de la
compra viva dentro de VICINO. Por eso:

- El enlace se guarda tal cual lo genera Google (`g.page/r/<id>/review` o
  `search.google.com/local/writereview?placeid=`), nada mas.
- Se ofrece **solo** a quien tiene una `sale_confirmations` en `completed` con ese negocio.
  Sin premio, sin filtro por calificacion, sin pedirla antes de una experiencia real.
- El dueno lo ve para comprobar que abre; sus clics no cuentan.
- Es una regla de PANTALLA: la columna es publica como las otras tres (y el enlace ya es
  publico en Google). Lo que se protege es no pedir la resena a cualquiera.

## Como se abren en la app nativa

`<a target="_blank" rel="noopener noreferrer nofollow ugc">`. En el WebView de Capacitor
la navegacion a un dominio que no esta en `allowNavigation` se entrega al sistema
(`Intent.ACTION_VIEW` en Android, `openURL` en iOS), que abre la app del canal si esta
instalada o el navegador si no. Se descarto `@capacitor/browser` (abriria WhatsApp o
Instagram en una pestana dentro de la app, peor que la app) y `@capacitor/app-launcher`
(plugin nuevo = `cap sync` = AAB nuevo). **Queda por comprobar en dispositivos fisicos.**

## Privacidad

- `telefono` sigue sin salir de la ficha publica; `whatsapp_numero` es un dato distinto,
  que el vendedor pone a sabiendas de que es publico (el formulario lo dice).
- El texto prellenado de WhatsApp no lleva nada de la persona.
- `rel="nofollow ugc"`: el destino lo escribe el vendedor.
- `whatsapp_numero` y las URL son legibles por `anon` via PostgREST (filtrables y
  paginables): son datos publicos y raspables, y el formulario lo dice. `telefono` sigue
  sin exponerse.
- Retencion de clics: 90 dias (pg_cron). El unico dato temporal es `created_at`.

## Pruebas

- `apps/web/lib/perfil/enlaces-negocio.test.ts`: normalizadores, patrones, armado de URL,
  orden de la lista y el esquema (16 casos, incluidos dominios ajenos y `javascript:`).
- `apps/web/app/actions/enlaces-negocio.test.ts`: la Server Action con `cargarReal`
  (cubeta por usuario o IP, entrada invalida, freno cerrado, error del RPC a Sentry, y que
  el RPC no recibe nada de quien toca).
- SQL: bloque VERIFY al final de la migracion, con la prueba bajo `SET LOCAL ROLE`.
- Dispositivo: matriz en `docs/ENLACES-NEGOCIO-2026-11-08.md`.

## Riesgos

| Riesgo | Mitigacion |
| --- | --- |
| Un vendedor pone un numero sin lada y el boton de WhatsApp no abre su chat. | Hint explicito en el formulario; se evaluo anteponer 52 y se descarto por inventar datos. Si duele, un aviso al guardar numeros de 10 digitos. |
| Enlaces a sitios ajenos en una columna publica. | CHECK + RPC acotan a https y a una lista CERRADA de hosts de Google (nada de `google.<tld>` abierto), y rechazan segmentos `..`/`%2e` y `\` que el navegador normalizaria fuera de `/maps`. Instagram y WhatsApp se arman, no se guardan. |
| Inflar o saturar clics (la llave anon es publica). | Freno por usuario/IP en la accion; en el RPC, 20/min por negocio y 5,000/h global; dueno excluido; purga a 90 dias. La metrica se declara orientativa. |
| El WebView no entrega el enlace a la app del canal. | Comprobar en fisico; si falla, `@capacitor/app-launcher` en el siguiente AAB. |
| Tipos editados a mano divergen del generador. | `node scripts/gen-types.mjs` tras aplicar la migracion; CI avisa. |
