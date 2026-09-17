import "server-only";
import { timingSafeEqual } from "node:crypto";
import { enforce, adminSecurityRateLimit } from "@/lib/rate-limit";
import { frenoEnMemoria } from "@/lib/freno-en-memoria";

/**
 * Segunda llave para los movimientos del panel de admin.
 *
 * QUE PROBLEMA RESUELVE. Repartir y quitar el rol de admin se hacia con un
 * clic, sin confirmacion: cualquiera que dejara su sesion abierta un minuto en
 * un telefono o en una pantalla compartida entregaba el panel entero. Pedro
 * pidio "que cada que se quiere hacer un movimiento... hay que escribir la
 * contraseña impuesta".
 *
 * NO ES LA CONTRASEÑA DE NADIE. Es una clave de operacion, compartida por
 * quienes administran, y vive SOLO en el entorno (ADMIN_SECURITY_PASSWORD).
 * Este repositorio es PUBLICO: escribir el valor aqui, aunque fuera como
 * respaldo de un `||`, seria publicarlo. Por eso, si la variable no esta
 * configurada, la accion se RECHAZA en vez de caer a un valor por defecto:
 * un panel sin segunda llave tiene que decirlo, no fingir que la pide.
 *
 * Comparacion en tiempo constante: con `===`, el tiempo de respuesta filtra
 * cuantos caracteres iniciales acerto quien prueba. Es una clave corta y
 * compartida, asi que no se regala esa pista.
 */

/** Suelo que existe aunque Upstash no: los limitadores compartidos son no-op sin credenciales. */
const suelo = frenoEnMemoria({ tope: 10, ventanaMs: 15 * 60_000 });

export type ResultadoClave = { ok: true } | { ok: false; error: string };

export async function comprobarClaveDeSeguridad(
  adminId: string,
  clave: string | undefined | null,
): Promise<ResultadoClave> {
  const esperada = process.env.ADMIN_SECURITY_PASSWORD;
  if (!esperada) {
    return {
      ok: false,
      error:
        "Falta configurar la clave de seguridad del panel (ADMIN_SECURITY_PASSWORD). Pídela a Pedro antes de cambiar roles.",
    };
  }
  if (!suelo.permitir(`admin-seguridad:${adminId}`)) {
    return { ok: false, error: "Demasiados intentos. Espera unos minutos." };
  }
  const rate = await enforce(adminSecurityRateLimit, `admin-seguridad:${adminId}`);
  if (!rate.ok) return { ok: false, error: rate.error };
  if (typeof clave !== "string" || clave.length === 0) {
    return { ok: false, error: "Escribe la clave de seguridad para confirmar." };
  }
  // Longitudes distintas ya no coinciden, y timingSafeEqual exige el mismo
  // tamaño de buffer: se compara el resumen de bytes para no revelar ni la
  // longitud de la clave buena.
  const recibida = Buffer.from(clave, "utf8");
  const buena = Buffer.from(esperada, "utf8");
  const iguales =
    recibida.length === buena.length && timingSafeEqual(recibida, buena);
  if (!iguales) return { ok: false, error: "Clave de seguridad incorrecta." };
  return { ok: true };
}
