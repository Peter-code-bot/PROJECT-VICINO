import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { ClienteLealtad, WalletPassRow } from "@/types/loyalty.types";
import { snapshotSchema, type SnapshotMembresia } from "@/lib/lealtad/esquemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { conLealtad } from "@/types/loyalty.types";
import { configWallet, type ConfigWallet } from "./config";
import { notificarApns } from "./apple/apns";
import { actualizarObjetoGoogle, asegurarClaseGoogle, idsGoogle } from "./google/api";

/**
 * Procesa la outbox (wallet_update_jobs). Cada trabajo es "la membresia X
 * cambio; su version es V". Para Google se hace PATCH del objeto; para Apple
 * se sube version_deseada y se avisa por APNs a los dispositivos registrados,
 * que despues descargan el pase nuevo por el web service.
 *
 * El trabajo se cierra con wallet_job_terminar: si la version subio mientras
 * se procesaba vuelve a la cola; un fallo reintenta con retroceso.
 *
 * Quien la vacia: el cron diario (Vercel Hobby solo admite crons diarios) y,
 * sobre todo, `drenarColaWallet` justo despues de cada evento (sello, canje,
 * reversa) via `after()`. Con presupuesto de tiempo: una funcion cortada por
 * tiempo dejaria trabajos en 'procesando' (la cola los retoma a los 5 min).
 */
export interface ResumenSincronizacion {
  tomados: number;
  hechos: number;
  fallidos: number;
  detalles: string[];
}

export async function procesarTrabajosWallet(
  admin: ClienteLealtad,
  config: ConfigWallet,
  limite = 10,
  presupuestoMs = 40_000,
): Promise<ResumenSincronizacion> {
  const resumen: ResumenSincronizacion = { tomados: 0, hechos: 0, fallidos: 0, detalles: [] };
  const inicio = Date.now();
  const { data: trabajos, error } = await admin.rpc("wallet_jobs_tomar", { p_limite: limite });
  if (error) throw error;
  for (const trabajo of trabajos ?? []) {
    if (Date.now() - inicio > presupuestoMs) {
      // Se devuelve a la cola sin contar intento: el tiempo se acabo, no fallo.
      await terminar(admin, trabajo.id, 0, true);
      resumen.detalles.push(`#${trabajo.id}: sin tiempo, devuelto a la cola`);
      continue;
    }
    resumen.tomados += 1;
    try {
      await sincronizarMembresia(admin, config, trabajo.membership_id, trabajo.version);
      await terminar(admin, trabajo.id, trabajo.version, true);
      resumen.hechos += 1;
    } catch (fallo) {
      const mensaje = fallo instanceof Error ? fallo.message : "fallo desconocido";
      Sentry.captureException(fallo, { tags: { action: "wallet_sync" }, extra: { job: trabajo.id, membership: trabajo.membership_id } });
      await terminar(admin, trabajo.id, trabajo.version, false, mensaje);
      resumen.fallidos += 1;
      resumen.detalles.push(`#${trabajo.id}: ${mensaje}`);
    }
  }
  return resumen;
}

// Con version 0 y ok=true, wallet_job_terminar ve "la version subio" y
// devuelve el trabajo a 'pendiente' sin contarlo como fallo.
async function terminar(admin: ClienteLealtad, id: number, version: number, ok: boolean, mensaje?: string): Promise<void> {
  const { error } = await admin.rpc("wallet_job_terminar", {
    p_id: id,
    p_version_procesada: version,
    p_ok: ok,
    ...(mensaje ? { p_error: mensaje.slice(0, 500) } : {}),
  });
  if (error) throw error;
}

/**
 * Vacia unos pocos trabajos ahora mismo, sin esperar al cron. Pensada para
 * `after()` en las server actions: nunca lanza, y sin credenciales no hace nada.
 */
export async function drenarColaWallet(limite = 5): Promise<void> {
  try {
    const config = configWallet();
    if (!config.apple && !config.google) return;
    await procesarTrabajosWallet(conLealtad(createAdminClient()), config, limite, 20_000);
  } catch (fallo) {
    Sentry.captureException(fallo, { tags: { action: "wallet_drenar" } });
  }
}

export async function snapshotDeMembresia(admin: ClienteLealtad, membershipId: string): Promise<SnapshotMembresia> {
  const { data, error } = await admin.rpc("wallet_snapshot_membresia", { p_membership_id: membershipId });
  if (error) throw error;
  if (data === null) throw new Error("La membresia ya no existe");
  return snapshotSchema.parse(data);
}

async function sincronizarMembresia(admin: ClienteLealtad, config: ConfigWallet, membershipId: string, version: number): Promise<void> {
  const { data: pases, error } = await admin.from("wallet_passes").select("*").eq("membership_id", membershipId);
  if (error) throw error;
  if (!pases || pases.length === 0) return;
  const snapshot = await snapshotDeMembresia(admin, membershipId);
  const fallos: string[] = [];
  for (const pase of pases) {
    try {
      if (pase.proveedor === "google") await sincronizarGoogle(admin, config, pase, snapshot, version);
      else await sincronizarApple(admin, config, pase, version);
    } catch (fallo) {
      const mensaje = fallo instanceof Error ? fallo.message : "fallo desconocido";
      fallos.push(`${pase.proveedor}: ${mensaje}`);
      await admin
        .from("wallet_passes")
        .update({ ultimo_error: mensaje.slice(0, 500), ultimo_error_at: new Date().toISOString() })
        .eq("id", pase.id);
    }
  }
  if (fallos.length > 0) throw new Error(fallos.join(" | "));
}

async function sincronizarGoogle(admin: ClienteLealtad, config: ConfigWallet, pase: WalletPassRow, snapshot: SnapshotMembresia, version: number): Promise<void> {
  if (!config.google) throw new Error("Google Wallet sin credenciales");
  if (!pase.object_id) throw new Error("Pase de Google sin object_id");
  const ids = idsGoogle(config.google, snapshot.program.id, snapshot.membership.id);
  // La clase tambien: un cambio de premio o color del programa vive ahi.
  await asegurarClaseGoogle(config.google, snapshot, ids, config.siteUrl);
  await actualizarObjetoGoogle(config.google, snapshot, ids);
  const { error } = await admin
    .from("wallet_passes")
    .update({ version_deseada: version, version_sincronizada: version, ultimo_error: null, ultimo_error_at: null })
    .eq("id", pase.id);
  if (error) throw error;
}

async function sincronizarApple(admin: ClienteLealtad, config: ConfigWallet, pase: WalletPassRow, version: number): Promise<void> {
  if (!config.apple) throw new Error("Apple Wallet sin credenciales");
  const { error } = await admin
    .from("wallet_passes")
    .update({ version_deseada: Math.max(version, pase.version_deseada), ultimo_error: null, ultimo_error_at: null })
    .eq("id", pase.id);
  if (error) throw error;
  const { data: registros, error: errorRegistros } = await admin
    .from("apple_device_registrations")
    .select("device_library_identifier, push_token")
    .eq("pass_id", pase.id)
    .order("created_at", { ascending: false })
    .limit(5);
  if (errorRegistros) throw errorRegistros;
  if (!registros || registros.length === 0) return;
  const resultado = await notificarApns(config.apple, registros.map((r) => r.push_token));
  if (resultado.invalidos.length > 0) {
    await admin.from("apple_device_registrations").delete().eq("pass_id", pase.id).in("push_token", resultado.invalidos);
  }
  if (resultado.errores.length > 0) throw new Error(`APNs: ${resultado.errores.join("; ")}`);
}
