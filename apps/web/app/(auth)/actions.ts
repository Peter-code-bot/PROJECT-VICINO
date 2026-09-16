"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import {
  LARGO_CODIGO,
  normalizarCorreo,
  segundosDeEspera,
  soloDigitos,
  type ResultadoOtp,
} from "@/lib/auth/otp-formato";
import {
  authRateLimit,
  enforce,
  getClientIp,
  otpResendIpRateLimit,
  otpResendRateLimit,
  otpVerifyIpRateLimit,
  otpVerifyRateLimit,
} from "@/lib/rate-limit";

// Auth-page forms (login, register, forgot-password) submit through these
// server actions instead of calling supabase.auth.* directly from the
// browser. The earlier middleware-only tier was bypassable: the supabase
// client opens a direct connection to *.supabase.co/auth/v1/* and never
// hits Next.js, so a rate limit on /login page loads protects nothing.
// Routing the credential submission through a server action puts our
// throttle in front of every actual attempt.

/**
 * Freno de las acciones de credencial, con UNA CUBETA POR ACCION.
 *
 * Antes las tres compartian el identificador `auth:${ip}`, y en Upstash la
 * clave es prefijo + identificador: no eran tres cubetas de 5, era UNA de 5
 * repartida entre login, registro y recuperacion. El efecto practico, el dia
 * que se enciendan las credenciales de Upstash, es el peor posible: quien
 * falla cinco veces la contrasena NO PUEDE pedir recuperacion — que es
 * exactamente lo que la pantalla le va a sugerir a continuacion. Y en una IP
 * compartida (CGNAT movil, un cafe, una oficina) los cinco intentos se los
 * puede haber gastado otra persona.
 *
 * Separandolas, la fuerza bruta sigue cortada a los 5 intentos de LOGIN, que
 * es el unico flujo caro de adivinar, y recuperar la contrasena deja de estar
 * bloqueado por haberla fallado.
 *
 * El precio, dicho para que nadie lo descubra midiendo: el techo agregado de
 * una IP sube de 5 a 15 por cuarto de hora. Es el correcto — registrarse y
 * pedir recuperacion no son ataques de adivinanza.
 */
async function throttleAuth(accion: "login" | "signup" | "reset") {
  const ip = getClientIp(await headers());
  return enforce(authRateLimit, `auth:${accion}:${ip}`);
}

export async function signInWithPassword(email: string, password: string) {
  const rate = await throttleAuth("login");
  if (!rate.ok) return { error: rate.error };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { success: true };
}

