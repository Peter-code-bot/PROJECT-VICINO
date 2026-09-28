/**
 * Periodos del ranking en hora de CDMX (la que usan la UI y el cron).
 *
 * Modulo puro: lo usa la ruta del cron y se prueba sin red.
 */

const ZONA = "America/Mexico_City";

function partes(ahora: Date): { anio: string; mes: string; dia: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(ahora);
  const valor = (tipo: string) => p.find((x) => x.type === tipo)?.value ?? "";
  return { anio: valor("year"), mes: valor("month"), dia: Number(valor("day")) };
}

/** "YYYY-MM" del instante `ahora` en CDMX. */
export function periodoEnCdmx(ahora: Date): string {
  const { anio, mes } = partes(ahora);
  return `${anio}-${mes}`;
}

/** El mes anterior a "YYYY-MM" (enero pasa a diciembre del año previo). */
export function periodoAnterior(periodo: string): string {
  const [anio, mes] = periodo.split("-").map(Number);
  if (!anio || !mes) throw new Error(`periodo invalido: ${periodo}`);
  return mes === 1 ? `${anio - 1}-12` : `${anio}-${String(mes - 1).padStart(2, "0")}`;
}

/**
 * Los periodos que toca recalcular en esta corrida.
 *
 * H4 (S08, 27-sep): el cron diario solo recalculaba el mes en curso, asi que lo
 * que pasaba despues de la ultima corrida del mes (09:00 UTC del ultimo dia)
 * no entraba nunca en su periodo. Los dias 1 y 2 de CDMX se recalcula ademas el
 * mes anterior; el dia 2 es margen por si el disparo del dia 1 falla.
 */
export function periodosARecalcular(ahora: Date): string[] {
  const actual = periodoEnCdmx(ahora);
  return partes(ahora).dia <= 2 ? [actual, periodoAnterior(actual)] : [actual];
}
