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
| `/perfil/editar`, bloque Modo Vendedor | El vendedor | Cuatro campos opcionales: Instagram, WhatsApp, Google Maps, Resenas Google. Vacio = quitar. |
| `/vendedor/[id]` | Cualquiera (invitado o con sesion) | Botones Instagram, WhatsApp y Google Maps, debajo de la zona. |
| `/vendedor/[id]` | Quien ya le compro a ese negocio (una `sale_confirmations` en `completed`) | Ademas, el boton "Resena en Google". |
| `/perfil` | El dueno | Los mismos botones, incluida la resena, para comprobar que abren. Sus clics no se cuentan. |
| `/seller/analytics` | El vendedor | "Clics a tus enlaces (ultimos 30 dias)", por canal, con la aclaracion de que un clic no es un mensaje ni una venta. |

## Donde esta cada cosa

| Pieza | Archivo |
| --- | --- |
| Normalizadores, patrones y armado de URL | `packages/shared/src/utils/enlaces-negocio.ts` |
| Esquema Zod `enlacesNegocioSchema` | `packages/shared/src/validators/profile.ts` |
| Migracion (columnas, CHECK, grants, 2 RPC, tabla de clics, RLS) | `supabase/migrations/20261108120000_enlaces_de_contacto_del_negocio.sql` |
| Guardado desde el formulario (segundo RPC tras el del perfil) | `apps/web/app/(marketplace)/perfil/actions.ts` |
| Campos del formulario | `apps/web/app/(marketplace)/perfil/profile-form.tsx` |
| Botones de la ficha | `apps/web/components/profile/enlaces-negocio.tsx` |
| Hueco `enlacesNegocio` en la cabecera | `apps/web/app/(marketplace)/perfil/profile-header.tsx` |
| Ficha publica (SELECT + regla de la resena) | `apps/web/app/(marketplace)/vendedor/[id]/page.tsx` |
| Perfil propio (SELECT del nucleo y render) | `apps/web/lib/profile-session-data.ts`, `apps/web/app/(marketplace)/perfil/profile-session.tsx` |
| Server Action que cuenta el clic | `apps/web/app/actions/enlaces-negocio.ts` |
| Freno por usuario/IP del clic | `apps/web/lib/rate-limit.ts` (`clicEnlaceRateLimit`) |
| Tarjeta de clics | `apps/web/app/seller/analytics/page.tsx` |
| Tipos de la base (editados a mano; ver abajo) | `apps/web/types/database.types.ts` |
| Pruebas | `apps/web/lib/perfil/enlaces-negocio.test.ts`, `apps/web/app/actions/enlaces-negocio.test.ts` |

## Formatos, con su fuente

| Canal | Lo que se guarda | Lo que se abre | Fuente |
| --- | --- | --- | --- |
| Instagram | `instagram_usuario`: solo el usuario, en minusculas, 1-30 caracteres, letras/numeros/`_`/`.` sin punto final ni dos seguidos. Se acepta pegado con `@` o con la URL completa. | `https://www.instagram.com/<usuario>/` | Formato de perfil publico de Instagram (el Centro de ayuda no se pudo leer por script; queda como convencion conocida). |
| WhatsApp | `whatsapp_numero`: solo digitos, formato internacional, 10-15 digitos, sin `+`, ceros, parentesis ni guiones. **No se rellena la lada de pais**: un numero de 10 digitos pasa tal cual, por eso el formulario la pide en voz alta. | `https://wa.me/<numero>?text=<mensaje codificado>`. El mensaje ("Hola, vi tu negocio en VICINO y me interesa.") le dice al negocio de donde viene la persona. | faq.whatsapp.com/5913398998672934: "No incluyas ceros, parentesis ni guiones"; `?text=` debe ir URL-encoded. |
| Google Maps | `google_maps_url`: la URL que el vendedor copia de Maps (Compartir), acotada a `https` y a una lista CERRADA de hosts: `google.com(.mx)/maps`, `maps.google.com(.mx)`, `maps.app.goo.gl`, `goo.gl/maps`, `g.page`. Sin segmentos `.`/`..` (ni `%2e`) ni `\` en la ruta, porque el navegador los normaliza despues de pasar el patron. Maximo 500. | La misma URL. En Android/iOS con la app de Maps instalada, la abre la app. | developers.google.com/maps/documentation/urls/get-started: sin API key; `api=1` obligatorio en las URL construidas; URLs limitadas a 2,048 caracteres. |
| Resenas de Google | `google_resenas_url`: solo `https://g.page/r/<id>/review` o `https://search.google.com/local/writereview?placeid=<id>`. Maximo 300. | La misma URL, solo tras una compra completada. | support.google.com/business/answer/3474122 y /contributionpolicy/answer/7400114: prohibido ofrecer incentivos y "selectively solicit positive reviews". Por eso no hay premio, no hay filtro por nota y no se pide a cualquiera. |

