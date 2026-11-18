import { createHash } from "node:crypto";

/**
 * Identificador de la cubeta del freno para un clic a un enlace del negocio.
 *
 * Con sesion es el id de usuario, como en el resto de limitadores del repo.
 * Sin sesion NO es la IP en claro: es un resumen SHA-256 de la IP con la
 * fecha del dia, recortado. La cubeta sigue funcionando (misma IP, mismo dia,
 * mismo resumen; la ventana es de un minuto) y Upstash nunca ve la IP. La
 * fecha hace que el resumen cambie cada dia, asi que tampoco sirve para
 * seguir a una IP de un dia a otro. No es anonimato perfecto (el espacio de
 * IPv4 se puede recorrer), pero si una promesa cumplible: nada de la persona
 * se guarda tal cual.
 */
export function cubetaDeClic(entrada: { userId: string | null; ip: string; dia: string }): string {
  if (entrada.userId) return `clic:${entrada.userId}`;
  const resumen = createHash("sha256").update(`${entrada.dia}|${entrada.ip}`).digest("base64url").slice(0, 22);
  return `clic-ip:${resumen}`;
}
