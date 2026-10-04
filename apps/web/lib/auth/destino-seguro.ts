/**
 * Destino interno seguro a partir de un ?next= que viene de la URL.
 *
 * Vive en su propio modulo para poder probarse. Un parametro de redireccion
 * que se obedece a ciegas es una redireccion abierta: basta //otro.example
 * para que el navegador lo lea como otro dominio y mande ahi al usuario
 * recien autenticado. El fallo no se ve en pantalla, solo lo ve quien lo
 * explota.
 */
export function destinoSeguro(next: string | null | undefined): string {
  if (!next) return "/";

  // Un caracter de control descalifica la ruta entera.
  //
  // Los navegadores TIRAN el tabulador y los saltos de linea de una URL antes
  // de resolverla. Asi que un "/<TAB>/evil.example" pasaba las tres guardas de
  // abajo —empieza por una barra, no por dos, y no lleva barra invertida— y el
  // navegador lo convertia despues en "//evil.example", que es otro dominio.
  // Redireccion abierta, y de las caras: este valor se obedece justo despues
  // de crear la cuenta, con la sesion ya emitida.
  //
  // Se RECHAZA en vez de limpiar, porque limpiar obliga a acertar la lista
  // exacta de caracteres que cada navegador decide ignorar, y esa lista no la
  // controlamos nosotros. Una ruta interna legitima nunca lleva caracteres de
  // control, asi que rechazar no le cierra la puerta a ningun caso real.
  if (tieneCaracterDeControl(next)) return "/";

  // Tiene que ser una ruta interna.
  if (!next.startsWith("/")) return "/";
  // //host y /\/host se leen como otro dominio.
  if (next.startsWith("//")) return "/";
  // Algunos navegadores normalizan la barra invertida a barra: /\/host
  // acabaria siendo //host.
  if (next.includes(BARRA_INVERTIDA)) return "/";
  return next;
}

/**
 * Cualquier cosa por debajo del espacio (tabulador, salto de linea, retorno de
 * carro, nulo...) mas el DEL.
 *
 * Se comparan codigos y no se usa una expresion regular por el mismo motivo
 * que BARRA_INVERTIDA de abajo: un escape mal puesto dentro de una clase de
 * caracteres no da error, solo deja de casar, y una guarda que deja de casar
 * en silencio es peor que no tenerla.
 */
function tieneCaracterDeControl(valor: string): boolean {
  for (let i = 0; i < valor.length; i += 1) {
    const codigo = valor.charCodeAt(i);
    if (codigo < 32 || codigo === 127) return true;
  }
  return false;
}

/** Construida y no escrita: escapar barras dentro de literales es donde mas
 *  facil es equivocarse, y el error no falla, solo cambia lo que casa. */
const BARRA_INVERTIDA = String.fromCharCode(92);

/** Email recovery has its own authenticated step, before returning to next. */
export function destinoCallbackSeguro(next: unknown): string {
  if (typeof next === "string" && destinoSeguro(next) === next) {
    try {
      const url = new URL(next, "https://vicino.invalid");
      if (url.pathname === "/reset-password") return `/reset-password?next=${encodeURIComponent(destinoAutenticadoSeguro(url.searchParams.get("next")))}`;
    } catch { return "/"; }
  }
  return destinoAutenticadoSeguro(next);
}

/** A failed recovery callback returns to login with the final context, never
 * to the password-change step without a session. Shared with native callbacks.
 */
export function destinoTrasErrorAuth(next: unknown): string {
  const callback = destinoCallbackSeguro(next);
  return callback.startsWith("/reset-password?")
    ? destinoAutenticadoSeguro(new URL(callback, "https://vicino.invalid").searchParams.get("next"))
    : destinoAutenticadoSeguro(callback);
}

/**
 * Detecta si una ruta interna corresponde a una superficie de autenticacion.
 * Extrae el pathname antes de cualquier '?' o '#' y normaliza a minusculas.
 */
export function esRutaAuth(ruta: string): boolean {
  const path = (ruta.split(/[?#]/, 1)[0] ?? "/").toLowerCase();
  return (
    path === "/auth" || path.startsWith("/auth/") || path === "/callback" || path.startsWith("/callback/") ||
    path === "/login" ||
    path.startsWith("/login/") ||
    path === "/register" ||
    path.startsWith("/register/") ||
    path === "/forgot-password" ||
    path.startsWith("/forgot-password/") ||
    path === "/reset-password" || path.startsWith("/reset-password/")
  );
}

/**
 * Destino interno seguro para usuarios autenticados.
 *
 * Ademas de las validaciones de destinoSeguro (evitar open redirects, barras
 * invertidas, caracteres de control), impide bucles de redireccion al descartar
 * destinos que apunten a paginas de autenticacion (/login, /register,
 * /forgot-password) y sus variantes con parametros o subrutas.
 *
 * Si el destino es una ruta de autenticacion, recurre a "/" como fallback.
 * Rutas legitimas como "/buscar?q=mesa" o "/vender" se conservan intactas.
 */
export function destinoAutenticadoSeguro(next: unknown): string {
  if (typeof next !== "string") return "/";
  const destino = destinoSeguro(next);
  try {
    const base = "https://vicino.invalid";
    const url = new URL(destino, base);
    // URL normaliza segmentos . y .., incluidos %2e. Comprobamos también
    // el pathname decodificado: /%6cogin y /%2fhost no son destinos válidos.
    const decodedPath = decodeURIComponent(url.pathname);
    if (destinoSeguro(decodedPath) !== decodedPath) return "/";
    const normalizedPath = new URL(decodedPath, base).pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    if (url.origin !== base || esRutaAuth(normalizedPath)) return "/";
    // Opening /chat?seller=… creates a conversation (and can send a purchase
    // notice). Authentication must return to its context without executing it.
    if (normalizedPath === "/chat" && url.searchParams.has("seller")) {
      const seller = url.searchParams.get("seller") ?? "";
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seller) ? `/vendedor/${seller}` : "/chat";
    }
    const result = url.pathname + url.search + url.hash;
    return destinoSeguro(result) === result ? result : "/";
  } catch {
    return "/";
  }
}
