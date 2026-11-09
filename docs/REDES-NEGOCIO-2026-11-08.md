# Redes sociales del negocio — 8-nov-2026

> Rama `feat/mas-redes-negocio-20261108`, apilada sobre el PR #100 (que cambia el aviso
> de desactivación del mismo formulario). Segunda entrega de INT-CRM-20261104, sobre
> los enlaces de `docs/ENLACES-NEGOCIO-2026-11-08.md`. Plan y decisiones en Notion:
> «VICINO — Más redes en el perfil del negocio: plan (8-nov-2026)».

Cada negocio puede enlazar además su Facebook (y abrir Messenger), TikTok, YouTube, X,
LinkedIn, Threads, Pinterest y Telegram. Igual que con Instagram: se guarda solo el
usuario (o la ruta corta del perfil en Facebook, YouTube y LinkedIn), la URL se arma
con el formato oficial y el clic se cuenta sin saber quién tocó.

## Decisiones (Pedro y Alejandro, 8-nov-2026)

| # | Decisión |
| --- | --- |
| R1 | Entran Facebook, Messenger, TikTok, YouTube, X, LinkedIn, Threads, Pinterest y Telegram. Snapchat y un sitio web propio, no (un dominio libre en una columna pública sirve para phishing). |
| R2 | LinkedIn acepta perfiles (`/in/`) y páginas de empresa (`/company/`). |
| R3 | Facebook: el usuario, o el ID numérico (`profile.php?id=`) si la página no tiene usuario. Los enlaces `facebook.com/share/…` se rechazan pidiendo el usuario: ninguna fuente oficial dice a dónde llevan. |
| R4 | Diseño: con 4 chips o más, las redes se pliegan en UN chip desplegable «Redes sociales». Contacto (WhatsApp, Messenger, Maps, reseña) sigue a la vista. Con una sola red no se pliega. |
| R5 | Messenger no tiene campo propio: es una casilla que usa el usuario de Facebook (`m.me/<usuario>`). Con un ID numérico no se ofrece. |
| R6 | Enlaces cortos (vm.tiktok.com, lnkd.in, pin.it, fb.me) y de videos (youtu.be, /watch) se rechazan con un mensaje que dice dónde ver el usuario. Resolverlos obligaría al servidor a seguir redirecciones de terceros. |
| R7 | Íconos propios desde Simple Icons 16.35.0 (CC0), con las reglas de cada marca. TikTok (pide permiso escrito para su logo) y LinkedIn (Simple Icons lo retiró y no tenemos el archivo oficial) van solo con su nombre. Ningún ícono de lucide: la 1.x ya no trae íconos de marca y el PR #40 rompería el de Instagram. |
| R8 | El Aviso de Privacidad se actualiza en un PR aparte: su entrada en vigor la gobierna el §18 (preaviso de 30 días si el cambio es sustancial), que decide Pedro. |

## Formatos

| Red | Columna | Se abre | Se acepta al pegar | Se rechaza |
| --- | --- | --- | --- | --- |
| Facebook | `facebook_ruta`: usuario en minúsculas (5-50: letras, números y puntos, con al menos una letra) o `profile.php?id=<5-20 dígitos>` | `https://www.facebook.com/<usuario>` o `…/profile.php?id=<id>` | usuario, @, facebook.com / m. / web. / es-la. / fb.com, `/people/<nombre>/<id>/`; se ignoran `mibextid`, `rdid` | `share/`, `groups/` y demás rutas que no son perfil; fb.me; otros dominios |
| Messenger | `facebook_messenger` (boolean) | `https://m.me/<usuario>?text=…` | — | con ID numérico (CHECK `profiles_facebook_messenger_con_usuario`) |
| TikTok | `tiktok_usuario`: 2-24 (letras, números, `_` y `.`), sin punto final, tal cual | `https://www.tiktok.com/@<usuario>` | usuario, @, tiktok.com/@… con `?_t=` | vm./vt.tiktok.com, tiktok.com/t/…, videos |
| YouTube | `youtube_ruta`: `@handle` en minúsculas (3-30, letras de cualquier idioma, números y `_ - . ·` no al inicio ni al final) o `channel/UC<22>` | `https://www.youtube.com/@handle` o `…/channel/UC…` | @handle, youtube.com / m.youtube.com con `?si=` | youtu.be, /watch, /shorts, /c/, /user/ |
| X | `x_usuario`: 1-15 (letras, números y `_`), tal cual | `https://x.com/<usuario>` | usuario, @, x.com o twitter.com con `?s=` / `?t=` | rutas como /home, /i/…; otros dominios |
| LinkedIn | `linkedin_ruta`: `in/<3-100>` o `company/<2-100>` (letras, números y guiones), minúsculas | `https://www.linkedin.com/<tipo>/<slug>/` | URL de linkedin.com o mx.linkedin.com con `?utm_…`; `in/…` o `company/…` sin dominio | lnkd.in, /school/, nombre suelto (no se sabe si es perfil o empresa) |
| Threads | `threads_usuario`: reglas de Instagram, minúsculas | `https://www.threads.com/@<usuario>` | usuario, @, threads.com o threads.net | rutas sin @ |
| Pinterest | `pinterest_usuario`: 3-30 (letras, números y `_`), no solo números, tal cual | `https://www.pinterest.com/<usuario>/` | usuario, pinterest.com(.mx), mx.pinterest.com | pin.it, /pin/… |
| Telegram | `telegram_usuario`: 5-32 (a-z, 0-9 y `_`), minúsculas | `https://t.me/<usuario>` | usuario, @, t.me o telegram.me | `t.me/+…` (invitaciones), joinchat |

