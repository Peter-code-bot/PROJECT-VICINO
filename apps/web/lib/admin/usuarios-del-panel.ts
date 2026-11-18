import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  calcularPagina,
  camposQueCoinciden,
  MAX_PERFILES_PARA_BUSCAR,
  type CampoBuscable,
  type Pagina,
} from "./busqueda-usuarios";

type ClienteDeServicio = SupabaseClient<Database>;
type Rol = Database["public"]["Enums"]["app_role"];

/**
 * Lo que pinta cada fila. `email` sale de profiles (la copia el trigger de
 * alta y hoy coincide con Auth en todas las cuentas); solo el cliente de
 * servicio lo puede leer.
 */
const COLUMNAS =
  "id, nombre, user_id, username, es_vendedor, trust_level, total_sales, created_at, seller_type, nombre_negocio, email";

/** Lo que PostgREST entrega como maximo por respuesta (max_rows de Supabase). */
const TRAMO = 1000;

/** Seguro contra un bucle al paginar Auth; con TRAMO por pagina sobra. */
const MAX_PAGINAS_DE_AUTH = 50;

export type UsuarioDelPanel = {
  id: string;
  nombre: string | null;
  user_id: string | null;
  username: string | null;
  es_vendedor: boolean | null;
  trust_level: Database["public"]["Tables"]["profiles"]["Row"]["trust_level"];
  total_sales: number | null;
  created_at: string | null;
  seller_type: string | null;
  nombre_negocio: string | null;
  email: string | null;
  /** Solo al buscar: en que campos aparecio lo buscado. */
  coincidencias?: CampoBuscable[];
  /**
   * Solo al buscar y solo si coincidio por ahi: el nombre con que la cuenta se
   * registro. Lo escribe la propia cuenta en Auth, asi que se pinta como dato
   * declarado, para que nadie conceda un rol creyendo que es otra persona.
   */
  nombreRegistro?: string;
};

export type ResultadoUsuarios =
  | {
      ok: true;
      usuarios: UsuarioDelPanel[];
      pagina: Pagina;
      roles: Map<string, Rol[]>;
      /** Limites que el admin tiene que ver: nunca se recorta en silencio. */
      avisos: string[];
    }
  | { ok: false };

/**
 * Una pagina de la lista de usuarios del panel.
 *
 * Sin palabras: pagina directa en la base (`range` + conteo exacto), sin
 * tope. Con palabras: lee los perfiles (por tramos de 1000, hasta
 * MAX_PERFILES_PARA_BUSCAR) y el nombre de registro de Auth, y filtra aqui,
 * sin acentos ni mayusculas. Se hace aqui y no con un `.or()` de PostgREST
 * porque ese filtro se armaba pegando el texto del buscador: una coma o un
 * parentesis lo rompian y la pagina decia "Sin resultados" sin error.
 *
 * Quien llame tiene que haber pasado antes por requireAdminPage().
 */
export async function leerUsuariosDelPanel(
  admin: ClienteDeServicio,
  { palabras, rol, paginaPedida }: { palabras: string[]; rol: Rol | undefined; paginaPedida: number },
): Promise<ResultadoUsuarios> {
  const roles = await leerRoles(admin);
  if (!roles) return { ok: false };

  const conRol = rol
    ? new Set([...roles].filter(([, suyos]) => suyos.includes(rol)).map(([id]) => id))
    : null;

  if (palabras.length === 0) return listar(admin, roles, conRol, paginaPedida);
  return buscar(admin, roles, conRol, palabras, paginaPedida);
}

async function leerRoles(admin: ClienteDeServicio): Promise<Map<string, Rol[]> | null> {
  const roles = new Map<string, Rol[]>();
  // Por tramos y contra el total exacto, como la busqueda: son pocas filas,
  // pero un mapa de roles cortado en silencio pintaria a un admin sin su rol.
  let leidas = 0;
  for (let total = Infinity; leidas < total; ) {
    const { data, error, count } = await admin
      .from("user_roles")
      .select("user_id, role", { count: "exact" })
      .order("user_id", { ascending: true })
      .order("role", { ascending: true })
      .range(leidas, leidas + TRAMO - 1);
    if (error || !data || count === null) {
      Sentry.captureException(error ?? new Error("roles nulos"), { tags: { action: "admin.usuarios.roles" } });
      return null;
    }
    total = count;
    if (data.length === 0) break;
    leidas += data.length;
    for (const fila of data) {
      roles.set(fila.user_id, [...(roles.get(fila.user_id) ?? []), fila.role]);
    }
  }
  return roles;
}

