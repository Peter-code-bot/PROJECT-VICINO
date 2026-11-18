# Panel de admin: lista de usuarios, contador de la comunidad y roles

18-nov-2026. Tres arreglos del panel (`/admin` y `/admin/users`). Este
documento solo describe lo técnico: el repositorio es público, así que aquí no
van nombres de usuarios reales ni cifras de producción.

## 1. Lista de usuarios: todas las cuentas, con páginas

**Antes.** `app/admin/users/page.tsx` pedía los 50 perfiles más recientes
(`.limit(50)`) y no tenía páginas: del 51 en adelante no se veía nadie. El
buscador solo miraba `nombre` y `user_id` (el código `U1234567`) aunque el
campo decía «nombre, email o ID», armaba el filtro `.or()` pegando el texto
escrito (una coma o un paréntesis lo rompían) y no leía `error`, así que un
fallo se pintaba como «Sin resultados».

**Ahora.**
- Sin búsqueda: páginas de 50 en la base (`range` + conteo exacto), orden por
  `created_at` y desempate por `id`, con «Anterior/Siguiente» y «Mostrando
  51–N de N cuentas». Sin tope.
- Con búsqueda: cada palabra tiene que aparecer en alguno de estos campos, sin
  acentos ni mayúsculas: nombre, nombre del negocio, usuario, código, correo y
  nombre de registro (el `full_name` o `name` con que la cuenta se registró en
  Auth). Así una cuenta cuyo nombre de perfil es un apodo se encuentra por su
  nombre real, y una tienda por el nombre del negocio. La fila dice «Coincide
  por: …»; si coincidió por el nombre de registro, lo muestra marcado como dato
  que escribió la propia cuenta (cualquiera puede cambiarlo).
- La búsqueda lee los perfiles por tramos (hasta 5,000) y filtra en el
  servidor. Si algún día hay más, la página lo avisa: no recorta en silencio.
- El correo se busca completo, pero se pinta enmascarado (`con•••@ejemplo.mx`).
- Un error de la base se muestra como error y queda en Sentry.
- Las cuentas que no cuentan en las métricas llevan la etiqueta «Cuenta de
  prueba».
- El diálogo de la clave dice a qué cuenta se le concede o quita el rol
  (nombre y código), porque una búsqueda puede traer la fila por un dato que no
  se ve a primera vista.

**Por qué con el cliente de servicio.** `email` no se puede leer con el
cliente de usuario (grants por columna en `profiles`), y el nombre de registro
vive en Auth. Las dos páginas llaman a `requireAdminPage()` antes de crear el
cliente: el guard de `app/admin/layout.tsx` no corre en una navegación RSC
parcial.

Código: `lib/admin/busqueda-usuarios.ts` (lógica pura, con pruebas),
`lib/admin/usuarios-del-panel.ts` (lecturas) y `app/admin/users/page.tsx`.

## 2. Contador de la comunidad: sin cuentas de prueba

La tarjeta «Comunidad» de `/admin` contaba todos los perfiles, incluidas las
cuentas de prueba. Ahora no cuenta:

- por dominio de correo, las de datos inventados o de prueba:
  `@mock-appstore.vicino.mx` (el lote creado el 26-sep-2026, hora de Ciudad de
  México, para las capturas de las tiendas de apps), `@demo.vicino.mx`
  (compradores inventados de demostración) y `@example.com` (cuentas de
  diagnóstico del registro; es un dominio reservado que ninguna persona tiene);
- por UUID, tres cuentas de prueba con correo normal: una prueba manual del
  equipo, la de QA y la de la revisión de la ficha de Google Play.

Todo lo demás cuenta, tenga o no publicaciones, teléfono o foto, incluidas por
ahora las cuentas personales del equipo. No se borra, no se oculta y no se toca
ninguna fila. Lo mismo aplica a «vendedores activos» de esa tarjeta. Debajo, la
tarjeta dice cuántas cuentas de prueba deja fuera; si el criterio no se puede
aplicar, muestra el total sin filtrar con un aviso en ámbar.