Minúsculas solo donde la red confirma que no distingue (Facebook, YouTube, LinkedIn,
Telegram; Threads hereda las reglas de Instagram). TikTok, X y Pinterest se guardan
tal cual porque sus fuentes no lo dicen.

Los patrones viven tres veces: `packages/shared/src/utils/redes-negocio.ts` (mensaje
por motivo), `guardar_enlaces_negocio` (mensaje aunque alguien salte el cliente) y los
CHECK (última línea). **Excepción:** el @handle de YouTube. El `\p{L}` de JavaScript no
tiene equivalente exacto en una expresión de Postgres, así que el RPC y el CHECK usan
una regla más laxa (longitud; sin espacios, controles ni `/ ? # % \ @ & = +`). La URL
se sigue armando sobre youtube.com con el handle codificado: lo laxo no abre un salto
a otro sitio.

## Base de datos (`20261108230000_mas_redes_del_negocio.sql`)

- 9 columnas en `profiles` (8 de texto + `facebook_messenger`), con CHECK, `SELECT` para
  `anon` y `authenticated` y sin `INSERT` ni `UPDATE` por columna.
- `guardar_enlaces_negocio(p_enlaces jsonb)`, `SECURITY DEFINER`, solo `authenticated`.
  Clave que no viene: no se toca. `null` o `""`: se quita. Clave desconocida u otro
  tipo: 22023 sin repetir la clave. Poner exige modo vendedor (42501); quitar se permite
  siempre. Si se quita Facebook, Messenger se apaga solo; pedir Messenger sin usuario es
  22023. Un RPC nuevo y no `actualizar_enlaces_negocio` ampliado: otra aridad con el
  mismo nombre es una sobrecarga (PostgREST 300) y su «vacío = quitar» haría que un
  formulario viejo borrara las redes nuevas. El RPC viejo se queda hasta una migración
  de limpieza.
- `clics_enlaces_negocio`: el CHECK de canales pasa a `clics_enlaces_negocio_canal_valido`
  con los 13; `registrar_clic_enlace_negocio` conserva su firma, sus topes (20/min por
  negocio, 5,000/h en total) y su lock.
- `clics_enlaces_negocio_por_canal(p_dias)`: conteo agrupado para `/seller/analytics` en
  una consulta, `SECURITY INVOKER` (la RLS ya filtra) y solo `authenticated`.
- Bloque `DO $verify$` que revierte la migración si un privilegio, una sobrecarga o el
  CHECK viejo no quedaron como se espera.
- Reversión: `docs/rollback/20261108230000_mas_redes_del_negocio_rollback.sql` (revertir
  antes el código: la ficha pide las columnas nuevas).

## Código

| Pieza | Archivo |
| --- | --- |
| Normalizadores y URL por red | `packages/shared/src/utils/redes-negocio.ts` |
| Canales, grupos, etiquetas, lista y regla del desplegable | `packages/shared/src/utils/enlaces-negocio.ts` |
| Esquema con mensaje por motivo y regla de Messenger | `packages/shared/src/validators/profile.ts` (`redesNegocioSchema`) |
| Guardado (solo las claves que trae el formulario; con el modo apagado, todas en vacío) | `apps/web/app/(marketplace)/perfil/actions.ts` |
| Campos plegados «Redes sociales» y casilla de Messenger | `apps/web/app/(marketplace)/perfil/campos-redes-negocio.tsx` |
| Chips y chip desplegable | `apps/web/components/profile/enlaces-negocio.tsx` |
| Íconos de marca | `apps/web/components/profile/iconos-redes.tsx` |
| Tarjeta de clics (solo canales configurados o con clics) | `apps/web/app/seller/analytics/page.tsx` |

En la app no cambia nada: ningún host nuevo está en `allowNavigation`, así que la app pasa
el enlace al sistema, que abre la app de la red o el navegador. No hace falta AAB nuevo.

## Pruebas

| Dónde | Qué | Resultado |
| --- | --- | --- |
| Staging (PostgREST, RLS y privilegios reales) | `node scripts/staging/probar-redes-negocio.mjs`: lectura pública, escritura directa prohibida, claves ausentes intactas, null quita, 19 formatos malos (también rutas que no son perfil y U+202E en YouTube), guardado vacío sin reescribir, clave desconocida sin eco, Messenger atado a Facebook, CHECK como postgres, sin modo vendedor, sin sesión, RPC viejo intacto, clics de canales nuevos, conteo agrupado, apagar todo, reversión ensayada | 18/18 |
| CI (`security.yml`, paso «Enlaces y redes del negocio») | `redes-negocio.test.ts` (14, con ida y vuelta de lo guardado), `enlaces-negocio.test.ts` (15), `abrir-enlace-externo.test.ts` (3), `app/actions/enlaces-negocio.test.ts` (6), `perfil/actions.enlaces.test.ts` (11, módulo real) | 49/49 en local |

