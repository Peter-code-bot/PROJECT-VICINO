// ProductCategory interface mirroring the pivot schema in
// supabase/migrations/20260529000001_product_categories_pivot_and_backfill.sql
// (MP#08 #1 Parte 1a). Write path wired in Parte 1b. Render switch (read path)
// deferred to MP#08 #5 + categoria TEXT drop deferred to MP#08 #4. During
// coexistence categoria TEXT remains the canonical source of truth for
// render and search; product_categories is populated in parallel.

export interface ProductCategory {
  product_id: string;
  categoria_id: string;
  created_at: string;
}

// Shape used at insert time: omits the server-defaulted created_at column.
// Useful as the argument type for product_categories INSERT calls in server
// actions.
export type ProductCategoryInsert = Pick<
  ProductCategory,
  "product_id" | "categoria_id"
>;