Los mismos patrones viven tres veces a proposito: en `@vicino/shared` (mensaje amable
antes de mandar), en el RPC (mensaje amable aunque alguien salte el cliente) y en los CHECK
(ultima linea). Si uno cambia, cambian los tres.

## Base de datos

- Cuatro columnas nuevas en `profiles`, con `GRANT SELECT` a `anon` y `authenticated`
  (la ficha se sirve a invitados). **Sin INSERT ni UPDATE por columna**: solo las escribe
  `actualizar_enlaces_negocio()`, que exige sesion y `es_vendedor = TRUE`. Cada parametro
  en NULL o vacio borra ese enlace.
- Va en un RPC aparte y no en `update_profile_and_pause_products` porque ampliar esa firma
  crearia una sobrecarga (PostgREST 300) y porque los enlaces tienen sus reglas y mensajes.
  El formulario llama a los dos, en ese orden; si el segundo falla, lo dice sin ocultar
  que el perfil si se guardo.
- `clics_enlaces_negocio`: una fila por clic con `vendedor_id`, `canal`, `con_sesion` y
  `created_at`. Nada de quien toco (ni id, ni IP, ni agente). RLS: el vendedor lee solo
  las suyas; nadie inserta desde el cliente. `registrar_clic_enlace_negocio()` es
  ejecutable por `anon` y devuelve FALSE sin error cuando no toca contar: dueno, canal sin
  configurar, perfil no vendedor u oculto, **20 clics por minuto** ya contados a ese
  negocio o **5,000 por hora** en toda la plataforma. Los topes existen porque la llave
  anon es publica y el freno de Upstash (20/min por usuario o IP) solo cubre lo que pasa
  por la Server Action. Consecuencia asumida: la metrica es orientativa, no auditada.
- Retencion: **90 dias**, purga diaria con pg_cron (`purgar-clics-enlaces-negocio`,
  04:23 UTC) creada en la misma migracion. Indices en `(vendedor_id, created_at)` y en
  `created_at` para los topes y la purga.

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
migracion y la prueba bajo rol real que ahi se describe.

## Privacidad y alcance real de los controles

- Las cuatro columnas tienen `SELECT` para `anon`: cualquiera con la llave publica puede
  leerlas por PostgREST, filtrar y paginar. Es decir, **`whatsapp_numero` es un dato
  publico y raspable** en masa, igual que un numero puesto en una bio de Instagram. El
  formulario lo dice ("Pon solo lo que ya sea publico") y el vendedor lo escribe a
  sabiendas; `telefono` sigue sin salir de la ficha.
- La regla "resena de Google solo tras una compra" es de **pantalla**: la URL es publica
  como las otras tres. Lo que se protege es no PEDIR la resena a cualquiera, no el
  enlace en si (que ya es publico en Google).
- Los clics no guardan quien toco. La IP solo vive en la cubeta del freno (Upstash) y no
  se persiste. El texto prellenado de WhatsApp no lleva nada de la persona.

## Como se abren los enlaces en la app

