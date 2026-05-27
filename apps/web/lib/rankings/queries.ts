import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Category, RankedSeller, RankingPeriod } from "./types";

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be YYYY-MM");
const uuidSchema = z.string().uuid();

const rankingParamsSchema = z.object({
  category_id: uuidSchema,
  period: periodSchema,
  user_lat: z.number().min(-90).max(90),
  user_lng: z.number().min(-180).max(180),
  radius_meters: z.number().int().min(100).max(50_000).default(5000),
  limit: z.number().int().min(1).max(100).default(10),
});

export type RankingParams = z.infer<typeof rankingParamsSchema>;

export function currentPeriodInMexicoCity(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

export async function getRankingHiperlocal(input: RankingParams): Promise<RankedSeller[]> {
  const params = rankingParamsSchema.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_ranking_hiperlocal", {
    p_category_id: params.category_id,
    p_period: params.period,
    p_user_lat: params.user_lat,
    p_user_lng: params.user_lng,
    p_radius_meters: params.radius_meters,
    p_limit: params.limit,
  });

  if (error) {
    throw new Error(`get_ranking_hiperlocal failed: ${error.message}`);
  }

  return (data ?? []) as RankedSeller[];
}

export async function getAvailablePeriods(): Promise<RankingPeriod[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_available_ranking_periods");

  if (error) {
    throw new Error(`get_available_ranking_periods failed: ${error.message}`);
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
    throw new Error(`getCategories failed: ${error.message}`);
  }

  return (data ?? []) as Category[];
}
