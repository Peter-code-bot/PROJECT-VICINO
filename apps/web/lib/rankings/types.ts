export interface RankedSeller {
  rank: number;
  seller_id: string;
  display_name: string | null;
  foto: string | null;
  composite_score: number;
  trust_points: number;
  is_confiable: boolean;
  distancia_aprox: number | null;
}

export interface RankingPeriod {
  period: string;
  is_frozen: boolean;
}

export interface Category {
  id: string;
  nombre: string;
  slug: string;
  icono: string | null;
}
