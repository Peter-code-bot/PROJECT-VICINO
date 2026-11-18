/**
 * Busqueda y paginas de la lista de usuarios del panel de admin.
 *
 * POR QUE EXISTE. La lista cargaba los 50 perfiles mas recientes y nada mas:
 * del 51 en adelante no habia forma de llegar sin buscar. Y el buscador solo
 * miraba `nombre` y `user_id` (el codigo U1234567), aunque el campo prometia
 * "nombre, email o ID". Una tienda que se busca por el nombre del negocio, una
 * cuenta cuyo nombre de perfil no es el de registro ("Pepe" en el perfil,
 * "Jose" al registrarse) o una que solo se conoce por su correo quedaban fuera.
 *
 * Aqui vive solo la logica pura, sin red ni Supabase, para poder probarla:
 *   - normalizar sin acentos ni mayusculas ("Canción" = "cancion"),
 *   - exigir que CADA palabra aparezca en algun campo, aunque sea en campos
 *     distintos ("jose ejemplo" = nombre de registro + correo),
 *   - calcular la pagina con limites seguros,
 *   - enmascarar el correo para pintarlo.
 */

export const USUARIOS_POR_PAGINA = 50;

/**
 * Tope de perfiles que se leen para buscar. Si se alcanza, la pagina lo dice:
 * un tope callado es justo el fallo que se esta arreglando.
 */
export const MAX_PERFILES_PARA_BUSCAR = 5000;

/** Lo que se escribe en el buscador se recorta a este largo. */
export const MAX_LARGO_BUSQUEDA = 100;

const MAX_PALABRAS = 8;

/** Primer valor de un parametro de la URL (`?q=a&q=b` llega como arreglo). */
export function primerValor(valor: unknown): string | undefined {
  if (Array.isArray(valor)) return typeof valor[0] === "string" ? valor[0] : undefined;
  return typeof valor === "string" ? valor : undefined;
}

/** Minusculas, sin acentos ni dieresis y con los espacios colapsados. */
export function normalizarTexto(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Palabras a buscar, normalizadas y sin repetir. Una `@` inicial se quita
 * para que "@usuario" encuentre al usuario.
 */
export function palabrasDeBusqueda(valor: unknown): string[] {
  const texto = primerValor(valor);
  if (!texto) return [];
  const normalizado = normalizarTexto(texto.slice(0, MAX_LARGO_BUSQUEDA));
  if (!normalizado) return [];
  const palabras = normalizado
    .split(" ")
    .map((palabra) => palabra.replace(/^@+/, ""))
    .filter(Boolean);
  return [...new Set(palabras)].slice(0, MAX_PALABRAS);
}

export const CAMPOS_BUSCABLES = [
  "nombre",
  "nombre_negocio",
  "username",
  "user_id",
  "correo",
  "nombre_registro",
] as const;

export type CampoBuscable = (typeof CAMPOS_BUSCABLES)[number];

export type CamposBuscables = Partial<Record<CampoBuscable, string | null | undefined>>;

export const ETIQUETA_CAMPO: Record<CampoBuscable, string> = {
  nombre: "nombre",
  nombre_negocio: "negocio",
  username: "usuario",
  user_id: "código",
  correo: "correo",
  nombre_registro: "nombre de registro",
};

/**
 * Campos donde aparece alguna de las palabras, en el orden de
 * CAMPOS_BUSCABLES, o `null` si alguna palabra no aparece en NINGUN campo.
 * Sin palabras no hay busqueda: tambien da `null`.
 */
export function camposQueCoinciden(
  campos: CamposBuscables,
  palabras: readonly string[],
): CampoBuscable[] | null {
  if (palabras.length === 0) return null;
  const textos = CAMPOS_BUSCABLES.map((campo) => [campo, normalizarTexto(campos[campo])] as const);
  const coinciden = new Set<CampoBuscable>();
  for (const palabra of palabras) {
    let aparece = false;
    for (const [campo, texto] of textos) {
      if (texto && texto.includes(palabra)) {
        coinciden.add(campo);
        aparece = true;
      }
    }
    if (!aparece) return null;
  }
  return CAMPOS_BUSCABLES.filter((campo) => coinciden.has(campo));
}

/** Numero de pagina pedido en la URL: entero de 1 en adelante; lo demas es 1. */
export function leerPagina(valor: unknown): number {
  const texto = primerValor(valor);
  if (!texto || !/^\d{1,6}$/.test(texto)) return 1;
  const numero = Number(texto);
  return numero >= 1 ? numero : 1;
}

export interface Pagina {
  /** Pagina mostrada (1-based), ya ajustada a las que existen. */
  pagina: number;
  /** Total de paginas; minimo 1 aunque no haya resultados. */
  paginas: number;
  /** Indice 0-based del primer elemento, como lo pide PostgREST en .range(). */
  desde: number;
  /** Indice 0-based e INCLUSIVO del ultimo elemento posible de la pagina. */
  hasta: number;
  /** Total de elementos. */
  total: number;
}

/**
 * Pagina a mostrar. Una pagina pedida que ya no existe (se borro gente, o la
 * URL vieja era de otra busqueda) cae en la ultima en vez de pintar un vacio.
 */
export function calcularPagina(
  total: number,
  pedida: number,
  porPagina: number = USUARIOS_POR_PAGINA,
): Pagina {
  const totalSeguro = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const tamano = Number.isFinite(porPagina) && porPagina >= 1 ? Math.floor(porPagina) : USUARIOS_POR_PAGINA;
  const paginas = Math.max(1, Math.ceil(totalSeguro / tamano));
  const pedidaSegura = Number.isFinite(pedida) && pedida >= 1 ? Math.floor(pedida) : 1;
  const pagina = Math.min(pedidaSegura, paginas);
  const desde = (pagina - 1) * tamano;
  return { pagina, paginas, desde, hasta: desde + tamano - 1, total: totalSeguro };
}

/** "101–123 de 123": rango humano de la pagina, o null si no hay elementos. */
export function rangoVisible(pagina: Pagina): { primero: number; ultimo: number } | null {
  if (pagina.total === 0) return null;
  return { primero: pagina.desde + 1, ultimo: Math.min(pagina.hasta + 1, pagina.total) };
}

/** Enlace a otra pagina conservando la busqueda y el rol. La pagina 1 no lleva `page`. */
export function hrefDePagina(
  base: string,
  filtros: { q?: string; role?: string },
  pagina: number,
): string {
  const parametros = new URLSearchParams();
  if (filtros.q) parametros.set("q", filtros.q);
  if (filtros.role) parametros.set("role", filtros.role);
  if (pagina > 1) parametros.set("page", String(Math.floor(pagina)));
  const consulta = parametros.toString();
  return consulta ? `${base}?${consulta}` : base;
}

/**
 * "con•••@ejemplo.mx". El panel busca por el correo completo, pero no lo pinta
 * entero: la lista acaba en capturas de pantalla.
 */
export function enmascararCorreo(correo: unknown): string | null {
  if (typeof correo !== "string") return null;
  const limpio = correo.trim();
  const arroba = limpio.lastIndexOf("@");
  if (arroba <= 0 || arroba === limpio.length - 1) return null;
  const local = limpio.slice(0, arroba);
  const dominio = limpio.slice(arroba + 1);
  const visible = local.length > 3 ? local.slice(0, 3) : local.slice(0, 1);
  return `${visible}•••@${dominio}`;
}
