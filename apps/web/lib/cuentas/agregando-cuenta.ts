/**
 * "Estoy agregando OTRA cuenta": la excepcion que deja entrar a /login y
 * /register con sesion.
 *
 * Tres sitios echan de esas pantallas a quien ya tiene sesion: el proxy
 * (lib/supabase/middleware.ts), las paginas (app/(auth)/login/page.tsx y
 * register/page.tsx) y la accion signUp (app/(auth)/actions.ts), que se niega a
 * registrar encima de una sesion abierta. Los tres leen esta cookie con
 * estaAgregandoCuenta() y, si esta puesta, dejan pasar.
 *
 * La escribe y la borra el cliente (no es httpOnly a proposito), dura 10
 * minutos y no lleva nada que valga: su unico efecto es desactivar un
 * redirect. Si la persona cierra la app a mitad (salio a Google y no volvio),
 * caduca sola y la cuenta anterior sigue en la cookie de sesion y en la boveda.
 *
 * Este modulo no importa nada de servidor ni de cliente a proposito: lo usan
 * los dos lados.
 */

export const COOKIE_AGREGANDO_CUENTA = "vicino_agregando_cuenta";
export const VIGENCIA_AGREGANDO_S = 600;
/** Parametro de la URL que hace que login-form y register-form pinten el aviso. */
export const PARAM_AGREGANDO = "agregar";
/** A donde vuelve la persona tras entrar con la cuenta nueva: donde VE que cambio. */
export const DESTINO_TRAS_AGREGAR = "/perfil";

export function estaAgregandoCuenta(valorCookie: string | null | undefined): boolean {
  return valorCookie === "1";
}

function esPantallaDeEntrada(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/register" ||
    pathname.startsWith("/register/")
  );
}

/**
 * La condicion del proxy (lib/supabase/middleware.ts), en una funcion pura
 * para poder probarla: a quien tiene sesion se le echa de /login y /register,
 * SALVO que este agregando otra cuenta.
 */
export function expulsarDePantallaDeEntrada(haySesion: boolean, pathname: string, valorCookie: string | null | undefined): boolean {
  return haySesion && esPantallaDeEntrada(pathname) && !estaAgregandoCuenta(valorCookie);
}

export function hrefAgregarCuenta(ruta: "/login" | "/register" = "/login"): string {
  return `${ruta}?next=${encodeURIComponent(DESTINO_TRAS_AGREGAR)}&${PARAM_AGREGANDO}=1`;
}

function esSeguro(): boolean {
  try {
    return window.location.protocol === "https:";
  } catch {
    return false;
  }
}

export function marcarAgregandoCuenta(): void {
  try {
    document.cookie = `${COOKIE_AGREGANDO_CUENTA}=1; Max-Age=${VIGENCIA_AGREGANDO_S}; Path=/; SameSite=Lax${esSeguro() ? "; Secure" : ""}`;
  } catch {
    // Sin cookies el proxy seguira redirigiendo: la persona vera /perfil en vez de /login.
  }
}

export function limpiarAgregandoCuenta(): void {
  try {
    if (!document.cookie.includes(`${COOKIE_AGREGANDO_CUENTA}=`)) return;
    document.cookie = `${COOKIE_AGREGANDO_CUENTA}=; Max-Age=0; Path=/; SameSite=Lax${esSeguro() ? "; Secure" : ""}`;
  } catch {
    // Nada que limpiar.
  }
}
