export interface FeedProduct {
  id: string;
  titulo: string;
  precio: number;
  imagen_principal: string | null;
  categoria: string;
  slug: string | null;
  created_at: string;
  precio_negociable: boolean | null;
  profiles: {
    nombre: string;
    trust_level: string;
    average_rating: number;
    reviews_count: number;
  } | {
    nombre: string;
    trust_level: string;
    average_rating: number;
    reviews_count: number;
  }[] | null;
  product_categories: {
    is_primary: boolean;
    categories: {
      slug: string;
      nombre: string;
    } | {
      slug: string;
      nombre: string;
    }[] | null;
  }[] | null;
}