El criterio está en `lib/admin/cuentas-fuera-de-metricas.ts`. Para sacar otra
cuenta, se agrega ahí su UUID con un motivo (nunca su correo). La marca en la
base (`cuentas_internas`, PR #84) sigue propuesta aparte; si se aplica,
debería reemplazar esa lista.

Las demás tarjetas (publicaciones, transacciones) no cambian.

Las cuentas `@demo.vicino.mx` además quedan bloqueadas para iniciar sesión
(`20261118140000_bloquear_cuentas_demo.sql`): las crearon los seeds con una
contraseña que está escrita en este repositorio, y el seed corrió en
producción. Se conservan sus registros.

## 3. Roles: solo con la clave del panel

Las Server Actions `assignRole` y `removeRole` comprueban la sesión de admin y,
justo después, la clave (`ADMIN_SECURITY_PASSWORD`), antes de la cuota de
escritura y de la validación. Luego llaman a `admin_set_user_role_secure`, que
solo acepta `service_role` (`20261011213000`). Sin la variable, rechazan el
cambio con «Falta configurar la clave de seguridad del panel».

**Lo que faltaba.** En producción quedaban dos funciones `SECURITY DEFINER`
más viejas con `EXECUTE` para `authenticated`: `manage_user_role(uuid,
app_role, text)` y `make_admin(text)`. Solo comprobaban que quien llama fuera
admin, así que con una sesión de admin abierta se podía conceder o quitar
cualquier rol por PostgREST (`/rest/v1/rpc/manage_user_role`) sin pasar por la
clave. Ningún código las usaba.

**`20261118120000_roles_solo_con_clave_del_panel.sql`** les quita `EXECUTE` a
`PUBLIC`, `anon` y `authenticated` y verifica el resultado en la misma
transacción. No las borra; `postgres` y `service_role` conservan `EXECUTE`,
aunque ninguna sirve sin una sesión de admin. Si una de las dos no existe (por
ejemplo, en una base armada desde el repo, donde `manage_user_role` no está),
la salta en vez de abortar. Reversión:
`docs/rollback/20261118120000_roles_solo_con_clave_del_panel_rollback.sql`.
Salida de emergencia si no queda ningún admin: `docs/moderation-setup.md`, 2.6.

**Y el canal bueno tampoco funcionaba.** `admin_set_user_role_secure`
comprobaba al actor con `public.has_role(p_actor_id, 'admin')`. El `has_role`
de producción lleva un guard contra la enumeración de roles: si el id no es el
de `auth.uid()` y quien pregunta no es admin, devuelve `false`. En el canal de
servicio no hay sesión, así que respondía «no es admin» del admin real y toda
concesión o retiro desde el panel terminaba en «forbidden: solo un admin puede
repartir roles», con la clave correcta o sin ella. Las pruebas de octubre no lo
vieron porque usaban un `has_role` sin ese guard.

**`20261118130000_canal_de_roles_sin_has_role.sql`** reemplaza la función con
el mismo cuerpo, salvo la comprobación del actor, que ahora mira `user_roles`
directamente. La firma no cambia (ni el código ni los tipos), solo
`service_role` la ejecuta y la migración verifica que ya no use `has_role`. No
toca `has_role`. Reversión:
`docs/rollback/20261118130000_canal_de_roles_sin_has_role_rollback.sql`
(devuelve la versión rota).

**La clave.** Tiene que vivir solo en el entorno de Vercel (Production), nunca
en el repositorio. Para saber si está configurada sin ver su valor:
`vercel env ls production` (lista solo nombres). Cambiar su valor exige un
nuevo despliegue para que lo tome el servidor.

## Pruebas

```bash
# Búsqueda, páginas y criterio del contador
(cd apps/web && node --import tsx --test lib/admin/busqueda-usuarios.test.ts lib/admin/cuentas-fuera-de-metricas.test.ts)

# Desde la raíz del repo. PostgreSQL en WASM con las funciones idénticas a
# producción: antes de 20261118120000 una sesión de admin cambiaba roles sin la
# clave y después da 42501 (también en una base sin manage_user_role); con la
# versión de octubre el canal del servidor rechaza al admin real y con
# 20261118130000 concede y quita Moderador y Admin.
pnpm exec tsx scripts/test-roles-sin-atajos.ts
```

Las dos corren en la CI (`security.yml`, job «TypeScript type check»).
