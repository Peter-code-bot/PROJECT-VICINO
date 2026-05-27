import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Category, RankedSeller, RankingPeriod } from "./types";

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be YYYY-MM");
const uuidSchema = z.string().uuid();

const hiperlocalParamsSchema = z.object({
  category_id: uuidSchema,
  period: periodSchema,
  user_lat: z.number().min(-90).max(90),
  user_lng: z.number().min(-180).max(180),
  radius_meters: z.number().int().min(100).max(50_000).default(5_000),
  limit: z.number().int().min(1).max(100).default(10),
});

export type HiperlocalParams = z.input<typeof hiperlocalParamsSchema>;

export type RankingsQueryResult =
  | { ok: true; sellers: RankedSeller[] }
  | { ok: false; error: string };

export async function getRankingHiperlocal(
  params: HiperlocalParams,
): Promise<RankingsQueryResult> {
  const parsed = hiperlocalParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_ranking_hiperlocal", {
    p_category_id: parsed.data.category_id,
    p_period: parsed.data.period,
    p_user_lat: parsed.data.user_lat,
    p_user_lng: parsed.data.user_lng,
    p_radius_meters: parsed.data.radius_meters,
    p_limit: parsed.data.limit,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, sellers: (data ?? []) as RankedSeller[] };
}

export async function getAvailablePeriods(): Promise<RankingPeriod[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_available_ranking_periods");
  if (error) {
    console.error("[rankings] getAvailablePeriods failed", error);
    return [];
  }
  return (data ?? []) as RankingPeriod[];
}

export async function getCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, nombre, slug, icono")
    .eq("activo", true)
    .order("orden", { ascending: true })
    .order("nombre", { ascending: true });

  if (error) {
    console.error("[rankings] getCategories failed", error);
    return [];
  }
  return (data ?? []) as Category[];
}

/**
 * Returns the YYYY-MM string for the current month in America/Mexico_City.
 * Mirrors the SQL convention used by recompute_seller_rankings.
 */
export function currentPeriodInMexicoCity(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}
