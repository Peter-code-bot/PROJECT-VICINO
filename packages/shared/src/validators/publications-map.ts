import { z } from "zod";
import { CATEGORIES } from "../constants/categories";

export const MAP_AREA = { west: -118.5, south: 14.5, east: -86.5, north: 32.8 } as const;
export const mapBoundsSchema = z.object({
  west: z.number().finite().min(MAP_AREA.west).max(MAP_AREA.east),
  south: z.number().finite().min(MAP_AREA.south).max(MAP_AREA.north),
  east: z.number().finite().min(MAP_AREA.west).max(MAP_AREA.east),
  north: z.number().finite().min(MAP_AREA.south).max(MAP_AREA.north),
}).strict().refine(b => b.west < b.east && b.south < b.north, "Área inválida");
export const mapCursorSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{32}$/),
  created_at: z.string().datetime({ offset: true }).nullable(),
  id: z.string().uuid(),
}).strict();
export const mapQuerySchema = z.object({
  bounds: mapBoundsSchema,
  q: z.string().trim().max(120).default(""),
  categories: z.array(z.string().refine(s => CATEGORIES.some(c => c.slug === s), "Categoría inválida"))
    .max(10).default([]).transform(v => [...new Set(v)].sort()),
  tipo: z.enum(["producto", "servicio"]).nullable().default(null),
  price_min: z.number().finite().min(0).max(99999999).nullable().default(null),
  price_max: z.number().finite().min(0).max(99999999).nullable().default(null),
  mode: z.enum(["zone", "nearby"]).default("zone"),
  center: z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) }).strict().nullable().default(null),
  radius_meters: z.number().int().min(1000).max(50000).default(10000),
  cell_id: z.string().regex(/^cell:[1-9][0-9]*:-?[0-9]+:-?[0-9]+$/).max(70).nullable().default(null),
  cursor: mapCursorSchema.nullable().default(null),
}).strict().superRefine((q, ctx) => {
  if (q.mode === "nearby" && !q.center) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["center"], message: "Elige una ubicación para buscar cerca" });
  if (q.price_min !== null && q.price_max !== null && q.price_min > q.price_max) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["price_max"], message: "El precio máximo debe ser mayor al mínimo" });
}).transform(q => ({ ...q, center: q.mode === "zone" ? null : q.center }));

const featureSchema = z.object({
  id: z.string(), public_lat: z.number().finite(), public_lng: z.number().finite(),
  count: z.number().int().positive(), seller_count: z.number().int().positive(),
  bounds: z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() }),
});
const listingSchema = z.object({
  id: z.string().uuid(), titulo: z.string(), slug: z.string().nullable(),
  categoria: z.string(), precio: z.number().nullable(), modo_precio: z.string(),
  tipo: z.string(), imagen_principal: z.string().nullable(),
  creador_id: z.string().uuid(), vendedor_nombre: z.string(),
  cell_id: z.string(), seller_listing_count: z.number().int().positive(), created_at: z.string().nullable(),
});
export const mapResultSchema = z.object({
  query_key: z.string().regex(/^[a-f0-9]{32}$/), projection_version: z.literal(1),
  as_of: z.string(), features: z.array(featureSchema).max(300),
  listings: z.array(listingSchema).max(30), total: z.number().int().nonnegative(),
  seller_total: z.number().int().nonnegative(), list_total: z.number().int().nonnegative(),
  next_cursor: mapCursorSchema.nullable(),
});
export type MapBounds = z.infer<typeof mapBoundsSchema>;
export type MapQuery = z.infer<typeof mapQuerySchema>;
export type MapResult = z.infer<typeof mapResultSchema>;
export type MapFeature = MapResult["features"][number];
export type MapListing = MapResult["listings"][number];