Son `<a target="_blank" rel="noopener noreferrer nofollow ugc">`. En la web abren
pestana; en Android, Chrome entrega `wa.me`, `instagram.com` y Maps a la app instalada
por App Links. En la app nativa, Capacitor intercepta la navegacion a un dominio ajeno
y la pasa al sistema, que abre WhatsApp, Instagram o Maps si estan. No se uso
`@capacitor/browser` (una pestana dentro de la app es peor que la app del canal) ni
`@capacitor/app-launcher` (plugin nuevo = AAB nuevo). **Esto hay que comprobarlo en un
Android y un iPhone fisicos**; es el primer punto de la lista de abajo.

## Como probar

Web (local o preview de Vercel):

1. Como vendedor, `/perfil/editar` → Modo Vendedor → "Contacto y redes del negocio".
   Pegar `@MiTienda`, `+52 (222) 123-4567`, un enlace de Maps sin `https` y el enlace de
   resenas de Google. Guardar. Los cuatro deben quedar normalizados al recargar.
2. Probar un error por campo: usuario con espacio, numero de 9 digitos, URL de otro
   dominio, enlace de resenas que no sea de Google. El mensaje nombra el campo.
3. Dejar un campo vacio y guardar: ese boton desaparece de la ficha.
4. Abrir `/vendedor/<id>` sin sesion: botones Instagram, WhatsApp y Maps; sin resena.
   Con una cuenta que le haya comprado (venta completada): aparece "Resena en Google".
5. Tocar cada boton y luego, como el vendedor, ver `/seller/analytics`: el conteo del
   canal sube. Tocar como dueno: no sube.

Android instalado (APK/AAB actual, no hace falta uno nuevo) e iPhone:

6. Con WhatsApp, Instagram y Maps instalados: cada boton abre la app correspondiente.
7. Sin alguna de las apps: abre el navegador del sistema (no una pantalla en blanco).
8. Volver a VICINO: la ficha sigue donde estaba.

Pruebas automaticas: desde `apps/web`

```bash
node --import tsx --test lib/perfil/enlaces-negocio.test.ts app/actions/enlaces-negocio.test.ts
```

## Decisiones tomadas en esta rama (se pueden revertir)

| # | Decision | Alternativa |
| --- | --- | --- |
| D1 | Los cuatro enlaces estan disponibles para todo vendedor (casual y negocio). | Solo `seller_type = business`. |
| D2 | La resena de Google solo se ofrece a quien tiene una venta completada con ese negocio. | Mostrarla a cualquiera (va contra la politica de Google de solicitud selectiva y contra "la resena de la compra vive en VICINO"). |
| D3 | Clics sin identidad; `con_sesion` como unica distincion. | Guardar quien toco (permitiria embudos por persona; mas datos personales). |
| D4 | `<a target=_blank>` en vez de un plugin nativo. | `@capacitor/app-launcher` (AAB nuevo). |
| D5 | Texto prellenado fijo en WhatsApp, sin datos de la persona ni del producto. | Incluir el producto que miraba (requiere pasar contexto a la ficha). |
| D6 | WhatsApp acepta 10-15 digitos y NO antepone la lada. | Anteponer 52 a los de 10 digitos (inventa un dato). |

## Pendientes

- Diseno: los botones usan las clases de `ChipCategoria` (`product-card-tab`). Revision
  visual de Alejandro antes de mergear; no se toco nada mas de la cabecera.
- Revisar a los 60 dias si la retencion (90 dias) y los topes (20/min por negocio,
  5,000/h global) siguen bien para el trafico real.
- `inert` en el bloque colapsado del formulario de vendedor (los campos siguen en el DOM y
  son enfocables con Tab cuando el modo vendedor esta apagado; patron previo del bloque).
- Ofrecer el enlace de resena de Google tambien al cerrar la resena interna de una compra.
- Decidir si los enlaces aparecen tambien en la ficha de producto.
- Lo que no entra aqui: leer o responder mensajes y resenas (bandeja). Es otra decision,
  con sus requisitos de Meta y Google; ver la propuesta OpenSpec.
