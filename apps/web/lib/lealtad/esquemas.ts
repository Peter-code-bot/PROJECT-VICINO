/**
 * Forma de lo que devuelven las RPC de lealtad (jsonb). Se valida en la
 * frontera: un jsonb es `Json` para tsc, y sin esto cada pantalla leeria
 * campos a ciegas.
 */
import { z } from "zod";

const fecha = z.string();
const fechaNula = z.string().nullable();

export const programaSchema = z.object({
  id: z.string().uuid(),
  seller_id: z.string().uuid(),
  status: z.enum(["borrador", "activo", "pausado", "archivado"]),
  nombre: z.string(),
  premio: z.string(),
  meta_sellos: z.number().int(),
  condiciones: z.string().nullable(),
  color: z.string(),
  plantilla: z.string(),
  version_actual: z.number().int(),
  publicado_at: fechaNula,
  created_at: fecha,
  updated_at: fecha,
});
export type Programa = z.infer<typeof programaSchema>;

export const membresiaSchema = z.object({
  id: z.string().uuid(),
  program_id: z.string().uuid(),
  customer_profile_id: z.string().uuid(),
  public_id: z.string(),
  version_aceptada: z.number().int(),
  sellos_disponibles: z.number().int(),
  sellos_totales: z.number().int(),
  premios_canjeados: z.number().int(),
  wallet_version: z.number(),
  status: z.enum(["activa", "revocada"]),
  created_at: fecha,
  updated_at: fecha,
});
export type Membresia = z.infer<typeof membresiaSchema>;

export const canjeSchema = z.object({
  id: z.string().uuid(),
  membership_id: z.string().uuid(),
  program_id: z.string().uuid(),
  version: z.number().int(),
  premio: z.string(),
  costo_sellos: z.number().int(),
  status: z.enum(["pendiente", "canjeado", "cancelado", "expirado"]),
  clave_idempotencia: z.string(),
  codigo: z.string(),
  expires_at: fecha,
  confirmed_by: z.string().nullable(),
  confirmed_at: fechaNula,
  event_id: z.string().nullable(),
  created_at: fecha,
  updated_at: fecha,
});
export type Canje = z.infer<typeof canjeSchema>;

export const eventoSchema = z.object({
  id: z.string().uuid(),
  tipo: z.enum(["earn", "redeem", "reverse", "adjust"]),
  sellos: z.number().int(),
  motivo: z.string().nullable(),
  created_at: fecha,
});
export type Evento = z.infer<typeof eventoSchema>;

export const snapshotSchema = z.object({
  membership: z.object({
    id: z.string().uuid(),
    public_id: z.string(),
    status: z.enum(["activa", "revocada"]),
    sellos_disponibles: z.number().int(),
    sellos_totales: z.number().int(),
    premios_canjeados: z.number().int(),
    wallet_version: z.number(),
    version_aceptada: z.number().int(),
    created_at: fecha,
  }),
  program: z.object({
    id: z.string().uuid(),
    nombre: z.string(),
    premio: z.string(),
    meta_sellos: z.number().int(),
    condiciones: z.string().nullable(),
    color: z.string(),
    plantilla: z.string(),
    status: z.enum(["borrador", "activo", "pausado", "archivado"]),
    version_actual: z.number().int(),
  }),
  cliente: z.object({ id: z.string().uuid(), nombre: z.string() }),
  negocio: z.object({ id: z.string().uuid(), nombre: z.string(), foto: z.string().nullable() }),
});
export type SnapshotMembresia = z.infer<typeof snapshotSchema>;

export const miTarjetaSchema = snapshotSchema.extend({
  /** Sellos que cuesta el premio para ESTA tarjeta (la meta vigente o la que acepto, la menor). */
  meta_canje: z.number().int(),
  canje_pendiente: z
    .object({
      id: z.string().uuid(),
      codigo: z.string(),
      expires_at: fecha,
      premio: z.string(),
      costo_sellos: z.number().int(),
    })
    .nullable(),
  eventos: z.array(eventoSchema),
  pases: z.array(
    z.object({ proveedor: z.enum(["apple", "google"]), emitido_at: fechaNula, guardado_at: fechaNula }),
  ),
});
export type MiTarjeta = z.infer<typeof miTarjetaSchema>;

export const misTarjetasSchema = z.array(
  z.object({
    id: z.string().uuid(),
    public_id: z.string(),
    status: z.enum(["activa", "revocada"]),
    sellos_disponibles: z.number().int(),
    sellos_totales: z.number().int(),
    premios_canjeados: z.number().int(),
    created_at: fecha,
    program: z.object({
      id: z.string().uuid(),
      nombre: z.string(),
      premio: z.string(),
      meta_sellos: z.number().int(),
      color: z.string(),
      plantilla: z.string(),
      status: z.enum(["borrador", "activo", "pausado", "archivado"]),
    }),
    negocio: z.object({ id: z.string().uuid(), nombre: z.string(), foto: z.string().nullable() }),
  }),
);
export type TarjetaResumen = z.infer<typeof misTarjetasSchema>[number];

export const resumenNegocioSchema = z.object({
  program: programaSchema.nullable(),
  metricas: z
    .object({
      miembros: z.number(),
      sellos_emitidos: z.number(),
      canjes: z.number(),
      canjes_pendientes: z.number(),
    })
    .optional(),
  eventos: z
    .array(
      eventoSchema.extend({
        membership_id: z.string().uuid(),
        cliente: z.string(),
        revertido: z.boolean(),
      }),
    )
    .optional(),
  canjes_recientes: z
    .array(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["pendiente", "canjeado", "cancelado", "expirado"]),
        premio: z.string(),
        costo_sellos: z.number().int(),
        confirmed_at: fechaNula,
        created_at: fecha,
        expires_at: fecha,
        cliente: z.string(),
      }),
    )
    .optional(),
  ventas_sin_sello: z
    .array(z.object({ sale_id: z.string().uuid(), created_at: fecha, error: z.string().nullable() }))
    .optional(),
});
export type ResumenNegocio = z.infer<typeof resumenNegocioSchema>;

export const resultadoCanjeSchema = z.object({
  redemption: canjeSchema,
  repeated: z.boolean(),
  cliente: z.string().optional(),
});

export const inscripcionSchema = z.object({
  membership: membresiaSchema,
  program: z.object({
    id: z.string().uuid(),
    seller_id: z.string().uuid(),
    nombre: z.string(),
    premio: z.string(),
    meta_sellos: z.number().int(),
    color: z.string(),
    plantilla: z.string(),
  }),
});

export const pasePreparadoSchema = z.object({
  pass: z.object({
    id: z.string().uuid(),
    membership_id: z.string().uuid(),
    proveedor: z.enum(["apple", "google"]),
    serial_number: z.string(),
    authentication_token: z.string().nullable(),
    class_id: z.string().nullable(),
    object_id: z.string().nullable(),
    version_deseada: z.number(),
    version_sincronizada: z.number(),
    emitido_at: fechaNula,
    guardado_at: fechaNula,
  }),
  snapshot: snapshotSchema,
});
export type PasePreparado = z.infer<typeof pasePreparadoSchema>;

/** Lo que el perfil publico lee directamente de loyalty_programs (RLS: solo activos). */
export const programaPublicoSchema = programaSchema.pick({
  id: true,
  seller_id: true,
  nombre: true,
  premio: true,
  meta_sellos: true,
  condiciones: true,
  color: true,
  plantilla: true,
  status: true,
});
export type ProgramaPublico = z.infer<typeof programaPublicoSchema>;
