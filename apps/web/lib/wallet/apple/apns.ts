import "server-only";
import http2 from "node:http2";
import type { ConfigApple } from "../config";

/**
 * Aviso de pase actualizado por APNs (HTTP/2, autenticacion por certificado
 * del Pass Type ID, no por token). El cuerpo es un JSON vacio: el telefono
 * recibe el aviso y despues PIDE el pase al web service. No hay promesa de
 * actualizacion instantanea.
 *
 * 410 (o 400 con motivo de token) significa que el token ya no vale: el que
 * llama borra ese registro. Un 400 por BadTopic es un error nuestro, no del
 * telefono, y no borra nada.
 */
export interface ResultadoApns {
  enviados: number;
  invalidos: string[];
  errores: string[];
}

const APNS = "https://api.push.apple.com";
const TIEMPO_MAXIMO_MS = 10_000;
const TOKENS_POR_LLAMADA = 5;
const MOTIVOS_TOKEN_INVALIDO = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "ExpiredToken"]);

export async function notificarApns(config: ConfigApple, pushTokens: string[]): Promise<ResultadoApns> {
  const resultado: ResultadoApns = { enviados: 0, invalidos: [], errores: [] };
  const tokens = [...new Set(pushTokens.filter((t) => /^[0-9a-fA-F]{32,200}$/.test(t)))].slice(0, TOKENS_POR_LLAMADA);
  if (tokens.length === 0) return resultado;

  const sesion = http2.connect(APNS, {
    cert: config.signerCert,
    key: config.signerKey,
    passphrase: config.signerKeyPassphrase,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const temporizador = setTimeout(() => reject(new Error("APNs: tiempo de conexion agotado")), TIEMPO_MAXIMO_MS);
      sesion.once("connect", () => { clearTimeout(temporizador); resolve(); });
      sesion.once("error", (error) => { clearTimeout(temporizador); reject(error); });
    });
    // Un reset del socket despues de conectar no puede ser una excepcion sin
    // dueño: cada peticion ya maneja su propio error.
    sesion.on("error", () => undefined);
    // En paralelo sobre la misma sesion HTTP/2: el peor caso es un tope de
    // tiempo, no uno por token.
    const respuestas = await Promise.allSettled(tokens.map((token) => enviar(sesion, config.passTypeId, token)));
    respuestas.forEach((respuesta, i) => {
      const token = tokens[i]!;
      if (respuesta.status === "rejected") {
        resultado.errores.push(`${token.slice(0, 8)}…: ${respuesta.reason instanceof Error ? respuesta.reason.message : "fallo"}`);
        return;
      }
      const { estado, motivo } = respuesta.value;
      if (estado === 200) resultado.enviados += 1;
      else if (estado === 410 || (estado === 400 && MOTIVOS_TOKEN_INVALIDO.has(motivo))) resultado.invalidos.push(token);
      else resultado.errores.push(`${token.slice(0, 8)}…: HTTP ${estado}${motivo ? ` ${motivo}` : ""}`);
    });
  } finally {
    sesion.close();
  }
  return resultado;
}

function enviar(sesion: http2.ClientHttp2Session, passTypeId: string, token: string): Promise<{ estado: number; motivo: string }> {
  return new Promise((resolve, reject) => {
    const peticion = sesion.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      "apns-topic": passTypeId,
      "content-type": "application/json",
    });
    const temporizador = setTimeout(() => { peticion.close(); reject(new Error("APNs: tiempo agotado")); }, TIEMPO_MAXIMO_MS);
    let estado = 0;
    let cuerpo = "";
    peticion.setEncoding("utf8");
    peticion.on("response", (cabeceras) => {
      estado = Number(cabeceras[":status"] ?? 0);
    });
    peticion.on("data", (trozo: string) => {
      if (cuerpo.length < 512) cuerpo += trozo;
    });
    peticion.on("end", () => {
      clearTimeout(temporizador);
      let motivo = "";
      try {
        motivo = String((JSON.parse(cuerpo || "{}") as { reason?: unknown }).reason ?? "");
      } catch {
        motivo = "";
      }
      resolve({ estado, motivo });
    });
    peticion.on("error", (error) => { clearTimeout(temporizador); reject(error); });
    peticion.end("{}");
  });
}
