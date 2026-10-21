import { cuotaWebService, respuestaVacia } from "@/lib/wallet/apple/web-service";

const TAMANO_MAXIMO = 8 * 1024;
const SIN_CONTROL = /[\u0000-\u001f\u007f]+/g;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Protocolo de Apple: el telefono reporta aqui los errores que tuvo con el
 * pase o con el web service. Sin autenticacion por diseño de Apple, asi que
 * se acota el tamaño y solo se registra en consola: nunca se actua sobre su
 * contenido.
 */
export async function POST(request: Request) {
  const limitado = await cuotaWebService(request);
  if (limitado) return limitado;
  const tamano = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(tamano) || tamano > TAMANO_MAXIMO) return respuestaVacia(413);
  let cuerpo: unknown;
  try {
    const texto = await request.text();
    if (texto.length > TAMANO_MAXIMO) return respuestaVacia(413);
    cuerpo = JSON.parse(texto);
  } catch {
    return respuestaVacia(400);
  }
  // Sin saltos de linea ni caracteres de control: una entrada del telefono no
  // puede fabricar lineas de log ajenas.
  const logs =
    cuerpo && typeof cuerpo === "object" && "logs" in cuerpo && Array.isArray(cuerpo.logs)
      ? cuerpo.logs
          .filter((l): l is string => typeof l === "string")
          .slice(0, 20)
          .map((l) => l.replace(SIN_CONTROL, " ").slice(0, 500))
      : [];
  // Solo a los logs de Vercel: es un endpoint sin autenticacion y mandarlo a
  // Sentry seria regalar cuota a quien quiera hacer ruido.
  if (logs.length > 0) {
    console.warn("[apple-wallet] log del dispositivo:", logs.join(" | ").slice(0, 2000));
  }
  return respuestaVacia(200);
}
