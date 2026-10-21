import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { conLealtad } from "@/types/loyalty.types";
import {
  miTarjetaSchema,
  misTarjetasSchema,
  programaPublicoSchema,
  resumenNegocioSchema,
  type MiTarjeta,
  type ProgramaPublico,
  type ResumenNegocio,
  type TarjetaResumen,
} from "./esquemas";

type Cliente = SupabaseClient<Database>;

/** Panel del negocio: programa (en cualquier estado) + metricas + actividad. */
export async function resumenNegocio(supabase: Cliente): Promise<ResumenNegocio> {
  const { data, error } = await conLealtad(supabase).rpc("loyalty_resumen_negocio");
  if (error) throw error;
  return resumenNegocioSchema.parse(data);
}

export async function misTarjetas(supabase: Cliente): Promise<TarjetaResumen[]> {
  const { data, error } = await conLealtad(supabase).rpc("loyalty_mis_tarjetas");
  if (error) throw error;
  return misTarjetasSchema.parse(data);
}

/** null cuando la tarjeta no existe o no es de quien pregunta (PT404). */
export async function miTarjeta(supabase: Cliente, membershipId: string): Promise<MiTarjeta | null> {
  const { data, error } = await conLealtad(supabase).rpc("loyalty_mi_tarjeta", { p_membership_id: membershipId });
  if (error) {
    if (error.code === "PT404" || error.code === "22023" || error.code === "22P02") return null;
    throw error;
  }
  return miTarjetaSchema.parse(data);
}

/** Programa publicado de un negocio, tal como lo ve cualquiera (RLS: solo activos). */
export async function programaActivoDe(supabase: Cliente, sellerId: string): Promise<ProgramaPublico | null> {
  const { data, error } = await conLealtad(supabase)
    .from("loyalty_programs")
    .select("id, seller_id, nombre, premio, meta_sellos, condiciones, color, plantilla, status")
    .eq("seller_id", sellerId)
    .eq("status", "activo")
    .maybeSingle();
  if (error) throw error;
  return data ? programaPublicoSchema.parse(data) : null;
}

/** La membresia de ESTA persona en un programa (el filtro por cliente evita que el dueño vea las ajenas aqui). */
export async function membresiaPropiaEn(
  supabase: Cliente,
  programId: string,
  userId: string,
): Promise<{ id: string; sellos_disponibles: number; status: "activa" | "revocada" } | null> {
  const { data, error } = await conLealtad(supabase)
    .from("loyalty_memberships")
    .select("id, sellos_disponibles, status")
    .eq("program_id", programId)
    .eq("customer_profile_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
