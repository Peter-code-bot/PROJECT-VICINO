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
export type MapCursor = z.infer<typeof mapCursorSchema>;
export type MapResult = z.infer<typeof mapResultSchema>;
export type MapFeature = MapResult["features"][number];
export type MapListing = MapResult["listings"][number];

const coverageCenterSchema = z.object({
  lat: z.number().finite().min(MAP_AREA.south).max(MAP_AREA.north),
  lng: z.number().finite().min(MAP_AREA.west).max(MAP_AREA.east),
}).strict();
export const mapCellCursorSchema = z.object({ x: z.number().int().min(-11850).max(-8650), y: z.number().int().min(1450).max(3280) }).strict();
export const mapCoverageRequestSchema = z.object({
  action: z.enum(["overview", "cells", "listings", "check"]),
  query: mapQuerySchema,
  coverage_center: coverageCenterSchema.nullable(),
  revision: z.string().regex(/^[a-f0-9]{32}$/).nullable().default(null),
  cell_cursor: mapCellCursorSchema.nullable().default(null),
}).strict().superRefine((r, ctx) => {
  if (r.action === "cells" && !r.coverage_center) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Elige una zona para cargar sus puntos" });
  if (r.query.cell_id) {
    const [, level, x, y] = r.query.cell_id.split(":");
    const stride = Number(level);
    if (stride > 8192 || (stride & (stride - 1)) !== 0 || !Number.isSafeInteger(Number(x)) || !Number.isSafeInteger(Number(y)) || Number(x) < -11850 || Number(x) > -1 || Number(y) < 0 || Number(y) > 3280) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Grupo inválido" });
  }
});
export const mapCoverageResultSchema = mapResultSchema.extend({
  list_seller_total: z.number().int().nonnegative(),
  revision: z.string().regex(/^[a-f0-9]{32}$/),
  cells: z.array(z.object({ x: z.number().int(), y: z.number().int(), count: z.number().int().positive(), seller_count: z.number().int().positive() })).max(300),
  next_cell_cursor: mapCellCursorSchema.nullable(),
  complete: z.boolean(),
});
export type MapCoverageRequest = z.infer<typeof mapCoverageRequestSchema>;
export type MapCoverageResult = z.infer<typeof mapCoverageResultSchema>;
export type MapCell = MapCoverageResult["cells"][number];