Falta, en dispositivo (Pedro y Alejandro), después de aplicar la migración, por cada red:
con la app instalada abre la app; sin la app, el navegador; al volver, la ficha sigue
donde estaba. Además: el chip «Redes sociales» con 4 o más, Messenger abre el chat, los
clics suben en Estadísticas y apagar el modo vendedor quita todas.

## Revisión (8-nov-2026)

Tres revisores independientes (seguridad, base de datos, TypeScript/React) sobre `2bba9804`, solo lectura. Ningún crítico. Corregido:

| Hallazgo | Severidad | Qué se hizo |
| --- | --- | --- |
| Un Facebook guardado como `profile.php?id=…` o un YouTube `channel/UC…` volvía del formulario y el normalizador lo rechazaba: el vendedor no podía guardar su perfil sin tocar ese campo | Alto | Los normalizadores aceptan lo que ellos mismos guardan; prueba de ida y vuelta de las nueve redes |
| `profile.php` y otras páginas `.php` pasaban como usuario de Facebook | Medio | Rechazadas en JS, RPC y CHECK; el prefijo de ID ahora es `profile.php?id=` |
| El RPC aceptaba rutas de Facebook y Telegram que no son perfil (marketplace, login, proxy, joinchat…) si alguien saltaba el formulario | Medio | Las listas viven también en el RPC y el CHECK |
| El @handle de YouTube aceptaba caracteres de formato y dirección de texto (U+202E…) y comillas en la base | Medio/Bajo | Clase extra en el RPC y el CHECK; en JS ya no pasaban |
| El bloqueo ACCESS EXCLUSIVE de `profiles` duraba toda la migración y había nueve recorridos | Medio | Un solo `ALTER TABLE` al final, después de clics y funciones |
| `FOR UPDATE` frenaba los clics (FK) | Bajo | `FOR NO KEY UPDATE` |
| Un guardado vacío reescribía la fila | Bajo | Sale sin `UPDATE` |
| La reversión podía chocar con un clic nuevo | Bajo | `LOCK TABLE` antes del `DELETE`; nota para respaldar los clics |
| El VERIFY no comprobaba los CHECK, el RPC viejo ni `SECURITY DEFINER` | Bajo | Comprobados |
| Formas reales que se rechazaban: Facebook `Mi-Tienda-6155…`, host con punto final, `pinterest.es`, LinkedIn `in/---` | Bajo | Aceptadas las tres primeras; la cuarta se rechaza |

Quedan, con su motivo:

- **Anterior a este PR:** el tope global de 5,000 clics por hora se puede agotar repartiendo clics entre muchos negocios, y la métrica deja de contar esa hora. La pantalla ya dice que el conteo es orientativo.
- **Anterior a este PR:** `maps.app.goo.gl` y `goo.gl/maps` son acortadores, así que su destino no se ve.
- **Por diseño:** no se comprueba que la cuenta enlazada sea del vendedor.
- **Para verificar en dispositivo:** que Messenger respete `?text=` con el mensaje largo.

## Orden de despliegue

1. Pedro aplica la migración (compatible con `master`):

   ```bash
   node scripts/apply-migration.mjs supabase/migrations/20261108230000_mas_redes_del_negocio.sql
   ```

2. `node scripts/gen-types.mjs` y commit a esta rama: la comprobación de tipos pasa a verde.
3. Merge del PR #100 y después de este, con el OK de Pedro.

## Fuentes (leídas el 8-nov-2026)

Reglas de usuario y URL: facebook.com/help/105399436216001, messenger.com/help/211813265517027,
developers.facebook.com/docs/messenger-platform/discovery/m-me-links,
tiktok.com/support/faq_detail?id=7581821550156962315, developers.tiktok.com/docs/en/embed-creator-profiles,
support.google.com/youtube/answer/11585688 y /6180214, help.x.com/en/managing-your-account/x-username-rules,
linkedin.com/help/linkedin/answer/a542685 y /a564298, help.instagram.com/1748374355831404 (Threads),
help.pinterest.com/en/article/edit-your-profile, telegram.org/faq, core.telegram.org/api/links.
Marcas: meta.com/brand/resources (Facebook, Messenger, Threads), brand.youtube, brand.linkedin.com/in-logo,
business.pinterest.com/brand-guidelines, developers.tiktok.com/docs/en/getting-started-design-guidelines,
about.x.com/en/who-we-are/brand-toolkit. Uso en México: datareportal.com/reports/digital-2026-mexico.
Sin fuente oficial (secundarias): los enlaces `facebook.com/share/…`, los cortos de TikTok, el `?s=` de X,
el `?si=` de YouTube.
