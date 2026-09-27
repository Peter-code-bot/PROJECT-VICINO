/**
 * ¿La nota de la IA es sobre las fotos que el revisor tiene delante?
 *
 * BUG-VERIF-IA (27-sep-2026): el panel mostraba la nota de un envio anterior
 * junto a los documentos nuevos. La base marca la nota como desfasada cuando
 * cambia la FILA (seller_verification.ai_vigente, trigger
 * marcar_analisis_ia_desfasado_trg), pero cada foto vive en una ruta fija que se
 * sube con upsert: se puede reemplazar en el bucket sin tocar la fila. Eso solo
 * se ve comparando el updated_at de cada objeto con ai_analizado_en, que es la
 * version de las fotos que miro la IA. Los dos lados salen del listado de
 * Storage, asi que se comparan con el mismo reloj.
 *
 * Modulo puro a proposito: lo usan la accion de la IA (para anotar que version
 * analizo) y el panel (para comparar), y se prueba sin red.
 */

/** Lo que devuelve `storage.list()` y aqui importa. */
export interface ObjetoDeStorage {
  name: string;
  updated_at?: string | null;
}

/**
 * updated_at de cada ruta, en el mismo orden, leido del listado de `carpeta`.
 * null si la ruta no aparece (o no esta directamente dentro de la carpeta).
 */
export function versionesDeLasFotos(
  carpeta: string,
  rutas: readonly (string | null)[],
  objetos: readonly ObjetoDeStorage[],
): (string | null)[] {
  return rutas.map((ruta) => {
    if (!ruta) return null;
    const objeto = objetos.find((o) => `${carpeta}/${o.name}` === ruta);
    return objeto?.updated_at && esFecha(objeto.updated_at) ? objeto.updated_at : null;
  });
}

/** La version mas reciente del juego de fotos, o null si falta alguna. */
export function versionMasReciente(versiones: readonly (string | null)[]): string | null {
  if (versiones.length === 0 || versiones.some((v) => v === null)) return null;
  return (versiones as string[]).reduce((max, v) =>
    new Date(v).getTime() > new Date(max).getTime() ? v : max,
  );
}

export type EstadoDelAnalisis = "ninguno" | "vigente" | "desfasado" | "sin_comprobar";

/**
 * - ninguno: no hay nota.
 * - desfasado: la fila cambio despues de la nota, o alguna foto del bucket es
 *   posterior a lo que miro la IA.
 * - sin_comprobar: no hay con que comparar (nota anterior a esta columna, el
 *   listado fallo o falta un objeto). Se dice asi y no se da por buena.
 * - vigente: todas las fotos son las que analizo la IA.
 *
 * `versiones` es null cuando no se pudo listar la carpeta.
 */
export function estadoDelAnalisis(args: {
  hayAnalisis: boolean;
  vigente: boolean;
  analizadoEn: string | null;
  versiones: readonly (string | null)[] | null;
}): EstadoDelAnalisis {
  const { hayAnalisis, vigente, analizadoEn, versiones } = args;
  if (!hayAnalisis) return "ninguno";
  if (!vigente) return "desfasado";
  if (!analizadoEn || !esFecha(analizadoEn) || versiones === null) return "sin_comprobar";
  const limite = new Date(analizadoEn).getTime();
  // Una foto posterior decide aunque falte otra: esa ya seguro que no la vio.
  if (versiones.some((v) => v !== null && new Date(v).getTime() > limite)) return "desfasado";
  if (versiones.some((v) => v === null)) return "sin_comprobar";
  return "vigente";
}

/** Lo que la IA recibio ademas de las fotos; va dentro de la nota guardada. */
export interface EntradaDelAnalisis {
  tipo: string;
  universidad: string | null;
}

/**
 * Una nota que es un veredicto de verdad, y no el aviso de «no se pudo
 * analizar» que se guarda cuando el proveedor falla (lleva respuesta_longitud).
 */
export function esVeredictoReal(nota: unknown): boolean {
  return typeof nota === "object" && nota !== null && !Array.isArray(nota) && !("respuesta_longitud" in nota);
}

/**
 * ¿La nota guardada ya es el veredicto de EXACTAMENTE esta entrada: la misma
 * version de las tres fotos, el mismo tipo y la misma universidad?
 *
 * Si lo es, volver a analizar no aporta nada y si abre una puerta: repetir la
 * llamada hasta que el modelo, que no es determinista, conteste algo menos
 * malo, y tapar asi un veredicto negativo. Se mira la entrada guardada DENTRO de
 * la nota y no las columnas de la fila, porque el vendedor puede cambiar la
 * universidad y volver a ponerla.
 */
export function esVeredictoDeEstaEntrada(
  nota: unknown,
  analizadoEn: string | null,
  version: string,
  entrada: EntradaDelAnalisis,
): boolean {
  if (!esVeredictoReal(nota) || !analizadoEn || !mismoInstante(analizadoEn, version)) return false;
  const guardada = (nota as Record<string, unknown>).entrada;
  if (typeof guardada !== "object" || guardada === null) return false;
  const { tipo, universidad } = guardada as Record<string, unknown>;
  return tipo === entrada.tipo && (universidad ?? null) === entrada.universidad;
}

function mismoInstante(a: string, b: string): boolean {
  return esFecha(a) && esFecha(b) && new Date(a).getTime() === new Date(b).getTime();
}

function esFecha(valor: string): boolean {
  return Number.isFinite(new Date(valor).getTime());
}