async function listar(
  admin: ClienteDeServicio,
  roles: Map<string, Rol[]>,
  conRol: Set<string> | null,
  paginaPedida: number,
): Promise<ResultadoUsuarios> {
  if (conRol && conRol.size === 0) {
    return { ok: true, usuarios: [], pagina: calcularPagina(0, 1), roles, avisos: [] };
  }

  let conteo = admin.from("profiles").select("id", { count: "exact", head: true });
  if (conRol) conteo = conteo.in("id", [...conRol]);
  const { count, error: errorConteo } = await conteo;
  if (errorConteo || count === null) {
    Sentry.captureException(errorConteo ?? new Error("conteo nulo"), {
      tags: { action: "admin.usuarios.contar" },
    });
    return { ok: false };
  }

  const pagina = calcularPagina(count, paginaPedida);
  // El id desempata: con created_at repetido, el orden entre paginas tiene
  // que ser estable o una cuenta podria salir dos veces y otra ninguna.
  let consulta = admin
    .from("profiles")
    .select(COLUMNAS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(pagina.desde, pagina.hasta);
  if (conRol) consulta = consulta.in("id", [...conRol]);
  const { data, error } = await consulta;
  if (error || !data) {
    Sentry.captureException(error ?? new Error("lista nula"), { tags: { action: "admin.usuarios.listar" } });
    return { ok: false };
  }
  return { ok: true, usuarios: data, pagina, roles, avisos: [] };
}

async function buscar(
  admin: ClienteDeServicio,
  roles: Map<string, Rol[]>,
  conRol: Set<string> | null,
  palabras: string[],
  paginaPedida: number,
): Promise<ResultadoUsuarios> {
  const avisos: string[] = [];

  // Primero el total exacto y luego tramos hasta tenerlos: asi no importa
  // cuantas filas entregue PostgREST por respuesta (si fueran menos de 1000,
  // parar en el primer tramo "corto" dejaria fuera al resto en silencio).
  const { count, error: errorConteo } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (errorConteo || count === null) {
    Sentry.captureException(errorConteo ?? new Error("conteo nulo"), {
      tags: { action: "admin.usuarios.buscar" },
    });
    return { ok: false };
  }
  const objetivo = Math.min(count, MAX_PERFILES_PARA_BUSCAR);
  const perfiles: UsuarioDelPanel[] = [];
  while (perfiles.length < objetivo) {
    const desde = perfiles.length;
    const hasta = Math.min(desde + TRAMO, objetivo) - 1;
    const { data, error } = await admin
      .from("profiles")
      .select(COLUMNAS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(desde, hasta);
    if (error || !data) {
      Sentry.captureException(error ?? new Error("tramo nulo"), { tags: { action: "admin.usuarios.buscar" } });
      return { ok: false };
    }
    // Se borraron cuentas entre el conteo y la lectura: ya no hay mas.
    if (data.length === 0) break;
    perfiles.push(...data);
  }
  if (count > MAX_PERFILES_PARA_BUSCAR) {
    avisos.push(
      `La búsqueda revisó los ${MAX_PERFILES_PARA_BUSCAR.toLocaleString("es-MX")} perfiles más recientes; puede haber más coincidencias.`,
    );
  }

  const deAuth = await leerDatosDeAuth(admin);
  if (!deAuth.ok) {
    avisos.push("No se pudo leer el nombre de registro: la búsqueda usó solo los datos del perfil.");
  } else if (deAuth.recortado) {
    avisos.push("No se leyó el nombre de registro de todas las cuentas; puede haber más coincidencias.");
  }

  const coinciden: UsuarioDelPanel[] = [];
  for (const perfil of perfiles) {
    if (conRol && !conRol.has(perfil.id)) continue;
    const auth = deAuth.ok ? deAuth.porId.get(perfil.id) : undefined;
    const campos = camposQueCoinciden(
      {
        nombre: perfil.nombre,
        nombre_negocio: perfil.nombre_negocio,
        username: perfil.username,
        user_id: perfil.user_id,
        correo: [auth?.correo, perfil.email].filter(Boolean).join(" "),
        nombre_registro: auth?.nombreRegistro,
      },
      palabras,
    );
    if (campos) {
      coinciden.push({
        ...perfil,
        coincidencias: campos,
        ...(campos.includes("nombre_registro") && auth?.nombreRegistro
          ? { nombreRegistro: auth.nombreRegistro }
          : {}),
      });
    }
  }

  const pagina = calcularPagina(coinciden.length, paginaPedida);
  return {
    ok: true,
    usuarios: coinciden.slice(pagina.desde, pagina.hasta + 1),
    pagina,
    roles,
    avisos,
  };
}

type DatosDeAuth =
  | { ok: true; recortado: boolean; porId: Map<string, { correo: string | null; nombreRegistro: string | null }> }
  | { ok: false };

/**
 * Correo y nombre con el que se registro cada cuenta (user_metadata de Auth).
 * El nombre del perfil se puede cambiar o ser un apodo; el de registro es el
 * que la gente suele conocer.
 */
async function leerDatosDeAuth(admin: ClienteDeServicio): Promise<DatosDeAuth> {
  const porId = new Map<string, { correo: string | null; nombreRegistro: string | null }>();
  // Se para con una pagina vacia y no con una "corta": si Auth entregara menos
  // por pagina de lo pedido, parar en la primera corta dejaria fuera al resto
  // sin avisar. El tope de paginas es solo un seguro contra un bucle.
  for (let pagina = 1; pagina <= MAX_PAGINAS_DE_AUTH; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: TRAMO });
    if (error) {
      Sentry.captureException(error, { tags: { action: "admin.usuarios.auth" } });
      return { ok: false };
    }
    if (data.users.length === 0) return { ok: true, recortado: false, porId };
    const antes = porId.size;
    for (const usuario of data.users) {
      porId.set(usuario.id, {
        correo: usuario.email ?? null,
        nombreRegistro:
          textoDeMetadata(usuario.user_metadata, "full_name") ?? textoDeMetadata(usuario.user_metadata, "name"),
      });
    }
    // Una pagina que no trae nadie nuevo (Auth ignoro `page`) tambien termina.
    if (porId.size === antes) return { ok: true, recortado: false, porId };
    if (porId.size >= MAX_PERFILES_PARA_BUSCAR) break;
  }
  return { ok: true, recortado: true, porId };
}

function textoDeMetadata(metadata: unknown, clave: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const valor = (metadata as Record<string, unknown>)[clave];
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}
