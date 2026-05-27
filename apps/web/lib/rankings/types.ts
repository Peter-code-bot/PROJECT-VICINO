export type RankedSeller = {
  rank: number;
  seller_id: string;
  display_name: string;
  foto: string | null;
  composite_score: number;
  trust_points: number;
  is_confiable: boolean;
  distancia_aprox?: number;
};

export type RankingPeriod = {
  period: string;
  is_frozen: boolean;
};

export type Category = {
  id: string;
  nombre: string;
  slug: string;
  icono: string;
};