export async function signUp(email: string, password: string, fullName: string) {
  const rate = await throttleAuth("signup");
  if (!rate.ok) return { error: rate.error };

  // El camino normal ahora es el codigo de 6 digitos, pero el correo sigue
  // llevando un enlace de respaldo (para quien lo abre en el ordenador, o para
  // quien cierra la app antes de escribirlo). Sin emailRedirectTo ese enlace
  // aterriza en site_url, o sea la portada, que no intercambia el code: GoTrue
  // confirma la cuenta pero la persona acaba en el home sin sesion, sin que
  // nada se lo explique. Apuntandolo a /auth/callback-server (que ya esta en la
  // lista de redirecciones permitidas del proyecto) el enlace ademas entra.
  const sitio = process.env.NEXT_PUBLIC_SITE_URL ?? "https://vicinomarket.com";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${sitio}/auth/callback-server`,
    },
  });
  if (error) {
    // GoTrue failures (SMTP rate limit, auth.users trigger errors) reach the
    // user as a generic message; keep the literal cause in the server logs.
    console.error("[signUp] GoTrue error:", error.status, error.message);
    return { error: error.message };
  }
  return { hasSession: Boolean(data.session) };
}

// ---------------------------------------------------------------------------
// Verificacion por codigo de 6 digitos
// ---------------------------------------------------------------------------
//
// Sustituye al enlace magico del correo de confirmacion. El motivo no es
// estetico: el enlace se abre en el navegador embebido del cliente de correo,
// que no tiene la cookie del verificador PKCE que se creo en la app, y el
// intercambio falla. app/auth/callback-server/route.ts existe casi entero para
// apanar ese caso. Un codigo que la persona escribe en la pantalla donde ya
// estaba no cruza ningun navegador, asi que ese fallo desaparece de raiz.
//
// El codigo lo genera, guarda, caduca y compara GoTrue. No se reimplementa
// aqui: comparar hashes en tiempo constante y caducar a los 10 minutos ya lo
// hace el servidor de Supabase, y una segunda implementacion solo anade una
// superficie mas donde equivocarse.

export async function verificarCodigo(email: string, codigo: string): Promise<ResultadoOtp> {
  const correo = normalizarCorreo(email);
  const digitos = soloDigitos(codigo);

  // Se valida ANTES de gastar cuota: seis casillas vacias no son un intento.
  if (!correo || digitos.length !== LARGO_CODIGO) {
    return { ok: false, motivo: "invalido", mensaje: "Escribe los 6 dígitos del código." };
  }

  const ip = getClientIp(await headers());
  const porCorreo = await enforce(otpVerifyRateLimit, `otp:v:${correo}`);
  if (!porCorreo.ok) {
    return {
      ok: false,
      motivo: "limite",
      mensaje: "Demasiados intentos con este correo. Espera unos minutos y pide un código nuevo.",
    };
  }
  const porIp = await enforce(otpVerifyIpRateLimit, `otp:vip:${ip}`);
  if (!porIp.ok) {
    return { ok: false, motivo: "limite", mensaje: "Demasiados intentos. Espera unos minutos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email: correo,
    token: digitos,
    type: "signup",
  });

  if (error) {
    const msg = error.message.toLowerCase();

    // GoTrue NO distingue los dos casos: para un digito mal escrito y para un
    // codigo caducado devuelve la misma cadena, "Token has expired or is
    // invalid". Asi que el mensaje tiene que cubrir los dos. Decir solo
    // "vencio" manda a pedir un codigo nuevo a quien solo se equivoco de
    // tecla, y encima le gasta uno de los cinco reenvios de la hora.
    if (msg.includes("expired") || msg.includes("invalid") || msg.includes("token")) {
      return {
        ok: false,
        motivo: msg.includes("expired") ? "vencido" : "invalido",
        mensaje: "Código incorrecto o vencido. Revísalo, o pide uno nuevo.",
      };
    }
    if (msg.includes("rate limit") || msg.includes("too many")) {
      return {
        ok: false,
        motivo: "limite",
        mensaje: "Demasiados intentos. Espera unos minutos e intenta de nuevo.",
      };
    }

    // Cualquier otra cosa es un fallo que no sabemos leer: al usuario un
    // mensaje honesto, a Sentry la causa literal.
    Sentry.captureException(error, {
      tags: { action: "verificarCodigo", status: String(error.status ?? "") },
    });
    return {
      ok: false,
      motivo: "desconocido",
      mensaje: "No pudimos verificar el código. Intenta de nuevo.",
    };
  }

  // verifyOtp puede devolver 200 sin sesion. Sin esta comprobacion la pantalla
  // celebraria y mandaria al home a alguien que sigue sin estar autenticado, y
  // el layout lo rebotaria a /login sin explicacion.
  if (!data.session) {
    Sentry.captureMessage("[verificarCodigo] verifyOtp sin sesión", {
      level: "error",
      tags: { action: "verificarCodigo" },
    });
    return {
      ok: false,
      motivo: "desconocido",
      mensaje: "No pudimos iniciar tu sesión. Intenta iniciar sesión con tu contraseña.",
    };
  }

  return { ok: true };
}

export async function reenviarCodigo(email: string): Promise<ResultadoOtp> {
  const correo = normalizarCorreo(email);
  if (!correo) {
    return { ok: false, motivo: "invalido", mensaje: "Falta el correo." };
  }

  const ip = getClientIp(await headers());
  const porCorreo = await enforce(otpResendRateLimit, `otp:r:${correo}`);
  if (!porCorreo.ok) {
    return {
      ok: false,
      motivo: "limite",
      mensaje: "Ya enviamos varios códigos a este correo. Espera una hora o escríbenos.",
    };
  }
  const porIp = await enforce(otpResendIpRateLimit, `otp:rip:${ip}`);
  if (!porIp.ok) {
    return { ok: false, motivo: "limite", mensaje: "Demasiadas solicitudes. Espera un momento." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email: correo });

  if (error) {
    const msg = error.message.toLowerCase();

    if (msg.includes("security purposes") || msg.includes("only request this after")) {
      return {
        ok: false,
        motivo: "espera",
        mensaje: "Espera unos segundos antes de pedir otro código.",
        segundos: segundosDeEspera(error.message),
      };
    }
    if (msg.includes("rate limit") || msg.includes("too many")) {
      return {
        ok: false,
        motivo: "limite",
        mensaje: "No pudimos enviar otro código ahora mismo. Intenta en unos minutos.",
      };
    }

    // Aqui cae, entre otras, "ya esta confirmado". NO se distingue en el
    // mensaje a proposito: responder distinto segun si el correo existe
    // convierte esta pantalla en un buscador de cuentas de VICINO.
    console.error("[reenviarCodigo] GoTrue error:", error.status, error.message);
    Sentry.captureException(error, {
      tags: { action: "reenviarCodigo", status: String(error.status ?? "") },
      level: "warning",
    });
    return {
      ok: false,
      motivo: "desconocido",
      mensaje: "No pudimos enviar otro código. Intenta en unos minutos.",
    };
  }

  return { ok: true };
}

export async function requestPasswordReset(email: string, redirectTo: string) {
  const rate = await throttleAuth("reset");
  if (!rate.ok) return { error: rate.error };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return { error: error.message };
  return { success: true };
}

export async function signOut() {
  const supabase = await createClient();

  // Mismo motivo que en useLogout: el token de push es por dispositivo, asi que
  // si no se suelta al salir, las notificaciones de quien se va aterrizan en la
  // pantalla de quien entre despues en ese telefono. Va ANTES del signOut, que
  // es cuando todavia hay permiso para escribir en el perfil, y es best-effort:
  // que falle no puede impedir cerrar sesion.
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { error: tokenError } = await supabase
      .from("profiles")
      .update({ fcm_token: null })
      .eq("id", user.id);
    if (tokenError) {
      Sentry.captureException(tokenError, {
        tags: { action: "signOut", step: "clear_fcm_token" },
        level: "warning",
      });
    }
  }

  const { error } = await supabase.auth.signOut();
  // auth-js sale de _signOut() ANTES de _removeSession() cuando el fallo no es
  // 401/403/404, asi que la cookie de sesion sobrevive. Redirigir igual mandaria
  // a /login a alguien que sigue autenticado, creyendo que cerro sesion.
  if (error) {
    Sentry.captureException(error, {
      tags: { action: "signOut" },
      contexts: { auth: { name: error.name, status: error.status ?? null } },
    });
    return { error: "No se pudo cerrar tu sesión. Revisa tu conexión e inténtalo de nuevo." };
  }
  redirect("/login");
}
