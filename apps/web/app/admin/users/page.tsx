import Link from "next/link";
import { cleanDisplayName, publicProfileName } from "@vicino/shared";
import { requireAdminPage } from "@/lib/auth/require-admin-page";
import { createAdminClient } from "@/lib/supabase/admin";
import { SellerBadge } from "@/components/shared/seller-badge";
import { Constants } from "@/types/database.types";
import {
  enmascararCorreo,
  ETIQUETA_CAMPO,
  hrefDePagina,
  leerPagina,
  MAX_LARGO_BUSQUEDA,
  palabrasDeBusqueda,
  primerValor,
  rangoVisible,
} from "@/lib/admin/busqueda-usuarios";
import { estaFueraDeMetricas } from "@/lib/admin/cuentas-fuera-de-metricas";
import { leerUsuariosDelPanel } from "@/lib/admin/usuarios-del-panel";
import { RoleActions } from "./role-actions";

export const metadata = { title: "Admin — Usuarios" };

const ETIQUETA_ROL: Record<string, string> = { admin: "Admin", moderator: "Moderador", user: "Usuario" };
const ENTRE_ROL: Record<string, string> = { admin: "entre administradores", moderator: "entre moderadores", user: "entre usuarios" };

interface Props {
  searchParams: Promise<{ q?: string | string[]; role?: string | string[]; page?: string | string[] }>;
}

