/**
 * Cuentas que existen, se conservan y siguen funcionando, pero NO son usuarios
 * reales: no cuentan en las metricas del panel de admin.
 *
 * Criterio acordado el 18-nov-2026. Quedan fuera:
 *   - por dominio de correo, las cuentas de datos inventados y de prueba:
 *       @mock-appstore.vicino.mx  el lote creado el 26-sep-2026 (hora de
 *                                 Ciudad de Mexico) para las capturas de las
 *                                 tiendas de apps,
 *       @demo.vicino.mx           compradores inventados de demostracion,
 *       @example.com              cuentas de diagnostico del registro (es un
 *                                 dominio reservado: ninguna persona lo tiene);
 *   - por UUID, cuentas de prueba sueltas con correo normal (abajo).
 * Todo lo demas cuenta, tenga o no publicaciones, telefono o foto. Las
 * cuentas personales del equipo siguen contando mientras no se decida otra
 * cosa.
 *
 * No se borra, no se oculta y no se toca ninguna fila: solo se deja de contar.
 * Las cuentas sueltas van por UUID y no por correo porque este repositorio es
 * publico.
 *
 * Para sacar otra cuenta de las metricas, agregala aqui con su motivo. La
 * marca en la base (tabla cuentas_internas) sigue propuesta aparte; si se
 * aplica, deberia reemplazar esta lista.
 */

export const DOMINIOS_FUERA_DE_METRICAS: readonly string[] = [
  "mock-appstore.vicino.mx",
  "demo.vicino.mx",
  "example.com",
];

export const CUENTAS_FUERA_DE_METRICAS: ReadonlyArray<{ id: string; motivo: string }> = [
  {
    id: "24ab61a7-4460-4980-a7c5-c7d4f7c93731",
    motivo: "Cuenta de prueba manual del equipo, fuera del lote de capturas",
  },
  {
    id: "bb84e164-96b0-4f29-9cbd-bc695de52e1e",
    motivo: "Cuenta de QA del equipo",
  },
  {
    id: "099140fe-4600-4060-a689-43d7e0f4d101",
    motivo: "Cuenta para la revision de la ficha de Google Play",
  },
];

/** Dominio del correo en minusculas, o null si no parece un correo. */
export function dominioDeCorreo(correo: unknown): string | null {
  if (typeof correo !== "string") return null;
  const limpio = correo.trim().toLowerCase();
  const arroba = limpio.lastIndexOf("@");
  if (arroba <= 0 || arroba === limpio.length - 1) return null;
  return limpio.slice(arroba + 1);
}

export function esDominioFueraDeMetricas(correo: unknown): boolean {
  const dominio = dominioDeCorreo(correo);
  return dominio !== null && DOMINIOS_FUERA_DE_METRICAS.includes(dominio);
}

const IDS_FUERA_DE_METRICAS = new Set(CUENTAS_FUERA_DE_METRICAS.map((cuenta) => cuenta.id.toLowerCase()));

export function estaFueraDeMetricas(cuenta: { id: string; email?: string | null }): boolean {
  return IDS_FUERA_DE_METRICAS.has(cuenta.id.toLowerCase()) || esDominioFueraDeMetricas(cuenta.email);
}

/**
 * Patron ILIKE para un dominio: `%@dominio`, con `%`, `_` y `\` escapados para
 * que un dominio nunca se lea como comodin.
 */
export function patronDeDominio(dominio: string): string {
  return `%@${dominio.replace(/[\\%_]/g, (caracter) => `\\${caracter}`)}`;
}

export interface ConteoComunidad {
  /** Perfiles que cuentan como usuarios reales. */
  usuarios: number;
  /** De ellos, con el Modo Vendedor activo. */
  vendedores: number;
  /** Perfiles que existen pero no cuentan. */
  excluidas: number;
  /** De las excluidas, con el Modo Vendedor activo. */
  excluidasVendedoras: number;
}

/**
 * Cuentas de la comunidad sin las cuentas fuera de metricas.
 *
 * `porDominio` llega ya contado por la base (es exacto aunque un dominio
 * crezca); `porId` trae las filas de la lista de UUID que existen. Una cuenta
 * de la lista que ademas cae por dominio ya esta en `porDominio`: no se resta
 * dos veces.
 */
export function resumirComunidad(entrada: {
  totalPerfiles: number;
  totalVendedores: number;
  porDominio: { cuentas: number; vendedores: number };
  porId: ReadonlyArray<{ id: string; email: string | null; es_vendedor: boolean | null }>;
}): ConteoComunidad {
  const unicas = new Map(entrada.porId.map((cuenta) => [cuenta.id.toLowerCase(), cuenta]));
  const soloPorId = [...unicas.values()].filter((cuenta) => !esDominioFueraDeMetricas(cuenta.email));
  const excluidas = entrada.porDominio.cuentas + soloPorId.length;
  const excluidasVendedoras =
    entrada.porDominio.vendedores + soloPorId.filter((cuenta) => cuenta.es_vendedor === true).length;
  return {
    usuarios: Math.max(0, entrada.totalPerfiles - excluidas),
    vendedores: Math.max(0, entrada.totalVendedores - excluidasVendedoras),
    excluidas,
    excluidasVendedoras,
  };
}
