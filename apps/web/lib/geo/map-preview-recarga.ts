import type { MapPreviewState } from "./map-preview-cache";

/**
 * Cuando puede el preview del mapa volver a pedir la imagen SIN que nadie pulse
 * "Reintentar".
 *
 * La cache (map-preview-cache.ts) caduca la imagen a los 5 minutos y nunca la
 * vuelve a pedir por su cuenta: es a proposito, cada peticion es un snapshot de
 * Apple que cuesta cuota. El fallo estaba en el componente, que pintaba esa
 * caducidad normal como "Vista previa no disponible". En el telefono era el
 * camino de siempre: abrir la app, salir a otra, volver a los 6 minutos y
 * encontrarse el error (reproducido el 3-oct-2026; Android, iOS y web por igual).
 *
 * Reglas:
 * - Caducada: se recarga sola, pero solo con la pagina a la vista y con red.
 *   Si caduca en segundo plano, espera a que el usuario vuelva.
 * - Fallo: NO se reintenta en el acto (si el proveedor esta caido seria otra
 *   peticion perdida). Se reintenta UNA vez al volver a la app o al recuperar
 *   la red; despues queda el boton.
 * - Todo lo automatico sale de un presupuesto, para que un inicio olvidado en
 *   pantalla no gaste cuota sin limite. Volver a la app lo repone: en Capacitor
 *   el documento vive dias, y un tope que no se repusiera devolveria el error a
 *   quien entra y sale muchas veces, que es justo el caso que se arregla.
 */

/** Recargas seguidas sin que nadie vuelva a la app: media hora de inicio olvidado. */
export const MAX_RECARGAS_AUTOMATICAS = 6;

export type MotivoRecarga = "caducada" | "reintento";

/** Que desperto la evaluacion: cambio el estado, el usuario volvio, o volvio la red. */
export type EventoRecarga = "estado" | "volver" | "red";

export interface EntradaRecarga {
  status: MapPreviewState["status"];
  evento: EventoRecarga;
  visible: boolean;
  online: boolean;
  /** Si este episodio de fallo ya gasto su unico reintento automatico. */
  reintentoUsado: boolean;
  /** Recargas automaticas que le quedan al documento. */
  restantes: number;
}

export function decidirRecarga(entrada: EntradaRecarga): MotivoRecarga | null {
  if (!entrada.visible || !entrada.online || entrada.restantes <= 0) return null;
  if (entrada.status === "expired") return "caducada";
  if (entrada.status === "error" && entrada.evento !== "estado" && !entrada.reintentoUsado) return "reintento";
  return null;
}

/** Si hay que pintar "Vista previa no disponible" con su boton de reintentar. */
export function previewNoDisponible(status: MapPreviewState["status"], restantes: number): boolean {
  return status === "error" || (status === "expired" && restantes <= 0);
}

export interface PresupuestoRecargas {
  restantes: () => number;
  /** Gasta una recarga; false si ya no quedaba ninguna. */
  consumir: () => boolean;
  /** Vuelve al maximo: alguien regreso a la app. */
  reponer: () => void;
}

export function crearPresupuesto(maximo: number = MAX_RECARGAS_AUTOMATICAS): PresupuestoRecargas {
  let usadas = 0;
  return {
    restantes: () => Math.max(0, maximo - usadas),
    consumir: () => {
      if (usadas >= maximo) return false;
      usadas++;
      return true;
    },
    reponer: () => { usadas = 0; },
  };
}

/**
 * Decide y, si toca recargar, gasta del presupuesto. Volver con la pagina a la
 * vista es la senal de que hay alguien mirando, y por eso repone antes de decidir.
 */
export function resolverRecarga(
  entrada: Omit<EntradaRecarga, "restantes">,
  presupuesto: PresupuestoRecargas,
): MotivoRecarga | null {
  if (entrada.evento === "volver" && entrada.visible) presupuesto.reponer();
  const motivo = decidirRecarga({ ...entrada, restantes: presupuesto.restantes() });
  return motivo && presupuesto.consumir() ? motivo : null;
}

/** Uno por documento: sobrevive a las navegaciones del cliente, igual que la cache. */
export const presupuestoRecargas = crearPresupuesto();