export default async function AdminUsersPage({ searchParams }: Props) {
  // Solo admins (no moderadores). Esta pagina crea el cliente de servicio
  // para leer y buscar correos, asi que comprueba el rol ella misma: el guard
  // del layout no corre en una navegacion RSC parcial (lib/supabase/admin.ts).
  await requireAdminPage();

  const params = await searchParams;
  // Lo que se busca, lo que se repite en pantalla y lo que llevan los enlaces
  // de pagina es lo mismo: el texto recortado al largo maximo.
  const q = (primerValor(params.q)?.trim() ?? "").slice(0, MAX_LARGO_BUSQUEDA);
  const palabras = palabrasDeBusqueda(q);

  // El rol llega por la URL, no por el <select>, asi que puede ser cualquier
  // cosa. Se contrasta contra el enum app_role de la base —unica fuente de
  // verdad: un rol nuevo en el enum entra aqui sin tocar esta pagina— y un
  // valor inexistente se ignora en vez de filtrar por el, que es justo lo que
  // el <select> ensena al no encontrar su opcion.
  const rolPedido = primerValor(params.role);
  const roleFilter = Constants.public.Enums.app_role.find((r) => r === rolPedido);

  const resultado = await leerUsuariosDelPanel(createAdminClient(), {
    palabras,
    rol: roleFilter,
    paginaPedida: leerPagina(params.page),
  });

  const filtros = { q: q || undefined, role: roleFilter };
  const buscando = palabras.length > 0;

  return (
    <div className="space-y-4 flex flex-col flex-1 h-full">
      <h1 className="text-xl font-bold">Usuarios</h1>

      <div className="space-y-1.5">
        <form className="flex flex-col sm:flex-row flex-wrap gap-2">
          <input
            name="q"
            type="text"
            defaultValue={q}
            maxLength={MAX_LARGO_BUSQUEDA}
            aria-label="Buscar usuarios"
            aria-describedby="ayuda-busqueda-usuarios"
            placeholder="Nombre, negocio, @usuario o correo"
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <select
            name="role"
            defaultValue={roleFilter ?? ""}
            aria-label="Filtrar por rol"
            className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary cursor-pointer"
          >
            <option value="">Todos los roles</option>
            <option value="admin">Administradores</option>
            <option value="moderator">Moderadores</option>
          </select>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Buscar
          </button>
        </form>
        <p id="ayuda-busqueda-usuarios" className="text-xs text-muted-foreground">
          Busca por nombre, negocio, @usuario, código, correo o nombre de registro. No importan acentos ni mayúsculas.
        </p>
      </div>

      {!resultado.ok ? (
        // Antes un error se pintaba igual que una busqueda sin resultados: la
        // consulta no desestructuraba `error`. Roto y vacio no son lo mismo.
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          No se pudo cargar la lista de usuarios. Recarga la página; si sigue fallando, el error quedó registrado en Sentry.
        </div>
      ) : (
        <>
          <Resumen
            total={resultado.pagina.total}
            rango={rangoVisible(resultado.pagina)}
            buscando={buscando}
            q={q}
            rol={roleFilter}
          />

          {resultado.avisos.map((aviso) => (
            <p
              key={aviso}
              className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
            >
              {aviso}
            </p>
          ))}

          {resultado.usuarios.length > 0 ? (
            <div className="space-y-2">
              {resultado.usuarios.map((u) => {
                const roles = resultado.roles.get(u.id) ?? [];
                const correo = enmascararCorreo(u.email);
                const nombre = cleanDisplayName(publicProfileName(u, "Sin nombre"));
                const codigo = u.user_id ?? u.username;
                const ventas = u.total_sales ?? 0;
                return (
                  <div
                    key={u.id}
                    className="rounded-lg border p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 w-full"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Por aqui salia el rombo con el signo de interrogacion de
                            la captura: esta pantalla era la UNICA que pintaba el
                            nombre crudo de la base. El resto de la app pasa por
                            cleanDisplayName, que normaliza a NFC y repara los
                            apellidos que quedaron con el caracter de reemplazo
                            cuando un script antiguo escribio sin UTF-8. El dato
                            corrupto tambien se arregla en la base
                            (20260916150000), pero esta defensa se queda: quien
                            revisa cuentas no puede ser el unico que vea basura. */}
                        <span className="font-medium text-sm [overflow-wrap:anywhere]">{nombre}</span>
                        <SellerBadge level={u.trust_level ?? "nuevo"} size="sm" />
                        {u.es_vendedor && (
                          <span className="text-xs bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded-full">
                            Vendedor
                          </span>
                        )}
                        {roles.map((r) => (
                          <span
                            key={r}
                            className="text-xs bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-300 px-2 py-0.5 rounded-full"
                          >
                            {ETIQUETA_ROL[r] ?? r}
                          </span>
                        ))}
                        {estaFueraDeMetricas(u) && (
                          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                            Cuenta de prueba<span className="sr-only"> (no cuenta en las métricas del panel)</span>
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        <span>@{u.username ?? u.user_id}</span>
                        {u.username && u.username !== u.user_id && (
                          <span className="font-mono">{u.user_id}</span>
                        )}
                        {correo && <span>{correo}</span>}
                        <span>{ventas === 1 ? "1 venta" : `${ventas} ventas`}</span>
                      </div>
                      {u.nombreRegistro && (
                        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          Nombre de registro (lo escribió la cuenta): {u.nombreRegistro}
                        </p>
                      )}
                      {u.coincidencias && u.coincidencias.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Coincide por: {u.coincidencias.map((campo) => ETIQUETA_CAMPO[campo]).join(", ")}
                        </p>
                      )}
                    </div>
                    <RoleActions
                      userId={u.id}
                      currentRoles={roles}
                      cuenta={codigo ? `${nombre} (${codigo})` : nombre}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-12">
              <p className="text-sm text-muted-foreground">
                {buscando ? "Ninguna cuenta coincide con la búsqueda." : "Sin resultados"}
              </p>
              {roleFilter && (
                <Link
                  href={hrefDePagina("/admin/users", { q: q || undefined }, 1)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {buscando ? "Buscar en todos los roles" : "Ver todas las cuentas"}
                </Link>
              )}
            </div>
          )}

          {resultado.pagina.paginas > 1 && (
            <nav aria-label="Páginas de la lista de usuarios" className="grid grid-cols-3 items-center gap-2 pt-2">
              {resultado.pagina.pagina > 1 ? (
                <Link
                  href={hrefDePagina("/admin/users", filtros, resultado.pagina.pagina - 1)}
                  rel="prev"
                  className="justify-self-start rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-ring"
                >
                  <span aria-hidden="true">← </span>Anterior
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}
              <span className="text-center text-xs text-muted-foreground">
                Página {resultado.pagina.pagina} de {resultado.pagina.paginas}
              </span>
              {resultado.pagina.pagina < resultado.pagina.paginas ? (
                <Link
                  href={hrefDePagina("/admin/users", filtros, resultado.pagina.pagina + 1)}
                  rel="next"
                  className="justify-self-end rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-ring"
                >
                  Siguiente<span aria-hidden="true"> →</span>
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}
            </nav>
          )}
        </>
      )}

      <div className="mt-6 p-4 rounded-xl bg-muted/50 text-sm text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Roles disponibles:</p>
        <p>• <strong>Admin</strong> — Acceso completo: usuarios, métricas financieras, verificaciones, disputas, moderación</p>
        <p>• <strong>Moderador</strong> — Acceso limitado: verificaciones, disputas, moderación de contenido (sin gestión de usuarios ni métricas financieras)</p>
        <p>• <strong>Cuenta de prueba</strong> — Existe y funciona, pero no cuenta en las métricas del panel</p>
      </div>
    </div>
  );
}

function Resumen({
  total,
  rango,
  buscando,
  q,
  rol,
}: {
  total: number;
  rango: { primero: number; ultimo: number } | null;
  buscando: boolean;
  q: string;
  rol: string | undefined;
}) {
  const entreRol = rol ? ` ${ENTRE_ROL[rol] ?? ""}`.trimEnd() : "";
  if (buscando) {
    if (total === 0) return null;
    const varias = rango !== null && total > rango.ultimo - rango.primero + 1;
    return (
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" aria-live="polite">
        {total === 1 ? "1 resultado" : `${total} resultados`} para «{q}»{entreRol}
        {varias && rango ? ` · mostrando ${rango.primero}–${rango.ultimo}` : ""}
      </p>
    );
  }
  if (!rango) return null;
  const cuentas = total === 1 ? "cuenta" : "cuentas";
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      {rango.primero === rango.ultimo
        ? `Mostrando ${rango.primero} de ${total} ${cuentas}`
        : `Mostrando ${rango.primero}–${rango.ultimo} de ${total} ${cuentas}`}
      {entreRol}
    </p>
  );
}
