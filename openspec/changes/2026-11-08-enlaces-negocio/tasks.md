# Tasks — Enlaces de contacto del negocio

> Estado al 8-nov-2026 en la rama `feat/enlaces-negocio-20261108` (worktree
> `startup-marketplace-enlaces`, base `192876f`). Lo que necesita produccion, un
> dispositivo o una decision queda marcado como pendiente de Pedro o de Alejandro.

## FASE 0 — GATE 0

- [x] T-00 `git fetch origin master`: la copia local estaba 22 commits atras (b8883ce);
      la rama se creo desde `origin/master` `192876f`, que es lo que corre produccion.
- [x] T-01 Leer el DDL real de `profiles` (20260320000002 y sus ALTER), los grants por
      columna (20260826171000, 20260826240000, 20260826250000) y la firma vigente de
      `update_profile_and_pause_products` (20261011120000). No habia columnas de enlaces.
- [x] T-02 Confirmar el patron de enlaces externos del repo (`<a target=_blank>` en
      legal-footer y seller-steps; `@capacitor/browser` en Wallet y en el OAuth nativo:
      `lib/auth/native-oauth.ts`, `components/auth/oauth-url-listener.tsx`) y leer
      `capacitor.config.ts` (`allowNavigation` incluye `*.google.com`).
- [x] T-03 Formatos oficiales: wa.me (faq.whatsapp.com/5913398998672934), Maps URLs
      (developers.google.com/maps/documentation/urls/get-started), politica de resenas de
      Google (support.google.com/business/answer/3474122 y contributionpolicy/7400114).

## FASE 1 — Datos

- [x] T-10 Migracion `20261108120000_enlaces_de_contacto_del_negocio.sql`: columnas,
      CHECK, GRANT SELECT anon/authenticated, RPC `actualizar_enlaces_negocio` (poner
      exige modo vendedor; quitar siempre), tabla `clics_enlaces_negocio` con RLS, RPC
      `registrar_clic_enlace_negocio` con lock por negocio.
- [x] T-11 `database.types.ts` editado a mano (columnas, tabla, 2 RPC).
- [ ] T-12 **Pedro**: `node scripts/apply-migration.mjs ... --dry-run`, luego aplicar,
      luego `node scripts/gen-types.mjs` y correr el bloque VERIFY (incluye `username` del
      job de pg_cron y dueno de la tabla).
- [x] T-13 Retencion: purga diaria a 90 dias con pg_cron (`purgar-clics-enlaces-negocio`)
      en la misma migracion; topes de 20/min por negocio y 5,000/h global en el RPC;
      indice en `created_at`.

## FASE 2 — Compartido y pruebas

- [x] T-20 `packages/shared/src/utils/enlaces-negocio.ts`: normalizadores, lista cerrada
      de hosts, rechazo de `..`/`%2e`/`\`, clase explicita de caracteres prohibidos,
      `urlInstagram`, `urlWhatsApp`, `listarEnlacesNegocio`.
- [x] T-21 `enlacesNegocioSchema` en `validators/profile.ts`.
- [x] T-22 Pruebas `apps/web/lib/perfil/enlaces-negocio.test.ts` (12 casos, en verde).

## FASE 3 — App

- [x] T-30 Formulario: cuatro campos en el bloque Modo Vendedor (`profile-form.tsx`,
      `editar/page.tsx`); fila nueva en el aviso de desactivacion (los enlaces se quitan).
- [x] T-31 `updateProfile`: validar antes de escribir, segundo RPC, guarda contra
      clientes viejos, modo vendedor apagado = quitar, revalidacion aunque falle el
      segundo RPC, mensajes por codigo (22023 y el 42501 esperado, del usuario; resto a
      Sentry). Pruebas `actions.enlaces.test.ts` (7 casos, en verde).
- [x] T-32 `<EnlacesNegocio>` + hueco `enlacesNegocio` en `ProfileHeader`; en Android,
      `Browser.open` para los hosts `*.google.com` (`lib/perfil/abrir-enlace-externo.ts`,
      3 casos de prueba).
- [x] T-33 Ficha publica: SELECT ampliado, regla de la resena (venta completada).
- [x] T-34 Perfil propio: SELECT del nucleo ampliado, render con `esDueno`.
- [x] T-35 Server Action `registrarClicEnlaceNegocio` + `clicEnlaceRateLimit` sin
      analitica + cubeta con resumen de IP (`lib/perfil/cubeta-clic.ts`); pruebas con
      `cargarReal` (6 casos, en verde).
- [x] T-36 Tarjeta de clics en `/seller/analytics` (count por canal; "—" ante error).
- [x] T-37 `pnpm type-check` en `packages/shared` y `apps/web`: limpio. ESLint de los
      archivos tocados: sin errores (2 avisos previos en `profile-header.tsx`, ajenos).
      `pnpm build` del web en verde sobre la primera iteracion (T-38 lo repite al final).
- [x] T-38 `pnpm build` local en verde sobre la version final (2cf9862). Repetir antes
      del push si la rama vuelve a cambiar (regla del repo; pide 8 GB de heap).
- [x] T-39 Revision adversarial, dos rondas. Ronda 1 (revisores de codigo y seguridad):
      0 criticos; corregidos lista cerrada de hosts y `..` en Maps, revalidacion aunque
      falle el segundo RPC, conteo con `count`, purga y topes, `<nav>`, clic central, host
      en minusculas. Ronda 2 (seis verificadores independientes, uno por afirmacion):
      SQL y React sostenidos; refutados y corregidos: `*.google.com` en `allowNavigation`
      (Android cargaba Google dentro del WebView → `Browser.open`), el freno de Upstash
      guardaba la IP (→ resumen con fecha + `analytics: false`), sin autoservicio para
      retirar el WhatsApp al dejar de vender (→ apagar el modo quita los enlaces),
      `\s` de JS ≠ `\s` de Postgres (→ clase explicita), numero de 10 digitos sin lada
      (→ 11-15 obligatorios), y tres frases de los docs que no coincidian con el codigo.
      Pendiente 🟢: `inert` en el bloque colapsado del formulario; Playwright de punta a
      punta (guardar → normalizar → botones → conteo) cuando haya staging con la migracion.

## FASE 4 — Verificacion en dispositivo (Pedro / Alejandro)

- [ ] T-40 Web: guardar, normalizar, borrar, mensajes por campo (docs, pasos 1-3).
- [ ] T-41 Web: ficha sin sesion, con sesion, con compra completada; conteo en analytics.
- [ ] T-42 Android fisico con la app instalada, por host (docs, pasos 6-9): `wa.me` e
      `instagram.com` → app o navegador; `maps.app.goo.gl` y `g.page` → Maps o navegador;
      `www.google.com/maps`, `maps.google.com` y `search.google.com/.../writereview` →
      pestana del sistema que se cierra y vuelve a la ficha. Nunca la web de Google
      encima de la ficha.
- [ ] T-43 iPhone: lo mismo (ahi todo deberia ir a la app o a Safari).
- [ ] T-44 **Alejandro**: revision visual de los botones (clases de `ChipCategoria`) y de la
      fila nueva del aviso de desactivacion.

## FASE 5 — Cierre

- [ ] T-50 Firmar D1-D8 de `proposal.md`.
- [ ] T-51 PR a `master` (lo mergea Javier); deploy automatico.
- [ ] T-52 Archivar el change (`openspec/changes/archive/`) y mergear el delta de
      `specs/selling/spec.md`.
- [ ] T-53 Siguiente AAB: quitar `*.google.com` de `allowNavigation` o adoptar
      `@capacitor/app-launcher`; revisar `analytics: true` del resto de limitadores.
