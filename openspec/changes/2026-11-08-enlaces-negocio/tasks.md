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
      legal-footer y seller-steps; `@capacitor/browser` solo en Wallet).
- [x] T-03 Formatos oficiales: wa.me (faq.whatsapp.com/5913398998672934), Maps URLs
      (developers.google.com/maps/documentation/urls/get-started), politica de resenas de
      Google (support.google.com/business/answer/3474122 y contributionpolicy/7400114).

## FASE 1 — Datos

- [x] T-10 Migracion `20261108120000_enlaces_de_contacto_del_negocio.sql`: columnas,
      CHECK, GRANT SELECT anon/authenticated, RPC `actualizar_enlaces_negocio`, tabla
      `clics_enlaces_negocio` con RLS, RPC `registrar_clic_enlace_negocio`.
- [x] T-11 `database.types.ts` editado a mano (columnas, tabla, 2 RPC).
- [ ] T-12 **Pedro**: `node scripts/apply-migration.mjs ... --dry-run`, luego aplicar,
      luego `node scripts/gen-types.mjs` y correr el bloque VERIFY.
- [x] T-13 Retencion: purga diaria a 90 dias con pg_cron (`purgar-clics-enlaces-negocio`)
      en la misma migracion; topes de 20/min por negocio y 5,000/h global en el RPC;
      indice en `created_at`.

## FASE 2 — Compartido y pruebas

- [x] T-20 `packages/shared/src/utils/enlaces-negocio.ts`: normalizadores, patrones,
      `urlInstagram`, `urlWhatsApp`, `listarEnlacesNegocio`.
- [x] T-21 `enlacesNegocioSchema` en `validators/profile.ts`.
- [x] T-22 Pruebas `apps/web/lib/perfil/enlaces-negocio.test.ts` (16 casos, en verde).

## FASE 3 — App

- [x] T-30 Formulario: cuatro campos en el bloque Modo Vendedor (`profile-form.tsx`,
      `editar/page.tsx`).
- [x] T-31 `updateProfile`: validar antes de escribir, segundo RPC, guarda contra
      clientes viejos, mensajes por codigo (22023/42501 del usuario; resto a Sentry).
- [x] T-32 `<EnlacesNegocio>` + hueco `enlacesNegocio` en `ProfileHeader`.
- [x] T-33 Ficha publica: SELECT ampliado, regla de la resena (venta completada).
- [x] T-34 Perfil propio: SELECT del nucleo ampliado, render con `esDueno`.
- [x] T-35 Server Action `registrarClicEnlaceNegocio` + `clicEnlaceRateLimit`; pruebas con
      `cargarReal` (6 casos, en verde).
- [x] T-36 Tarjeta de clics en `/seller/analytics`.
- [x] T-37 `pnpm type-check` en `packages/shared` y `apps/web`: limpio. ESLint de los
      archivos tocados: sin errores (2 avisos previos en `profile-header.tsx`, ajenos).
- [ ] T-38 `pnpm build` local antes del push (regla del repo; pide 8 GB de heap).
- [x] T-39 Revision adversarial del diff (dos revisores: codigo y seguridad). 0 criticos.
      Corregidos: lista cerrada de hosts de Google y rechazo de `..`/`%2e`/`\` en Maps
      (shared + RPC + CHECK); revalidacion del layout aunque falle el segundo RPC;
      conteo de clics con `count` por canal y "—" ante error; purga y topes de clics;
      `<nav>` accesible, clic central contado, host en minusculas antes de validar;
      el 42501 solo se muestra tal cual si es el de "activa el modo vendedor".
      Pendiente 🟢: `inert` en el bloque colapsado del formulario.

## FASE 4 — Verificacion en dispositivo (Pedro / Alejandro)

- [ ] T-40 Web: guardar, normalizar, borrar, mensajes por campo (docs, pasos 1-3).
- [ ] T-41 Web: ficha sin sesion, con sesion, con compra completada; conteo en analytics.
- [ ] T-42 Android fisico con la app instalada: cada boton abre WhatsApp / Instagram /
      Maps; sin la app, abre el navegador; al volver, la ficha sigue.
- [ ] T-43 iPhone: lo mismo.
- [ ] T-44 **Alejandro**: revision visual de los botones (clases de `ChipCategoria`).

## FASE 5 — Cierre

- [ ] T-50 Firmar D1-D7 de `proposal.md`.
- [ ] T-51 PR a `master` (lo mergea Javier); deploy automatico.
- [ ] T-52 Archivar el change (`openspec/changes/archive/`) y mergear el delta de
      `specs/selling/spec.md`.
