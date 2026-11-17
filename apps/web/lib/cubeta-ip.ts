import { createHash, createHmac } from "node:crypto";

/**
 * Cubeta de un freno por IP SIN guardar la IP.
 *
 * @upstash/ratelimit persiste el identificador de cada cubeta en Redis; con la
 * IP cruda eso es un registro de direcciones. Aqui el identificador es un
 * resumen de la IP con la fecha del dia: sirve para frenar (misma IP y mismo
 * dia = misma cubeta) y no se lee a simple vista.
 *
 * Con VICINO_SAL_CUBETAS en el entorno el resumen es un HMAC con esa sal: sin
 * la sal, enumerar las 2^32 IPv4 de un dia no sirve para deshacerlo. Sin la
 * variable cae a sha256 pelado, que es seudonimizacion (reversible por fuerza
 * bruta en minutos), por eso .env.example recomienda ponerla. Las claves de
 * la ventana deslizante caducan en minutos y la analitica va en false.
 */
export function cubetaPorIp(
  prefijo: string,
  ip: string,
  dia: string = new Date().toISOString().slice(0, 10),
  sal: string | undefined = process.env.VICINO_SAL_CUBETAS,
): string {
  const base = `${dia}|${ip}`;
  const resumen = (sal && sal.length >= 16 ? createHmac("sha256", sal).update(base) : createHash("sha256").update(base))
    .digest("base64url")
    .slice(0, 22);
  return `${prefijo}:${resumen}`;
}
