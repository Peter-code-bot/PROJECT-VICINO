import * as Sentry from "@sentry/nextjs";

/**
 * Una sesion de Auth viva SIN fila en public.profiles.
 *
 * COMO SE LLEGA AQUI. El alta no lo provoca: handle_new_user crea el perfil en
 * la misma transaccion que el usuario de Auth. Lo provoca una cuenta borrada a
 * medias: delete_user_data borra profiles ANTES de que la Edge Function de la
 * baja a Auth, y si ese segundo paso falla (el 27-sep fue la FK de audit_log)
 * queda una sesion valida apuntando a un perfil que ya no existe. Esa sesion
 * fue la que el 27-sep, en cinco segundos, produjo tres issues de Sentry
 * distintos: la FK de legal_acceptances en POST / y dos «Cannot coerce the
 * result to a single JSON object» en /perfil y /api/session/profile.
 *
 * POR QUE UN AVISO Y NO UNA EXCEPCION. No es un fallo del codigo, es un estado
 * de los DATOS que solo se arregla terminando de borrar la cuenta (Dashboard
 * de Supabase, Authentication). La baja fallida ya se reporta como error en
 * app/api/account/delete/route.ts. Aqui se deja una sola senal, de nivel
 * warning y con una huella fija, para que todas las superficies caigan en el
 * MISMO issue en vez de abrir uno por pagina. Ojo: warning no la saca del
 * total de errores del reporte semanal ni de la cuota; la saca de la lista de
 * issues de nivel error y de la regla de alerta.
 *
 * Para encontrar las cuentas en este estado (solo lectura, en Studio):
 *
 *   SELECT u.id, u.email, u.last_sign_in_at
 *   FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
 *   WHERE p.id IS NULL;
 *
 * El id del usuario NO viaja a Sentry: el proyecto no manda identificadores de
 * usuario (sendDefaultPii: false) y esto no es motivo para empezar.
 */
/**
 * Lo lanza la carga del perfil (cargarCore) cuando la sesion no tiene fila en
 * profiles, para que quien la llama pueda distinguir este estado de un fallo
 * real de la consulta, que sigue yendo a Sentry como excepcion.
 */
export class PerfilInexistenteError extends Error {
  constructor() {
    super("No hay fila en profiles para esta sesion.");
    this.name = "PerfilInexistenteError";
  }
}

/** Por nombre y no por instanceof: sobrevive a que el modulo se cargue dos veces. */
export function esPerfilInexistente(error: unknown): boolean {
  return error instanceof Error && error.name === "PerfilInexistenteError";
}

export function avisarSesionSinPerfil(superficie: string): void {
  Sentry.captureMessage("Sesion de Auth viva sin fila en profiles", {
    level: "warning",
    fingerprint: ["sesion-sin-perfil"],
    tags: { superficie },
  });
}
