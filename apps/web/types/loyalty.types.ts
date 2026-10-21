/**
 * Tipos de las tablas y RPC de lealtad (migracion 20261020120000).
 *
 * database.types.ts se genera desde PRODUCCION (scripts/gen-types.mjs) y la
 * migracion aun no esta aplicada, asi que las tablas nuevas no existen ahi.
 * Este archivo las declara a mano, con la MISMA forma que produce el codegen,
 * y las mezcla con el tipo generado. Cuando Pedro aplique la migracion y
 * regenere, el generado las traera y este archivo puede reducirse al helper.
 *
 * Nada aqui cambia el runtime: `conLealtad` es un cast sobre el mismo objeto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database.types";

export type EstadoProgramaLealtad = "borrador" | "activo" | "pausado" | "archivado";
export type TipoEventoLealtad = "earn" | "redeem" | "reverse" | "adjust";
export type OrigenEventoLealtad = "sale_confirmation" | "redemption" | "event";
export type EstadoCanje = "pendiente" | "canjeado" | "cancelado" | "expirado";
export type ProveedorWallet = "apple" | "google";
export type EstadoTrabajoWallet = "pendiente" | "procesando" | "hecho" | "fallido";

export type LoyaltyProgramRow = {
  id: string;
  seller_id: string;
  status: EstadoProgramaLealtad;
  nombre: string;
  premio: string;
  meta_sellos: number;
  condiciones: string | null;
  color: string;
  plantilla: string;
  version_actual: number;
  publicado_at: string | null;
  created_at: string;
  updated_at: string;
}

export type LoyaltyProgramVersionRow = {
  id: string;
  program_id: string;
  version: number;
  nombre: string;
  premio: string;
  meta_sellos: number;
  condiciones: string | null;
  publicado_at: string;
}

export type LoyaltyMembershipRow = {
  id: string;
  program_id: string;
  customer_profile_id: string;
  public_id: string;
  version_aceptada: number;
  sellos_disponibles: number;
  sellos_totales: number;
  premios_canjeados: number;
  wallet_version: number;
  status: "activa" | "revocada";
  created_at: string;
  updated_at: string;
}

export type LoyaltyEventRow = {
  id: string;
  membership_id: string;
  program_id: string;
  tipo: TipoEventoLealtad;
  sellos: number;
  actor_id: string | null;
  motivo: string | null;
  origen_tipo: OrigenEventoLealtad | null;
  origen_id: string | null;
  created_at: string;
}

export type LoyaltyRedemptionRow = {
  id: string;
  membership_id: string;
  program_id: string;
  version: number;
  premio: string;
  costo_sellos: number;
  status: EstadoCanje;
  clave_idempotencia: string;
  codigo: string;
  expires_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  event_id: string | null;
  created_at: string;
  updated_at: string;
}

export type WalletPassRow = {
  id: string;
  membership_id: string;
  proveedor: ProveedorWallet;
  serial_number: string;
  authentication_token: string | null;
  class_id: string | null;
  object_id: string | null;
  version_deseada: number;
  version_sincronizada: number;
  emitido_at: string | null;
  guardado_at: string | null;
  ultimo_error: string | null;
  ultimo_error_at: string | null;
  created_at: string;
  updated_at: string;
}

export type WalletUpdateJobRow = {
  id: number;
  membership_id: string;
  version: number;
  status: EstadoTrabajoWallet;
  intentos: number;
  siguiente_intento_at: string;
  ultimo_error: string | null;
  created_at: string;
  updated_at: string;
}

export type AppleDeviceRegistrationRow = {
  device_library_identifier: string;
  pass_id: string;
  push_token: string;
  created_at: string;
}

// Los Row son `type` y no `interface` a proposito: una interface no tiene
// firma de indice implicita y no satisface Record<string, unknown>, que es lo
// que supabase-js exige a cada tabla (y lo que dejaba todo en `never`).
type Tabla<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type TablasLealtad = {
  loyalty_programs: Tabla<LoyaltyProgramRow>;
  loyalty_program_versions: Tabla<LoyaltyProgramVersionRow>;
  loyalty_memberships: Tabla<LoyaltyMembershipRow>;
  loyalty_events: Tabla<LoyaltyEventRow>;
  loyalty_redemptions: Tabla<LoyaltyRedemptionRow>;
  wallet_passes: Tabla<WalletPassRow>;
  wallet_update_jobs: Tabla<WalletUpdateJobRow>;
  apple_device_registrations: Tabla<AppleDeviceRegistrationRow>;
};

// Los parametros con DEFAULT NULL en la base van opcionales, como los
// escribiria el codegen (ver project_vicino_codegen_args_nulables).
export type FuncionesLealtad = {
  loyalty_programa_guardar: {
    Args: {
      p_nombre: string;
      p_premio: string;
      p_meta_sellos: number;
      p_condiciones?: string;
      p_color?: string;
      p_plantilla?: string;
    };
    Returns: Json;
  };
  loyalty_programa_estado: { Args: { p_estado: string }; Returns: Json };
  loyalty_canje_confirmar: { Args: { p_codigo: string }; Returns: Json };
  loyalty_sello_desde_venta: { Args: { p_sale_id: string }; Returns: Json };
  loyalty_revertir_evento: { Args: { p_event_id: string; p_motivo?: string }; Returns: Json };
  loyalty_resumen_negocio: { Args: never; Returns: Json };
  loyalty_inscribirse: { Args: { p_program_id: string }; Returns: Json };
  loyalty_mis_tarjetas: { Args: never; Returns: Json };
  loyalty_mi_tarjeta: { Args: { p_membership_id: string }; Returns: Json };
  loyalty_canje_iniciar: { Args: { p_membership_id: string; p_clave: string }; Returns: Json };
  loyalty_canje_cancelar: { Args: { p_redemption_id: string }; Returns: Json };
  wallet_pase_preparar: {
    Args: { p_membership_id: string; p_proveedor: string; p_class_id?: string; p_object_id?: string };
    Returns: Json;
  };
  wallet_jobs_tomar: { Args: { p_limite?: number }; Returns: WalletUpdateJobRow[] };
  wallet_job_terminar: {
    Args: { p_id: number; p_version_procesada: number; p_ok: boolean; p_error?: string };
    Returns: undefined;
  };
  wallet_snapshot_membresia: { Args: { p_membership_id: string }; Returns: Json };
};

/**
 * Mezcla por tipo mapeado y no por interseccion: `A & B` no satisface el
 * GenericSchema de supabase-js y deja TODAS las tablas en `never`.
 */
type Mezcla<A, B> = {
  [K in keyof A | keyof B]: K extends keyof B ? B[K] : K extends keyof A ? A[K] : never;
};

export type DatabaseLealtad = {
  __InternalSupabase: Database["__InternalSupabase"];
  graphql_public: Database["graphql_public"];
  public: {
    Tables: Mezcla<Database["public"]["Tables"], TablasLealtad>;
    Views: Database["public"]["Views"];
    Functions: Mezcla<Database["public"]["Functions"], FuncionesLealtad>;
    Enums: Database["public"]["Enums"];
    CompositeTypes: Database["public"]["CompositeTypes"];
  };
};

export type ClienteLealtad = SupabaseClient<DatabaseLealtad>;

/** El mismo cliente, con las tablas y RPC de lealtad visibles para tsc. */
export function conLealtad(cliente: SupabaseClient<Database>): ClienteLealtad {
  return cliente as unknown as ClienteLealtad;
}
